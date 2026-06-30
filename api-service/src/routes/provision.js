// routes/provision.js — Endpoints PUBLICS du provisioning one-liner.
//
// Monté sous /provision, SANS le middleware d'auth JWT : ici le TOKEN de
// provisioning EST l'authentification. Voir spec 2026-06-30 (sections 4, 6, 7).
//
// Principe de sécurité fondateur : le callback /ready n'est jamais cru sur parole.
// Le statut `online` n'est atteint QUE si la plateforme rouvre elle-même un SSH
// vers le VPS avec sa clé privée (étape de vérification, verifyServer()).

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const tar = require('tar-stream');

const router = express.Router();

const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');
const { SCRIPT_DIR } = require('../services/config');
const { hashToken } = require('../services/sshKeys');
const { auditLog } = require('../services/audit');
const log = require('../services/logger');

// Version des scripts servis. Pas de fichier VERSION dédié dans le repo : on fige
// une constante (le bootstrap l'écrit dans /usr/local/bin/.wg-fux-scripts-version
// côté VPS pour détecter l'obsolescence au heartbeat).
const SCRIPTS_VERSION = '1.0.0';

// Scripts embarqués dans le tarball servi au VPS (ordre déterministe pour un
// sha256 stable). On inclut tous les wg-*.sh + le dispatcher + l'exec entrypoint,
// mais PAS le bootstrap lui-même (il est servi/templaté séparément).
const TARBALL_SCRIPTS = (() => {
  let names = [];
  try {
    names = fs
      .readdirSync(SCRIPT_DIR)
      .filter((f) => f.startsWith('wg-') && f.endsWith('.sh') && f !== 'wg-fux-bootstrap.sh');
  } catch (err) {
    log.error('provision', `Impossible de lister ${SCRIPT_DIR}`, { err: err.message });
  }
  return names.sort();
})();

// Cache du tarball + de son sha256 (déterministe, recalculé une seule fois).
let _tarballCache = null; // { buffer: Buffer, sha256: string }

/**
 * Construit le tar.gz des scripts (déterministe) et met en cache.
 * @returns {Promise<{ buffer: Buffer, sha256: string }>}
 */
function buildScriptsTarball() {
  if (_tarballCache) return Promise.resolve(_tarballCache);

  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const chunks = [];
    // mtime fixe → tarball reproductible (sha256 stable entre redémarrages).
    const FIXED_MTIME = new Date(0);

    const gzip = zlib.createGzip({ level: 9 });
    gzip.on('data', (c) => chunks.push(c));
    gzip.on('error', reject);
    gzip.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      _tarballCache = { buffer, sha256 };
      resolve(_tarballCache);
    });
    pack.on('error', reject);
    pack.pipe(gzip);

    try {
      for (const name of TARBALL_SCRIPTS) {
        const content = fs.readFileSync(path.join(SCRIPT_DIR, name));
        pack.entry({ name, mode: 0o755, mtime: FIXED_MTIME }, content);
      }
      pack.finalize();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Construit l'URL de base de la plateforme (préférence : env PLATFORM_BASE_URL,
 * sinon reconstruit depuis la requête).
 */
