// routes/provision.js — Endpoints PUBLICS du provisioning one-liner.
//
// Monté sous /provision, SANS le middleware d'auth JWT : ici le TOKEN de
// provisioning EST l'authentification.
//
// Flow : le one-liner télécharge le bootstrap (templaté), vérifie le sha256,
// l'exécute. Le bootstrap clone wg-fux + lance setup.sh --install (interactif),
// puis callback /ready. À la réception du callback, la plateforme marque le
// serveur online directement (plus de vérification SSH — le VPS a son propre stack).

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

// ─────────────────────────────────────────────────────────────────────────────
// Bundle produit : archive du code déployable servie aux VPS revendeurs à la
// place d'un `git clone` (le repo peut donc être PRIVÉ — le code n'est distribué
// qu'aux détenteurs d'un token de provisioning valide, sans historique git).
// ─────────────────────────────────────────────────────────────────────────────

// Racine du repo : montée en :ro dans le conteneur (REPO_DIR=/repo via compose) ;
// en dev/tests, résolue depuis ce fichier (api-service/src/routes → racine).
const REPO_DIR = (process.env.REPO_DIR || '').trim() || path.resolve(__dirname, '../../..');

// Construit depuis `git archive HEAD` : SEUL l'état committé part chez le
// revendeur. Les secrets (.env), node_modules, données et modifs locales de la
// prod (ex. chemins Let's Encrypt réécrits dans le template nginx par
// setup-ssl.sh) sont exclus par définition — et le bundle est reproductible.
// Chemins trackés mais internes exclus explicitement via pathspec :
const BUNDLE_GIT_EXCLUDES = [
  ':(exclude)docs',
  ':(exclude).github',
  ':(exclude).claude',
  ':(exclude)protected-bundle',
  ':(exclude)api-service/obfuscator.config.json',
];

let _bundleCache = null; // { buffer: Buffer, sha256: string, builtAt: number }

/**
 * Construit le tar.gz du produit depuis le HEAD git de REPO_DIR et met en
 * cache. Le sha256 du buffer EXACT servi est injecté dans le bootstrap → le
 * VPS vérifie l'intégrité avant extraction.
 * @returns {Promise<{ buffer: Buffer, sha256: string }>}
 */
function buildBundleTarball({ fresh = false } = {}) {
  if (_bundleCache && !fresh) return Promise.resolve(_bundleCache);

  // Bundle DURCI pré-fabriqué (interface pré-buildée + JS API obfusqué), produit
  // par scripts/build-protected-bundle.sh et monté en lecture seule. S'il existe,
  // il est servi tel quel — le client ne reçoit jamais le code source propre.
  // Sinon on retombe sur `git archive HEAD` (dev / instance non durcie).
  const protectedPath = (process.env.PROTECTED_BUNDLE_PATH || '').trim();

  // FAIL-CLOSED (opt-in) : quand REQUIRE_PROTECTED_BUNDLE est actif, on REFUSE de
  // fabriquer le bundle depuis `git archive HEAD` (= code source PROPRE) si le
  // bundle durci est absent/illisible — sinon une plateforme de prod mal câblée
  // livrerait tout le code source au revendeur. Sans ce flag, comportement
  // historique conservé (repli git archive) pour le dev/les instances mères.
  const requireProtected = /^(1|true|yes|on)$/i.test(
    (process.env.REQUIRE_PROTECTED_BUNDLE || '').trim()
  );
  const refuseSource = () =>
    Promise.reject(
      Object.assign(
        new Error(
          'Bundle durci exigé (REQUIRE_PROTECTED_BUNDLE) mais indisponible — refus de servir le code source.'
        ),
        { code: 'PROTECTED_BUNDLE_UNAVAILABLE' }
      )
    );

  if (protectedPath) {
    try {
      const mtimeMs = fs.statSync(protectedPath).mtimeMs;
      // Cache invalidé si le fichier a changé (re-fabrication du bundle) → pas
      // besoin de redémarrer l'API après un nouveau build-protected-bundle.sh.
      if (_bundleCache && _bundleCache.protectedMtime === mtimeMs && !fresh) {
        return Promise.resolve(_bundleCache);
      }
      const buf = fs.readFileSync(protectedPath);
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      _bundleCache = { buffer: buf, sha256, builtAt: Date.now(), protectedMtime: mtimeMs };
      log.info('provision', 'Bundle durci servi (pré-fabriqué)', {
        sizeMB: (buf.length / 1048576).toFixed(1),
        sha256: sha256.slice(0, 12),
      });
      return Promise.resolve(_bundleCache);
    } catch (e) {
      if (requireProtected) {
        log.error('provision', 'Bundle durci EXIGÉ mais illisible — refus (pas de repli source)', {
          path: protectedPath,
          err: e.message,
        });
        return refuseSource();
      }
      log.warn('provision', 'Bundle durci illisible — repli git archive', {
        path: protectedPath,
        err: e.message,
      });
    }
  } else if (requireProtected) {
    log.error(
      'provision',
      'REQUIRE_PROTECTED_BUNDLE actif mais PROTECTED_BUNDLE_PATH non défini — refus (pas de repli source)'
    );
    return refuseSource();
  }

  const { execFile } = require('child_process');
  // -c safe.directory : /repo est monté root:root, le process node tourne en
  // user applicatif → git refuserait le repo sans ça ("dubious ownership").
  const args = [
    '-C',
    REPO_DIR,
    '-c',
    `safe.directory=${REPO_DIR}`,
    'archive',
    '--format=tar',
    '--prefix=./',
    'HEAD',
    '--',
    '.',
    ...BUNDLE_GIT_EXCLUDES,
  ];
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          log.error('provision', 'Construction du bundle échouée', { err: err.message });
          return reject(err);
        }
        const buffer = zlib.gzipSync(stdout, { level: 9 });
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        _bundleCache = { buffer, sha256, builtAt: Date.now() };
        log.info('provision', 'Bundle produit construit (git archive HEAD)', {
          sizeMB: (buffer.length / 1048576).toFixed(1),
          sha256: sha256.slice(0, 12),
        });
        resolve(_bundleCache);
      }
    );
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
 * @param {object} server  ligne `servers`
 * @param {object} opts    { req }  (req sert à reconstruire PLATFORM_BASE)
 * @returns {Promise<{ script: string, sha256: string }>}
 */
