// routes/license.js — Endpoint PUBLIC de validation de licence (côté plateforme).
//
// Monté sous /license SANS auth JWT : la clé de licence EST l'authentification
// (256 bits, générée à l'enregistrement du serveur, transmise au VPS via le
// bootstrap token-gaté). Les instances revendeurs phone-home ici toutes les 6h.
//
// C'est aussi le signal de VIE des instances autonomes (lastHeartbeat) : le job
// serverHeartbeat de la plateforme s'en sert pour l'état online/offline.

const express = require('express');
const router = express.Router();

const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');
const log = require('../services/logger');
const { asyncWrap } = require('../utils/errors');

router.post(
  '/heartbeat',
  express.json(),
  asyncWrap(async (req, res) => {
    const { key, version, clients } = req.body || {};
    if (!key || typeof key !== 'string' || key.length < 16) {
      return res.status(401).json({ valid: false, error: 'Clé de licence invalide' });
    }

    const [server] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.licenseKey, key))
      .limit(1);

    // Réponse de forme constante : pas de fuite sur l'existence de la clé.
    if (!server) {
      return res.status(401).json({ valid: false, error: 'Clé de licence invalide' });
    }

    const expiry = server.licenseExpiry ? new Date(server.licenseExpiry).getTime() : 0;
    const valid = Boolean(expiry && Date.now() < expiry);

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

    res.json({
      valid,
      expiresAt: server.licenseExpiry ? new Date(server.licenseExpiry).toISOString() : null,
    });
  })
);

module.exports = router;