function platformBase(req) {
  const fromEnv = (process.env.PLATFORM_BASE_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

/**
 * Rend le script bootstrap pour un serveur donné : substitue tous les jetons
 * {{...}}. Le sha256 du résultat est ce qui s'affiche dans le one-liner.
 *
 * @param {object} server  ligne `servers` (au moins { publicKey })
 * @param {object} opts     { token, req }  (req sert à reconstruire PLATFORM_BASE)
 * @returns {Promise<{ script: string, sha256: string, scriptsSha256: string }>}
 */
async function renderBootstrap(server, { req } = {}) {
  const templatePath = path.join(SCRIPT_DIR, 'wg-fux-bootstrap.sh');
  const template = fs.readFileSync(templatePath, 'utf8');

  const { sha256: scriptsSha256 } = await buildScriptsTarball();
  const base = platformBase(req);

  const replacements = {
    '{{WG_FUX_PUBKEY}}': server.publicKey || '',
    '{{PLATFORM_BASE}}': base,
    '{{PLATFORM_IP}}': (process.env.PLATFORM_PUBLIC_IP || '').trim(),
    '{{SCRIPTS_TARBALL_URL}}': `${base}/provision/scripts.tgz`,
    '{{SCRIPTS_SHA256}}': scriptsSha256,
    '{{TLS_PINNED_PUBKEY}}': (process.env.TLS_PINNED_PUBKEY || '').trim(),
    '{{SCRIPTS_VERSION}}': SCRIPTS_VERSION,
  };

  let script = template;
  for (const [token, value] of Object.entries(replacements)) {
    script = script.split(token).join(value);
  }

  // CRITIQUE : en bash, `S=$(curl …)` retire les newlines de FIN. Le VPS hashe
  // donc `printf '%s' "$S"` = le script SANS newline final. On hashe ET on sert
  // sans newline final pour que le sha256 côté VPS corresponde à WG_H.
  script = script.replace(/\n+$/, '');

  const sha256 = crypto.createHash('sha256').update(script, 'utf8').digest('hex');
  return { script, sha256, scriptsSha256 };
}

/**
 * Retrouve un serveur via le hash de son token de provisioning, en vérifiant
 * qu'il n'est pas expiré. Réponse de forme constante (null) si introuvable ou
 * expiré — pas de fuite par timing/forme.
 * @returns {Promise<object|null>}
 */
async function findServerByToken(token) {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = hashToken(token);
  const [server] = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.provisionTokenHash, tokenHash))
    .limit(1);
  if (!server) return null;
  // Expiration (provisionTokenExpiry est un timestamp Date via Drizzle mode timestamp).
  const expiry = server.provisionTokenExpiry ? new Date(server.provisionTokenExpiry).getTime() : 0;
  if (!expiry || Date.now() > expiry) return null;
  return server;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /provision/scripts.tgz — tarball public des scripts (vérifié par sha256
// côté VPS). Cache long : immuable pour une version donnée.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/scripts.tgz', async (req, res, next) => {
  try {
    const { buffer } = await buildScriptsTarball();
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', 'attachment; filename="scripts.tgz"');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /provision/:token/script — script bootstrap templaté. Le token EST l'auth.
// Réponse de forme constante (404 sobre) si token invalide/expiré.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:token/script', async (req, res, next) => {
  try {
    const server = await findServerByToken(req.params.token);
    if (!server) {
      return res.status(404).type('text/plain').send('Not found\n');
    }
    const { script } = await renderBootstrap(server, { req });
    res.setHeader('Content-Type', 'text/x-shellscript');
    res.setHeader('Cache-Control', 'no-store');
    res.send(script);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /provision/:token/ready — callback du VPS. Bearer = token.
// NE PASSE PAS online : stocke la host key candidate, passe 'provisioning',
// puis DÉCLENCHE la vérification SSH (source de vérité).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:token/ready', express.json(), async (req, res, next) => {
  try {
    // Le token doit venir du header Authorization: Bearer ET matcher l'URL.
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const urlToken = req.params.token;

    // On exige la présence des deux et leur cohérence (le VPS envoie les deux).
    if (!bearer || bearer !== urlToken) {
      return res.status(401).json({ error: 'Token de provisioning invalide' });
    }

    const server = await findServerByToken(urlToken);
    if (!server) {
      return res.status(404).json({ error: 'Token de provisioning invalide ou expiré' });
    }

    const { hostKey, hostname, scriptsVersion } = req.body || {};
    if (!hostKey || typeof hostKey !== 'string') {
      return res.status(400).json({ error: 'hostKey requis' });
    }

    // Stocke la host key ANNONCÉE (candidate) ; le vrai pin viendra de la vérif.
    await db
      .update(schema.servers)
      .set({
        pendingHostKey: hostKey,
        status: 'provisioning',
        scriptsVersion: scriptsVersion || null,
        lastError: null,
      })
      .where(eq(schema.servers.id, server.id));

    log.info('provision', 'Callback ready reçu', {
      serverId: server.id,
      hostname: hostname || null,
    });

    // Déclenche la vérification SSH. On l'attend pour renvoyer un résultat clair.
    const result = await verifyServer(server.id);

    if (result.online) {
      return res.json({ status: 'online', serverId: server.id });
    }
    // Vérif échouée : on répond 200 (le callback a bien été reçu) mais on signale
    // l'état. Le revendeur peut réessayer tant que le token n'est pas consommé.
    return res.status(200).json({
      status: 'provisioning',
      serverId: server.id,
      error: result.error || 'Vérification SSH en échec',
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Vérification (source de vérité). Pour un serveur en 'provisioning' :
//   1. On écrit hostKey = pendingHostKey AVANT d'appeler l'executor : c'est cette
//      colonne que getExecutorForServer lit pour pinner la host key. Si la host
//      key réellement vue diverge (MITM), l'executor échoue → on rollback à NULL.
//   2. On exécute une sonde triviale allowlistée (wg-fux-verify.sh).
//   3. Succès → status='online', hostKey pinnée, token consommé (usage unique),
//      auditLog. Échec → status='error', lastError, token NON consommé (retry OK).
// ─────────────────────────────────────────────────────────────────────────────
async function verifyServer(serverId) {
  const { getExecutorForServer } = require('../services/executors');

  const [server] = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
    .limit(1);

  if (!server) return { online: false, error: 'Serveur introuvable' };
  if (!server.pendingHostKey) {
    return { online: false, error: 'Aucune host key candidate (callback manquant)' };
  }
  if (!server.encPrivateKey) {
    return { online: false, error: 'Aucune clé privée enregistrée pour ce serveur' };
  }

  // Étape 1 : on pose la host key candidate comme valeur pinnée. getExecutorForServer
  // la lira et REFUSERA la connexion si la host key réellement présentée diffère.
  await db
    .update(schema.servers)
    .set({ hostKey: server.pendingHostKey })
    .where(eq(schema.servers.id, serverId));

  let result;
  try {
    const executor = await getExecutorForServer(serverId);
    // Sonde triviale dédiée : prouve que SSH+dispatch+sudo fonctionne, SANS
    // dépendre d'une config WireGuard (absente sur un VPS fraîchement provisionné).
    result = await executor.run('wg-fux-verify.sh', []);
  } catch (err) {
    // Échec de connexion (host key divergente = MITM possible, réseau, auth…).
    result = { success: false, stderr: err.message };
  }

  if (!result || !result.success) {
    // Rollback : on ne pin PAS une host key qu'on n'a pas pu prouver.
    await db
      .update(schema.servers)
      .set({
        hostKey: null,
        status: 'error',
        lastChecked: new Date(),
        lastError: `Vérification SSH échouée : ${(result && result.stderr) || 'inconnue'}`,
      })
      .where(eq(schema.servers.id, serverId));

    log.warn('provision', 'Vérification SSH échouée — serveur NON promu online', {
      serverId,
    });
    return { online: false, error: 'Vérification SSH échouée' };
  }

  // Succès prouvé : on promeut online, on pin la host key, on consomme le token.
  await db
    .update(schema.servers)
    .set({
      hostKey: server.pendingHostKey,
      pendingHostKey: null,
      status: 'online',
      consecutiveFailures: 0,
      lastChecked: new Date(),
      lastError: null,
      // Usage unique : le token est consommé une fois la confiance prouvée.
      provisionTokenHash: null,
      provisionTokenExpiry: null,
    })
    .where(eq(schema.servers.id, serverId));

  await auditLog({
    actor: 'system',
    action: 'server_online',
    targetType: 'server',
    targetName: server.label,
    details: { serverId, host: server.host },
  });

  log.info('provision', 'Serveur promu online (confiance prouvée par SSH)', { serverId });
  return { online: true };
}

module.exports = router;
// Exports internes pour réutilisation (routes/servers.js) et tests.
module.exports.renderBootstrap = renderBootstrap;
module.exports.buildScriptsTarball = buildScriptsTarball;
module.exports.findServerByToken = findServerByToken;
module.exports.verifyServer = verifyServer;
module.exports.SCRIPTS_VERSION = SCRIPTS_VERSION;
module.exports._resetTarballCache = () => {
  _tarballCache = null;
};
