// routes/license.js — Endpoints PUBLICS de licence (côté plateforme).
//
// Montés sous /license SANS auth JWT : la clé de licence EST l'authentification
// (256 bits, générée à l'enregistrement du serveur, transmise au VPS via le
// bootstrap token-gaté). Les instances revendeurs phone-home ici toutes les 6h.
//
// C'est aussi le signal de VIE des instances autonomes (lastHeartbeat) : le job
// serverHeartbeat de la plateforme s'en sert pour l'état online/offline.
//
// Et c'est le canal de MISE À JOUR : GET /license/bundle.tgz (clé = auth) sert
// le dernier bundle produit — seules les instances à licence VALIDE l'obtiennent
// (les mises à jour sont un avantage abonné). Voir wg-self-update.sh côté VPS.

const express = require('express');
const router = express.Router();

const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');
const log = require('../services/logger');
const { asyncWrap } = require('../utils/errors');

// Version courante de la plateforme = version publiée aux instances (elles
// comparent avec la leur pour savoir s'il faut se mettre à jour).
const APP_VERSION = (() => {
  try {
    return require('../../package.json').version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

// Résout + valide une clé de licence. Renvoie { server, valid } ou null si la
// clé est absente/inconnue (réponse de forme constante côté appelant).
async function resolveLicense(key) {
  if (!key || typeof key !== 'string' || key.length < 16) return null;
  const [server] = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.licenseKey, key))
    .limit(1);
  if (!server) return null;
  const expiry = server.licenseExpiry ? new Date(server.licenseExpiry).getTime() : 0;
  return { server, valid: Boolean(expiry && Date.now() < expiry) };
}

// Clé de licence depuis le header Authorization: Bearer <key> OU le body.
function extractKey(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return (req.body && req.body.key) || '';
}

router.post(
  '/heartbeat',
  express.json(),
  asyncWrap(async (req, res) => {
    const { version, clients } = req.body || {};
    const resolved = await resolveLicense(extractKey(req));

    // Réponse de forme constante : pas de fuite sur l'existence de la clé.
    if (!resolved) {
      return res.status(401).json({ valid: false, error: 'Clé de licence invalide' });
    }
    const { server, valid } = resolved;

    await db
      .update(schema.servers)
      .set({
        lastHeartbeat: new Date(),
        status: 'online', // le phone-home prouve que l'instance tourne
        consecutiveFailures: 0,
        lastError: null,
        clientCount: Number.isInteger(clients) && clients >= 0 ? clients : server.clientCount,
        scriptsVersion: typeof version === 'string' ? version.slice(0, 32) : server.scriptsVersion,
      })
      .where(eq(schema.servers.id, server.id));

    log.info('license', 'Heartbeat instance', {
      serverId: server.id,
      valid,
      clients: clients ?? null,
    });

    // Contact de paiement (affiché par l'instance à son propriétaire pour renouveler).
    let reseller = null;
    try {
      reseller = await require('../services/settings').getResellerFacing();
    } catch {
      /* réglages absents : pas de contact — non bloquant */
    }

    res.json({
      valid,
      expiresAt: server.licenseExpiry ? new Date(server.licenseExpiry).toISOString() : null,
      // L'instance compare à sa propre version pour décider d'une mise à jour.
      latestVersion: APP_VERSION,
      reseller,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /license/bundle.tgz — dernier bundle produit, réservé aux licences VALIDES.
// Authorization: Bearer <licenseKey>. Une licence expirée reçoit 402 (Payment
// Required) : l'instance continue de tourner mais ne peut plus se mettre à jour.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/bundle.tgz',
  asyncWrap(async (req, res) => {
    const resolved = await resolveLicense(extractKey(req));
    if (!resolved) {
      return res.status(401).type('text/plain').send('Unauthorized\n');
    }
    if (!resolved.valid) {
      return res
        .status(402)
        .type('text/plain')
        .send('License expired — renew to receive updates.\n');
    }

    const { buildBundleTarball } = require('./provision');
    const { buffer } = await buildBundleTarball();

    log.info('license', 'Bundle de mise à jour servi', { serverId: resolved.server.id });
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-WG-Fux-Version', APP_VERSION);
    res.setHeader('Content-Disposition', 'attachment; filename="wg-fux-bundle.tgz"');
    res.send(buffer);
  })
);

module.exports = router;
module.exports.APP_VERSION = APP_VERSION;
