// middleware/resolveServer.js — Résout req.server + req.serverId à partir de
// l'en-tête `x-server-id`. Voir spec socle SSH (2026-06-27) section 3.7.
//
// Sémantique :
//   - Pas d'en-tête (ou 'local'/'') → contexte LOCAL pour TOUT utilisateur
//     authentifié. Depuis le pivot "instance complète" (2026-07-03), un
//     revendeur travaille en local — sur son instance comme sur la mère — et
//     la tenance est garantie par le scoping propriétaire des routes
//     (containers.owner === username dans clients.js). L'ancien 400
//     "x-server-id requis" rendait le rôle reseller inutilisable sur une
//     instance (dashboard vide, création client impossible).
//   - En-tête présent → on résout le serveur AVEC contrôle de propriété :
//       admin/manager  : n'importe quel serveur (gèrent tout le parc) ;
//       revendeur      : uniquement les siens (ownerId === req.user.id), sinon 403.
//   - L'exécuteur (resolveExecutor) choisira SSH dès que req.serverId est posé,
//     quel que soit le rôle. C'est ici qu'on garantit la tenance.

const { db, schema } = require('../../db');
const { eq, and } = require('drizzle-orm');

function isAdminLike(user) {
  return user && (user.role === 'admin' || user.role === 'manager');
}

async function resolveServer(req, res, next) {
  const raw = req.headers['x-server-id'];

  // Pas de cible distante explicite → contexte local (tout rôle authentifié ;
  // le scoping propriétaire des routes fait la tenance).
  if (raw === undefined || raw === '' || raw === 'local') {
    return next();
  }

  const serverId = parseInt(raw, 10);
  if (!Number.isInteger(serverId)) {
    return res.status(400).json({ error: 'En-tête x-server-id invalide' });
  }

  try {
    // Contrôle de propriété : admin/manager voient tout, revendeur seulement les siens.
    const where = isAdminLike(req.user)
      ? eq(schema.servers.id, serverId)
      : and(eq(schema.servers.id, serverId), eq(schema.servers.ownerId, req.user.id));

    const [server] = await db.select().from(schema.servers).where(where).limit(1);
    if (!server) {
      // Inexistant OU non autorisé : même réponse (pas de fuite d'existence cross-tenant).
      return res.status(403).json({ error: 'Serveur inaccessible ou non autorisé' });
    }

    req.serverId = serverId;
    req.server = server;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = resolveServer;
