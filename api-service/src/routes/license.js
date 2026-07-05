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

// Déploiement GOUVERNÉ : une mise à jour n'est offerte à une instance que si
// l'admin l'a explicitement approuvée (servers.targetVersion == version
// courante de la plateforme, posée par POST /api/servers/push-update). Une
// release ultérieure invalide l'approbation (l'admin ré-approuve). Le canal
// 'hold' et le kill-switch global update_paused priment toujours.
async function offeredVersionFor(server) {
  if (server.targetVersion !== APP_VERSION) return null;
  if (server.updateChannel === 'hold') return null;
  try {
    const paused = await require('../services/settings').getSetting('update_paused');
    if (paused === '1' || paused === 'true') return null;
  } catch {
    return null; // réglage illisible : on n'offre pas de maj par prudence
  }
  return APP_VERSION;
}

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
    const { version, clients, cpu, mem, disk, uptime } = req.body || {};
    const resolved = await resolveLicense(extractKey(req));

    // Réponse de forme constante : pas de fuite sur l'existence de la clé.
    if (!resolved) {
      return res.status(401).json({ valid: false, error: 'Clé de licence invalide' });
    }
    const { server, valid } = resolved;

    // Télémétrie machine (optionnelle : agents antérieurs ne l'envoient pas).
    // Bornée à [0,100] pour les pourcentages, entier ≥ 0 pour l'uptime.
    const pct = (v) => (typeof v === 'number' && v >= 0 && v <= 100 ? Math.round(v * 10) / 10 : null);
    const cpuPct = pct(cpu);
    const memPct = pct(mem);
    const diskPct = pct(disk);
    const uptimeSec = Number.isInteger(uptime) && uptime >= 0 ? uptime : null;
    const now = new Date();
    const clientCount =
      Number.isInteger(clients) && clients >= 0 ? clients : server.clientCount;

    await db
      .update(schema.servers)
      .set({
        lastHeartbeat: now,
        status: 'online', // le phone-home prouve que l'instance tourne
        consecutiveFailures: 0,
        lastError: null,
        clientCount,
        scriptsVersion: typeof version === 'string' ? version.slice(0, 32) : server.scriptsVersion,
        ...(cpuPct !== null ? { cpuPct } : {}),
        ...(memPct !== null ? { memPct } : {}),
        ...(diskPct !== null ? { diskPct } : {}),
        ...(uptimeSec !== null ? { uptimeSec } : {}),
        ...(cpuPct !== null || memPct !== null || diskPct !== null ? { healthAt: now } : {}),
      })
      .where(eq(schema.servers.id, server.id));

    // Point d'historique de santé (courbe uptime + charge). Best-effort.
    db.insert(schema.serverHealthHistory)
      .values({ serverId: server.id, ts: now, status: 'online', cpuPct, memPct, diskPct, clientCount })
      .catch(() => {});

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

    // Mise à jour de flotte GOUVERNÉE : rien n'est offert sans approbation
    // explicite de l'admin (targetVersion), voir offeredVersionFor().
    const offeredVersion = await offeredVersionFor(server);

    // White-label : la marque résolue du propriétaire (plus proche ancêtre) est
    // poussée à l'instance, qui habille son UI avec (nom, logo, couleur).
    let brand = null;
    try {
      brand = await require('../services/brand').resolveBrand(server.ownerId);
    } catch {
      /* non bloquant */
    }

    res.json({
      valid,
      expiresAt: server.licenseExpiry ? new Date(server.licenseExpiry).toISOString() : null,
      // L'instance compare à sa propre version pour décider d'une mise à jour.
      latestVersion: offeredVersion,
      // Palier de licence : plafond de clients appliqué PAR l'instance (null = illimité).
      maxClients: Number.isInteger(server.maxClients) ? server.maxClients : null,
      brand,
      reseller,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /license/update-check — sonde ULTRA-LÉGÈRE du déploiement gouverné.
// L'instance l'appelle chaque minute (cron) : { offeredVersion } (null = rien).
// Sert aussi de signal de vie fin (lastHeartbeat rafraîchi) → un push depuis la
// modale Déployer s'applique en ≤ 1-2 min, sans télécharger le moindre bundle.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/update-check',
  asyncWrap(async (req, res) => {
    const resolved = await resolveLicense(extractKey(req));
    if (!resolved) {
      return res.status(401).json({ error: 'Clé de licence invalide' });
    }
    if (!resolved.valid) {
      return res.status(402).json({ offeredVersion: null, error: 'Licence expirée' });
    }

    // Signal de vie (pas de télémétrie ici — le heartbeat 6h reste la source
    // riche : version, clients, brand…).
    await db
      .update(schema.servers)
      .set({ lastHeartbeat: new Date(), status: 'online', consecutiveFailures: 0 })
      .where(eq(schema.servers.id, resolved.server.id));

    const offeredVersion = await offeredVersionFor(resolved.server);
    res.json({
      offeredVersion,
      // 'instant' = à installer tout de suite (l'opérateur de l'instance
      // confirme) ; 'auto' = le cron applique sous ~6 h sans intervention.
      mode: resolved.server.updateMode === 'instant' ? 'instant' : 'auto',
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

    // Déploiement gouverné : sans approbation admin pour CETTE instance,
    // aucun bundle n'est servi (204 → wg-self-update s'arrête proprement, et
    // on ne construit même pas le tarball).
    const offered = await offeredVersionFor(resolved.server);
    if (!offered) {
      log.info('license', 'Bundle refusé : aucune mise à jour approuvée pour cette instance', {
        serverId: resolved.server.id,
      });
      return res.status(204).end();
    }

    const { buildBundleTarball } = require('./provision');
    const { buffer, sha256 } = await buildBundleTarball();

    log.info('license', 'Bundle de mise à jour servi', { serverId: resolved.server.id });
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-WG-Fux-Version', APP_VERSION);
    // Intégrité : l'instance vérifie ce sha256 AVANT d'extraire/exécuter en root.
    res.setHeader('X-WG-Fux-Bundle-Sha256', sha256);
    res.setHeader('Content-Disposition', 'attachment; filename="wg-fux-bundle.tgz"');
    res.send(buffer);
  })
);

module.exports = router;
module.exports.APP_VERSION = APP_VERSION;
