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

  try {
    const res = await fetch(`${platformUrl()}/license/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: licenseKey(),
        version: require('../../package.json').version,
        clients: clientCount,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    saveState({
      valid: Boolean(data.valid),
      expiresAt: data.expiresAt || null,
      latestVersion: data.latestVersion || null,
      // Palier de licence : plafond de clients (null = illimité), appliqué ici.
      maxClients: Number.isInteger(data.maxClients) ? data.maxClients : null,
      // White-label poussé par la plateforme (nom/logo/couleur du revendeur).
      brand: data.brand && typeof data.brand === 'object' ? data.brand : null,
      // Comment payer : contact WhatsApp/Telegram + instructions (affiché par
      // l'UI de l'instance quand la licence expire — vente manuelle sans Stripe).
      reseller: data.reseller && typeof data.reseller === 'object' ? data.reseller : null,
      lastCheckOk: Date.now(),
      firstFailure: null,
    });
    if (!data.valid) {
      log.warn('license', 'Licence invalide/expirée — création de clients bloquée', {
        expiresAt: data.expiresAt,
      });
    }
    return { valid: Boolean(data.valid), expiresAt: data.expiresAt };
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
function isLicensed() {
  // Clé absente : instance mère (jamais licenciée) = tout permis ; instance
  // DÉJÀ licenciée dont la clé a disparu = sabotage → traitée comme expirée.
  if (!licenseEnabled()) return !isLocked();
  const s = loadState();
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

module.exports = { checkLicenseNow, isLicensed, licenseStatus, licenseEnabled, clientLimit };
