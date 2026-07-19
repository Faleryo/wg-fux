// services/serverProvision.js — Création d'un serveur revendeur + one-liner.
//
// Logique partagée entre la route HTTP (POST /api/servers) et le bot Telegram :
// génère la paire SSH, chiffre la clé privée, mint le token de provisioning
// (usage unique, TTL 10 min) + la clé de licence (essai 30 j), insère le serveur
// en 'pending' et renvoie le one-liner à coller sur le VPS.

const { db, schema, sqlite } = require('../../db');
const { encryptPrivateKey } = require('./crypto');
const { generateKeyPair, generateToken, hashToken } = require('./sshKeys');
const { renderBootstrap } = require('../routes/provision');
const { auditLog } = require('./audit');
const log = require('./logger');

const PROVISION_TOKEN_TTL_MS = 10 * 60 * 1000;
const LICENSE_TRIAL_MS = 30 * 24 * 3600 * 1000;
// Ré-enrôlement d'un host déjà vu : pas de nouvel essai gratuit, juste une
// fenêtre d'installation courte — la suite se paie en crédits.
const LICENSE_REENROLL_MS = 72 * 3600 * 1000;

// Anti-abus : 1 seul essai gratuit de 30 jours PAR HOST, à vie (supprimer puis
// recréer le serveur ne réinitialise pas le compteur). Statements paresseux :
// la table trial_grants n'existe qu'après initializeDatabase().
let _trialStmts = null;
function claimTrial(host, ownerId) {
  if (!_trialStmts) {
    _trialStmts = {
      insert: sqlite.prepare(
        'INSERT OR IGNORE INTO trial_grants (host, firstOwnerId) VALUES (?, ?)'
      ),
    };
  }
  // INSERT OR IGNORE : changes === 1 → premier enrôlement (essai accordé).
  return _trialStmts.insert.run(host.toLowerCase(), ownerId).changes > 0;
}

class ServerConflictError extends Error {}

// Construit le one-liner à partir du token, du sha256 du script et de la base.
//
// Durcissement (le VPS exécute du code root téléchargé — chaque garde compte) :
//   - `bash -c '...'` : force bash même si collé dans sh/dash (process
//     substitution, [[ ]] du bootstrap) → pas de comportement indéfini.
//   - `set -euo pipefail` + `umask 077` : abandon au moindre échec, fichiers
//     temporaires créés en 0600 (le script téléchargé n'est jamais lisible par
//     un autre utilisateur local).
//   - `command -v curl sha256sum` : échec explicite si un prérequis manque
//     (sinon la vérification d'intégrité serait silencieusement sautée).
//   - `--proto '=https' --tlsv1.2` + pin TLS optionnel : transport chiffré,
//     downgrade impossible, épinglage de clé publique si configuré.
//   - `[ -n "$WG_H" ]` : refuse de continuer si le hash attendu est vide
//     (fail-closed — jamais d'exécution non vérifiée).
//   - téléchargement dans un fichier temp 0600, sha256 RE-vérifié sur le fichier
//     exact qui sera exécuté (pas sur une variable), puis `bash <fichier>` : le
//     script est inspectable et le token passe par l'ENV, pas en argv.
//   - `HISTFILE réinitialisé` dans le sous-shell : le token de provisioning ne
//     fuit pas dans l'historique du shell appelant.
function buildOneLiner({ token, scriptSha256, base }) {
  const tlsPin = (process.env.TLS_PINNED_PUBKEY || '').trim();
  const pinFlag = tlsPin ? `--pinnedpubkey '${tlsPin}' ` : '';
  // Corps exécuté par `bash -c`. Guillemets DOUBLES dans le corps uniquement
  // (le corps est lui-même entre guillemets simples côté shell appelant).
  const body = [
    'set -euo pipefail',
    'umask 077',
    'command -v curl >/dev/null 2>&1 || { echo "curl requis" >&2; exit 1; }',
    'command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum requis" >&2; exit 1; }',
    '[ -n "$WG_H" ] || { echo "hash manquant" >&2; exit 1; }',
    'F=$(mktemp /tmp/wg-fux.XXXXXX.sh)',
    'trap \'rm -f "$F"\' EXIT',
    `curl --proto '=https' --tlsv1.2 ${pinFlag}-fsSL -o "$F" "${base}/provision/$WG_T/script"`,
    'printf \'%s  %s\\n\' "$WG_H" "$F" | sha256sum -c - >/dev/null',
    'bash "$F"',
  ].join('; ');
  // Le token passe par l'ENV du sous-shell (pas répété en argv d'exec) et
  // HISTFILE est neutralisé dans ce sous-shell.
  return `WG_T=${token} WG_H=${scriptSha256} bash -c 'unset HISTFILE; ${body}'`;
}