async function renderBootstrap(server, { req } = {}) {
  const templatePath = path.join(SCRIPT_DIR, 'wg-fux-bootstrap.sh');
  const template = fs.readFileSync(templatePath, 'utf8');
  const base = platformBase(req);

  // Bundle depuis le CACHE (même buffer que servira /bundle.tgz) : le sha injecté
  // ici doit correspondre exactement à l'archive téléchargée par le VPS.
  const { sha256: bundleSha256 } = await buildBundleTarball();

  // Pin TLS propagé au bootstrap : le téléchargement du bundle ET le callback
  // /ready bénéficient du même épinglage de clé publique que le fetch du script
  // (défense en profondeur — le sha256 du bundle protège déjà l'intégrité, le
  // pin ferme le canal contre un MITM à CA compromise). Vide = pas de pin.
  const tlsPin = (process.env.TLS_PINNED_PUBKEY || '').trim();
  // Clé PUBLIQUE de signature de licence de la mère (base64 DER SPKI). Injectée
  // dans l'instance → elle vérifiera les grants signés. Vide si la mère ne signe
  // pas (rétro-compat : l'instance reste en mode legacy). Voir services/licenseSign.js.
  const licensePubkey = (process.env.LICENSE_SIGNING_PUBKEY || '').trim();
  const replacements = {
    '{{PLATFORM_BASE}}': base,
    '{{BUNDLE_SHA256}}': bundleSha256,
    '{{LICENSE_KEY}}': server.licenseKey || '',
    '{{TLS_PIN}}': tlsPin,
    '{{LICENSE_PUBKEY}}': licensePubkey,
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
  return { script, sha256 };
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
// GET /provision/:token/bundle.tgz — archive du produit complet. TOKEN-GATÉ :
// le code n'est jamais distribué sans token de provisioning valide (repo privé).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:token/bundle.tgz', async (req, res, next) => {
  try {
    const server = await findServerByToken(req.params.token);
    if (!server) {
      return res.status(404).type('text/plain').send('Not found\n');
    }
    const { buffer } = await buildBundleTarball();
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="wg-fux-bundle.tgz"');
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

    // Le bootstrap envoie l'IP publique du VPS détectée après setup.sh.
    const { host } = req.body || {};

    const updateData = {
      status: 'online',
      consecutiveFailures: 0,
      lastChecked: new Date(),
      lastError: null,
      // Consomme le token (usage unique).
      provisionTokenHash: null,
      provisionTokenExpiry: null,
    };
    // Met à jour l'IP si le VPS la rapporte et qu'elle est valide (IPv4, IPv6
    // ou hostname RFC1123) — un VPS compromis ne doit pas pouvoir injecter une
    // valeur arbitraire dans cette colonne via le callback de provisioning.
    const HOST_RE =
      /^(\d{1,3}(\.\d{1,3}){3}|[a-fA-F0-9:]+|[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/;
    if (host && typeof host === 'string' && HOST_RE.test(host.trim()) && host.trim().length <= 255) {
      updateData.host = host.trim();
    }

    await db.update(schema.servers).set(updateData).where(eq(schema.servers.id, server.id));

    await auditLog({
      actor: 'system',
      action: 'server_online',
      targetType: 'server',
      targetName: server.label,
      details: { serverId: server.id, host: (host || server.host) },
    });

    log.info('provision', 'Serveur promu online (callback reçu)', {
      serverId: server.id,
      host: host || server.host,
    });

    return res.json({ status: 'online', serverId: server.id });
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
module.exports.buildBundleTarball = buildBundleTarball;
module.exports.findServerByToken = findServerByToken;
module.exports.verifyServer = verifyServer;
module.exports.SCRIPTS_VERSION = SCRIPTS_VERSION;
module.exports._resetTarballCache = () => {
  _tarballCache = null;
  _bundleCache = null;
};
