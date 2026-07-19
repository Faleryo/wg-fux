// services/license.js — Licence d'instance revendeur (côté VPS installé).
//
// Chaque instance wg-fux installée via le one-liner reçoit une clé de licence
// (WG_FUX_LICENSE_KEY) et l'URL de la plateforme mère (WG_FUX_PLATFORM_URL).
// L'instance phone-home périodiquement ; la plateforme répond { valid, expiresAt }.
//
// Règles :
//  - Pas de clé configurée  → licence DÉSACTIVÉE (instance mère / auto-hébergée) :
//    tout est autorisé. La plateforme elle-même tourne ainsi.
//  - Plateforme injoignable → période de grâce de 7 jours après le dernier
//    check réussi (pas de prise d'otage sur un incident réseau).
//  - Licence expirée        → SEULE la création de clients/containers est bloquée.
//    Les clients existants continuent de fonctionner (jamais de coupure VPN).

const fs = require('fs');
const path = require('path');
const log = require('./logger');
const licenseSign = require('./licenseSign');

// Lues dynamiquement (pas figées au chargement) : permet de détecter une clé
// retirée à chaud et rend le module testable sans rechargement.
const licenseKey = () => (process.env.WG_FUX_LICENSE_KEY || '').trim();
const platformUrl = () => (process.env.WG_FUX_PLATFORM_URL || '').trim().replace(/\/+$/, '');
const GRACE_MS = 7 * 24 * 3600 * 1000; // 7 jours de grâce si plateforme injoignable

const STATE_PATH =
  process.env.LICENSE_STATE_PATH || path.join(__dirname, '../../data/license-state.json');

// État en mémoire (miroir du fichier). null = jamais chargé.
let state = null;

const licenseEnabled = () => Boolean(licenseKey() && platformUrl());

// ── Verrou anti-sabotage ─────────────────────────────────────────────────────
// Une instance qui a déjà tourné SOUS LICENCE est marquée en base (app_settings
// 'license_locked'). Si la clé disparaît ensuite de l'env (client root qui
// l'efface pour échapper à la facturation), l'instance est traitée comme
// EXPIRÉE (création bloquée, VPN intact) — et non comme une instance mère
// illimitée. Statements paresseux : la table existe après initializeDatabase().
let _lockStmts = null;
function lockStmts() {
  if (!_lockStmts) {
    const { sqlite } = require('../../db');
    _lockStmts = {
      get: sqlite.prepare("SELECT value FROM app_settings WHERE key = 'license_locked'"),
      set: sqlite.prepare(
        "INSERT INTO app_settings (key, value, secret) VALUES ('license_locked', '1', 0) " +
          'ON CONFLICT(key) DO NOTHING'
      ),
    };
  }
  return _lockStmts;
}
function isLocked() {
  try {
    return Boolean(lockStmts().get.get());
  } catch {
    return false; // DB pas prête : ne jamais bloquer le boot pour ça
  }
}
function lockLicense() {
  try {
    lockStmts().set.run();
  } catch {
    /* DB pas prête : re-tenté au prochain check (6h) */
  }
}

function loadState() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    state = { valid: true, expiresAt: null, lastCheckOk: null, firstFailure: null };
  }
  return state;
}

function saveState(next) {
  state = next;
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(next), { mode: 0o600 });
  } catch (e) {
    log.warn('license', 'Impossible de persister license-state.json', { err: e.message });
  }
}

/**
 * Phone-home vers la plateforme. Appelé au boot puis toutes les 6h (jobs.js).
 * Met à jour l'état local ; ne lève jamais (le réseau ne doit pas tuer l'API).
 */