function platformBase(req) {
  const fromEnv = (process.env.PLATFORM_BASE_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers.host;
    if (host) return `${proto}://${host}`;
  }
  return 'https://localhost';
}

/**
 * Crée un serveur pour un propriétaire et renvoie le one-liner de provisioning.
 * @param {{ ownerId:number, label:string, host:string, port?:number, actor?:string, req?:object, ip?:string }} opts
 * @returns {Promise<{ serverId, oneLiner, scriptSha256, expiresAt, licenseExpiry }>}
 * @throws {ServerConflictError} si (owner, host, port) existe déjà
 */
async function createServer({ ownerId, label, host, port = 22, actor, req, ip }) {
  const { privateKey, publicKey } = generateKeyPair();
  const enc = encryptPrivateKey(privateKey);

  const token = generateToken();
  const provisionTokenHash = hashToken(token);
  const provisionTokenExpiry = new Date(Date.now() + PROVISION_TOKEN_TTL_MS);

  const licenseKey = generateToken();
  const isFirstTrial = claimTrial(host, ownerId);
  const licenseExpiry = new Date(
    Date.now() + (isFirstTrial ? LICENSE_TRIAL_MS : LICENSE_REENROLL_MS)
  );
  if (!isFirstTrial) {
    log.info('servers', 'Host déjà connu : ré-enrôlement sans nouvel essai gratuit', { host });
  }

  let inserted;
  try {
    [inserted] = await db
      .insert(schema.servers)
      .values({
        ownerId,
        label,
        host,
        port,
        sshUsername: 'wg-fux',
        encPrivateKey: enc.encPrivateKey,
        encKeyIv: enc.encKeyIv,
        encKeyAuth: enc.encKeyAuth,
        publicKey,
        status: 'pending',
        provisionTokenHash,
        provisionTokenExpiry,
        licenseKey,
        licenseExpiry,
      })
      .returning();
  } catch (dbErr) {
    if (dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE' || dbErr.message?.includes('UNIQUE constraint')) {
      throw new ServerConflictError(`Le serveur ${host}:${port} est déjà enregistré`);
    }
    throw dbErr;
  }

  const { sha256: scriptSha256 } = await renderBootstrap(inserted, { req });
  const oneLiner = buildOneLiner({ token, scriptSha256, base: platformBase(req) });

  await auditLog({
    actor: actor || 'system',
    action: 'create_server',
    targetType: 'server',
    targetName: label,
    details: { serverId: inserted.id, host, port, trial: isFirstTrial },
    ip,
  });
  log.info('servers', 'Serveur enregistré (pending)', { serverId: inserted.id });

  return {
    serverId: inserted.id,
    oneLiner,
    scriptSha256,
    expiresAt: provisionTokenExpiry.toISOString(),
    licenseExpiry: licenseExpiry.toISOString(),
    trial: isFirstTrial,
  };
}

/**
 * Régénère le one-liner de provisioning d'un serveur EXISTANT : nouveau token
 * usage-unique (TTL 10 min), licence et clé SSH inchangées. Sert quand le token
 * a expiré avant installation, ou pour ré-installer l'instance sur le VPS.
 * @param {object} server ligne complète de schema.servers
 * @param {{ actor?:string, req?:object, ip?:string }} opts
 */
async function reprovisionServer(server, { actor, req, ip } = {}) {
  const { eq } = require('drizzle-orm');
  const token = generateToken();
  const provisionTokenHash = hashToken(token);
  const provisionTokenExpiry = new Date(Date.now() + PROVISION_TOKEN_TTL_MS);

  await db
    .update(schema.servers)
    .set({ provisionTokenHash, provisionTokenExpiry })
    .where(eq(schema.servers.id, server.id));

  const { sha256: scriptSha256 } = await renderBootstrap(server, { req });
  const oneLiner = buildOneLiner({ token, scriptSha256, base: platformBase(req) });

  await auditLog({
    actor: actor || 'system',
    action: 'reprovision_server',
    targetType: 'server',
    targetName: server.label,
    details: { serverId: server.id, host: server.host },
    ip,
  });
  log.info('servers', 'One-liner de provisioning régénéré', { serverId: server.id });

  return {
    serverId: server.id,
    oneLiner,
    scriptSha256,
    expiresAt: provisionTokenExpiry.toISOString(),
  };
}

module.exports = {
  createServer,
  reprovisionServer,
  ServerConflictError,
  PROVISION_TOKEN_TTL_MS,
  LICENSE_TRIAL_MS,
  LICENSE_REENROLL_MS,
};
