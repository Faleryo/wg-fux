// middleware/resolveServer.js — Résout req.server + req.serverId pour les routes
// revendeur. Voir spec socle SSH (2026-06-27) section 3.7.
//
// Règle de tenance : admin/manager s'exécutent en LOCAL (pas de serveur requis).
// Un revendeur DOIT fournir l'en-tête `x-server-id`, et ce serveur doit lui
// appartenir (ownerId === req.user.id), sinon 403 (anti cross-tenant).

const { db, schema } = require('../../db');
const { eq, and } = require('drizzle-orm');

async function resolveServer(req, res, next) {
  // Admin / manager : exécution locale, aucun serveur distant à résoudre.
  if (!req.user || req.user.role === 'admin' || req.user.role === 'manager') {
    return next();
  }

  const serverId = parseInt(req.headers['x-server-id'], 10);
  if (!Number.isInteger(serverId)) {
    return res.status(400).json({ error: 'En-tête x-server-id manquant ou invalide' });
  }

  try {
    const [server] = await db
      .select()
      .from(schema.servers)
      .where(and(eq(schema.servers.id, serverId), eq(schema.servers.ownerId, req.user.id)))
      .limit(1);

    if (!server) {
      // Le serveur n'existe pas OU n'appartient pas au revendeur : même réponse
      // (pas de fuite d'existence cross-tenant).
      return res.status(403).json({ error: 'Serveur inaccessible ou non propriété du revendeur' });
    }

    req.serverId = serverId;
    req.server = server;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = resolveServer;