async function checkLicenseNow() {
  if (!licenseEnabled()) return { valid: true, disabled: true };
  // Marque durablement l'instance comme licenciée (voir verrou anti-sabotage).
  lockLicense();

  // Télémétrie légère : version + nb de clients (tarification par palier).
  let clientCount = 0;
  try {
    const { db, schema } = require('../../db');
    const { sql } = require('drizzle-orm');
    const [row] = await db.select({ n: sql`count(*)` }).from(schema.clients);
    clientCount = Number(row?.n) || 0;
  } catch {
    /* db pas prête : tant pis pour la télémétrie */
  }

  // Télémétrie machine (CPU/RAM/disque/uptime) pour la supervision de flotte
  // côté plateforme. Best-effort : jamais bloquant pour le heartbeat.
  let machine = {};
  try {
    const os = require('os');
    const { getSystemStats } = require('./system');
    const st = await getSystemStats();
    machine = {
      cpu: parseFloat(st.cpu),
      mem: parseFloat(st.memory),
      disk: parseFloat(st.disk),
      uptime: Math.round(os.uptime()),
    };
  } catch {
    /* pas de télémétrie machine cette fois */
  }

  try {
    const res = await fetch(`${platformUrl()}/license/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: licenseKey(),
        version: require('../../package.json').version,
        clients: clientCount,
        ...machine,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Mode DURCI (une pubkey est provisionnée) : la réponse DOIT porter un grant
    // signé par la mère, lié à CETTE clé de licence. Sinon on refuse d'y croire —
    // on ne remplace pas un état sain par un `valid` non prouvé (fail-closed, la
    // grâce joue le temps de résoudre le souci). Empêche fausse mère / réponse forgée.
    let grant = null;
    let grantSig = null;
    if (licenseSign.verificationEnabled()) {
      const lg = data.licenseGrant;
      const ok =
        lg &&
        licenseSign.verifyGrant(lg.grant, lg.sig) &&
        lg.grant.keyId === licenseSign.keyIdFor(licenseKey());
      if (!ok) {
        log.error('license', 'Grant de licence absent/invalide — réponse rejetée (anti-forge)');
        const prev = loadState();
        saveState({ ...prev, firstFailure: prev.firstFailure || Date.now() });
        return { valid: isLicensed(), untrusted: true };
      }
      grant = lg.grant;
      grantSig = lg.sig;
    }

    // Les champs SIGNÉS (grant) priment sur les champs bruts quand ils existent.
    saveState({
      valid: grant ? Boolean(grant.valid) : Boolean(data.valid),
      expiresAt: grant ? grant.expiresAt || null : data.expiresAt || null,
      latestVersion: data.latestVersion || null,
      // Palier de licence : plafond de clients (null = illimité), appliqué ici.
      maxClients: grant
        ? Number.isInteger(grant.maxClients)
          ? grant.maxClients
          : null
        : Number.isInteger(data.maxClients)
          ? data.maxClients
          : null,
      // White-label poussé par la plateforme (nom/logo/couleur du revendeur).
      brand: data.brand && typeof data.brand === 'object' ? data.brand : null,
      // Comment payer : contact WhatsApp/Telegram + instructions (affiché par
      // l'UI de l'instance quand la licence expire — vente manuelle sans Stripe).
      reseller: data.reseller && typeof data.reseller === 'object' ? data.reseller : null,
      // Grant signé conservé : re-vérifié par isLicensed() pour la grâce hors-ligne.
      grant,
      grantSig,
      lastCheckOk: Date.now(),
      firstFailure: null,
    });
    const effectiveValid = grant ? Boolean(grant.valid) : Boolean(data.valid);
    if (!effectiveValid) {
      log.warn('license', 'Licence invalide/expirée — création de clients bloquée', {
        expiresAt: grant ? grant.expiresAt : data.expiresAt,
      });
    }
    return { valid: effectiveValid, expiresAt: grant ? grant.expiresAt : data.expiresAt };
  } catch (e) {
    const prev = loadState();
    const firstFailure = prev.firstFailure || Date.now();
    saveState({ ...prev, firstFailure });
    log.warn('license', 'Plateforme injoignable — période de grâce', { err: e.message });
    return { valid: isLicensed(), unreachable: true };
  }
}

/**
 * Lecture synchrone de l'état (jamais de réseau ici — utilisé dans les routes).
 */
// Mode DURCI : la validité s'appuie sur un grant SIGNÉ re-vérifié (pas un booléen
// éditable). Un revendeur root qui édite license-state.json (valid:true, expiry
// lointaine) ne passe plus : la signature ne colle plus.
function signedGrantAllows(s) {
  const g = s && s.grant;
  const sig = s && s.grantSig;
  if (!g || !sig) return false; // pas de grant prouvé → fail-closed
  if (!licenseSign.verifyGrant(g, sig)) return false; // signature invalide/altérée
  if (g.keyId !== licenseSign.keyIdFor(licenseKey())) return false; // grant d'une autre instance
  if (!g.valid) return false;
  // Fraîcheur : un grant plus vieux que la grâce n'est plus honoré, même signé
  // (empêche de rejouer indéfiniment un ancien grant valide en coupant le réseau).
  if (typeof g.issuedAt !== 'number' || Date.now() - g.issuedAt > GRACE_MS) return false;
  // Expiration SIGNÉE = source de vérité de la validité de la licence.
  if (g.expiresAt && Date.now() >= new Date(g.expiresAt).getTime()) return false;
  return true;
}

function isLicensed() {
  // Clé absente : instance mère (jamais licenciée) = tout permis ; instance
  // DÉJÀ licenciée dont la clé a disparu = sabotage → traitée comme expirée.
  if (!licenseEnabled()) return !isLocked();
  const s = loadState();

  // Mode DURCI (pubkey provisionnée) : décision fondée sur le grant signé.
  if (licenseSign.verificationEnabled()) return signedGrantAllows(s);

  // Mode LEGACY (pas de pubkey) : comportement historique inchangé.
  // La dernière réponse EXPLICITE de la plateforme fait foi.
  if (s.lastCheckOk) {
    if (!s.valid) return false;
    // Dernière réponse valide ; silence réseau prolongé → grâce de 7 jours.
    if (!s.firstFailure) return true;
    return Date.now() - s.firstFailure < GRACE_MS;
  }
  // Jamais réussi à joindre la plateforme : grâce depuis le 1er échec.
  const ref = s.firstFailure || Date.now();
  return Date.now() - ref < GRACE_MS;
}

// Marqueurs de déploiement partagés avec wg-self-update.sh (même dossier data) :
// update-pending.json (écrit par le script root) / update-confirmed (écrit ici
// quand l'opérateur clique « Installer maintenant »).
const PENDING_PATH = path.join(path.dirname(STATE_PATH), 'update-pending.json');
const CONFIRMED_PATH = path.join(path.dirname(STATE_PATH), 'update-confirmed');
// update-status.json — écrit par wg-self-update.sh (root, hôte) à chaque phase
// de l'installation ({ phase, version, at, message? }) pour que l'UI affiche la
// progression en direct. On l'écrit aussi ici (phase 'queued') dès la
// confirmation, avant que le cron ne prenne la main (jusqu'à 1 min de latence).
const STATUS_PATH = path.join(path.dirname(STATE_PATH), 'update-status.json');

// Phases actives (installation en cours) vs terminales.
const ACTIVE_PHASES = new Set(['queued', 'downloading', 'verifying', 'building', 'restarting']);
// Un statut terminal reste affichable un court moment, un statut actif « coincé »
// (script mort avant d'écrire done/failed) est requalifié en échec pour ne pas
// laisser un spinner tourner indéfiniment.
const STATUS_DONE_TTL_MS = 15 * 60 * 1000;
const STATUS_FAILED_TTL_MS = 60 * 60 * 1000;
const STATUS_STUCK_MS = 30 * 60 * 1000;

function updateStatus() {
  let s;
  try {
    s = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  } catch {
    return null;
  }
  if (!s || typeof s.phase !== 'string') return null;
  const atMs = Number.isInteger(s.at) ? s.at * 1000 : null; // epoch s → ms
  const ageMs = atMs ? Date.now() - atMs : 0;
  let phase = s.phase;
  // Requalifie un statut actif trop vieux (le script a probablement échoué sans
  // écrire 'failed', ex. kill/OOM pendant le rebuild) → échec affichable.
  if (ACTIVE_PHASES.has(phase) && ageMs > STATUS_STUCK_MS) phase = 'failed';
  // Expire les statuts terminaux pour ne pas ré-afficher une vieille maj.
  if (phase === 'done' && ageMs > STATUS_DONE_TTL_MS) return null;
  if (phase === 'failed' && ageMs > STATUS_FAILED_TTL_MS) return null;
  return {
    phase,
    version: typeof s.version === 'string' ? s.version : null,
    at: atMs,
    message: typeof s.message === 'string' ? s.message.slice(0, 200) : null,
    active: ACTIVE_PHASES.has(phase),
  };
}

function pendingUpdate() {
  try {
    const p = JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
    if (!p || !p.version) return null;
    let confirmed = false;
    try {
      confirmed = fs.readFileSync(CONFIRMED_PATH, 'utf8').includes(p.version);
    } catch {
      /* pas encore confirmé */
    }
    return {
      version: p.version,
      mode: p.mode === 'instant' ? 'instant' : 'auto',
      applyAt: Number.isInteger(p.applyAt) ? p.applyAt * 1000 : null, // → ms
      confirmed,
    };
  } catch {
    return null;
  }
}

// Confirme l'installation de la maj en attente (opérateur de l'instance).
// Le cron (1 min) la voit et lance wg-self-update. Renvoie la version, ou null.
function confirmPendingUpdate() {
  const p = pendingUpdate();
  if (!p) return null;
  fs.writeFileSync(CONFIRMED_PATH, p.version, { mode: 0o644 });
  // Statut initial : l'UI affiche « en file d'attente » immédiatement, sans
  // attendre que le cron (≤ 1 min) lance le script et écrive 'downloading'.
  try {
    fs.writeFileSync(
      STATUS_PATH,
      JSON.stringify({
        phase: 'queued',
        version: p.version,
        at: Math.floor(Date.now() / 1000),
      }),
      { mode: 0o644 }
    );
  } catch {
    /* le script écrira le statut de toute façon */
  }
  return p.version;
}

function licenseStatus() {
  const s = loadState();
  let currentVersion = '0.0.0';
  try {
    currentVersion = require('../../package.json').version;
  } catch {
    /* ignore */
  }
  const latestVersion = s.latestVersion || null;
  const tampered = !licenseEnabled() && isLocked();
  return {
    // "enabled" reste vrai pour une instance sabotée : l'UI doit afficher le
    // bandeau licence (expirée), pas se croire sur une instance mère.
    enabled: licenseEnabled() || tampered,
    tampered,
    valid: isLicensed(),
    expiresAt: s.expiresAt,
    lastCheckOk: s.lastCheckOk,
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(latestVersion && latestVersion !== currentVersion),
    maxClients: Number.isInteger(s.maxClients) ? s.maxClients : null,
    brand: s.brand || null,
    // Contact de paiement de la plateforme (renouvellement manuel sans Stripe).
    reseller: s.reseller || null,
    // Déploiement gouverné : maj en attente sur CETTE instance (bandeau UI).
    pendingUpdate: pendingUpdate(),
    // Progression de l'installation en cours (spinner + phase dans l'UI).
    updateStatus: updateStatus(),
  };
}

/**
 * Plafond de clients du palier de licence. null = illimité (dont instance mère).
 */
function clientLimit() {
  if (!licenseEnabled()) return null;
  const s = loadState();
  return Number.isInteger(s.maxClients) ? s.maxClients : null;
}

module.exports = {
  checkLicenseNow,
  isLicensed,
  licenseStatus,
  licenseEnabled,
  clientLimit,
  pendingUpdate,
  confirmPendingUpdate,
  updateStatus,
};
