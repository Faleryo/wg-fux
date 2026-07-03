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

const LICENSE_KEY = (process.env.WG_FUX_LICENSE_KEY || '').trim();
const PLATFORM_URL = (process.env.WG_FUX_PLATFORM_URL || '').trim().replace(/\/+$/, '');
const GRACE_MS = 7 * 24 * 3600 * 1000; // 7 jours de grâce si plateforme injoignable

const STATE_PATH =
  process.env.LICENSE_STATE_PATH || path.join(__dirname, '../../data/license-state.json');

// État en mémoire (miroir du fichier). null = jamais chargé.
let state = null;

const licenseEnabled = () => Boolean(LICENSE_KEY && PLATFORM_URL);

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
    const res = await fetch(`${PLATFORM_URL}/license/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: LICENSE_KEY,
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
  if (!licenseEnabled()) return true;
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
  return {
    enabled: licenseEnabled(),
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
