// routes/servers.js — Gestion des VPS revendeurs (registre des cibles d'exécution).
//
// Monté sous /api/servers (APRÈS le middleware d'auth, comme les autres routes /api).
// Un revendeur (ou admin) enregistre son VPS ici et reçoit le one-liner de
// provisioning à coller dessus. Voir spec 2026-06-30 section 6.1.

const express = require('express');
const { z } = require('zod');
const router = express.Router();

const { db, schema } = require('../../db');
const { eq, and } = require('drizzle-orm');
const { auth, requireReseller } = require('../middleware/auth');
const { auditLog } = require('../services/audit');
const {
  createServer,
  reprovisionServer,
  ServerConflictError,
} = require('../services/serverProvision');
const { getExecutorForServer } = require('../services/executors');
const { asyncWrap, createError } = require('../utils/errors');

// Validation de la création d'un serveur. `host` accepte IPv4/IPv6/hostname ;
// on reste permissif mais borné (anti-injection : pas d'espaces/quotes).
const createServerSchema = z
  .object({
    label: z.string().min(1, 'Label requis').max(64, 'Label trop long'),
    host: z
      .string()
      .min(1, 'Host requis')
      .max(255, 'Host trop long')
      .regex(/^[a-zA-Z0-9.:_-]+$/, 'Host invalide (IPv4/IPv6/hostname attendu)'),
    port: z
      .union([z.number(), z.string()])
      .transform((v) => parseInt(v, 10))
      .refine((n) => Number.isInteger(n) && n > 0 && n < 65536, 'Port invalide')
      .optional(),
  })
  .strict();

// Version publiée par la plateforme (celle que les instances reçoivent au
// heartbeat) — sert à afficher "à jour / maj disponible" dans l'onglet Serveurs.
const PLATFORM_VERSION = require('../../package.json').version || '0.0.0';

// Projection publique d'un serveur : JAMAIS de clé privée / hash de token / IV.
// licenseKey n'est PAS exposée ici (credential de l'instance) — seulement à la création.
function publicServer(s, ownerUsername) {
  // scriptsVersion est réutilisé par le heartbeat licence pour stocker la
  // version de l'instance (routes/license.js) — même comparaison que
  // wg-self-update : différent de la version plateforme = maj disponible.
  const version = s.scriptsVersion || null;
  return {
    id: s.id,
    label: s.label,
    host: s.host,
    port: s.port,
    status: s.status,
    lastChecked: s.lastChecked,
    lastError: s.lastError,
    licenseExpiry: s.licenseExpiry,
    lastHeartbeat: s.lastHeartbeat,
    clientCount: s.clientCount,
    maxClients: s.maxClients ?? null,
    updateChannel: s.updateChannel || 'stable',
    scriptsVersion: s.scriptsVersion,
    version,
    updateAvailable: Boolean(version && version !== PLATFORM_VERSION),
    platformVersion: PLATFORM_VERSION,
    // Déploiement gouverné : l'admin a-t-il approuvé la version courante de la
    // plateforme pour cette instance ? (une approbation d'une release passée
    // est caduque et affichée comme absente)
    updateApproved: s.targetVersion === PLATFORM_VERSION,
    updateMode: s.updateMode || 'auto',
    createdAt: s.createdAt,
    owner: ownerUsername || undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/servers — enregistre un VPS et renvoie le one-liner de provisioning.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/',
  auth,
  // Créer un serveur mint un token de provisioning + une licence d'essai et
  // ouvre le téléchargement du bundle privé → réservé à admin/revendeur (un
  // viewer/manager ne doit pas pouvoir provisionner ni exfiltrer le bundle).
  requireReseller,
  asyncWrap(async (req, res) => {
    const parsed = createServerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation échouée'));
    }
    const { label, host } = parsed.data;
    const port = parsed.data.port || 22;

    try {
      const result = await createServer({
        ownerId: req.user.id,
        label,
        host,
        port,
        actor: req.user.username,
        req,
        ip: req.ip,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof ServerConflictError) {
        return res.status(409).json(createError(err.message, null, 'CONFLICT'));
      }
      throw err;
    }
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/servers — liste les serveurs du revendeur (admin voit tout).
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/',
  auth,
  asyncWrap(async (req, res) => {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'manager';
    const rows = isAdmin
      ? await db.select().from(schema.servers)
      : await db.select().from(schema.servers).where(eq(schema.servers.ownerId, req.user.id));

    // L'admin voit à qui appartient chaque serveur (vue flotte).
    let ownerById = new Map();
    if (isAdmin && rows.length > 0) {
      const owners = await db
        .select({ id: schema.users.id, username: schema.users.username })
        .from(schema.users);
      ownerById = new Map(owners.map((u) => [u.id, u.username]));
    }
    res.json(rows.map((s) => publicServer(s, isAdmin ? ownerById.get(s.ownerId) : undefined)));
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/servers/:id/one-liner — régénère le one-liner de provisioning
// (nouveau token usage-unique, TTL 10 min). Utile quand le token a expiré avant
// que le revendeur ait collé la commande, ou pour ré-installer une instance.
// Ownership : admin/manager tout, revendeur seulement les siens.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/:id/one-liner',
  auth,
  requireReseller,
  asyncWrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json(createError('Identifiant de serveur invalide'));
    }
    const isAdmin = req.user.role === 'admin' || req.user.role === 'manager';
    const where = isAdmin
      ? eq(schema.servers.id, id)
      : and(eq(schema.servers.id, id), eq(schema.servers.ownerId, req.user.id));
    const [server] = await db.select().from(schema.servers).where(where).limit(1);
    if (!server) {
      return res
        .status(404)
        .json(createError('Serveur introuvable ou non autorisé', null, 'NOT_FOUND'));
    }

    const result = await reprovisionServer(server, {
      actor: req.user.username,
      req,
      ip: req.ip,
    });
    res.json(result);
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/servers/:id — supprime si ownership OK.
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  '/:id',
  auth,
  asyncWrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json(createError('Identifiant de serveur invalide'));
    }

    const isAdmin = req.user.role === 'admin' || req.user.role === 'manager';
    const where = isAdmin
      ? eq(schema.servers.id, id)
      : and(eq(schema.servers.id, id), eq(schema.servers.ownerId, req.user.id));

    const [server] = await db.select().from(schema.servers).where(where).limit(1);
    if (!server) {
      return res
        .status(404)
        .json(createError('Serveur introuvable ou non autorisé', null, 'NOT_FOUND'));
    }

    await db.delete(schema.servers).where(eq(schema.servers.id, server.id));

    await auditLog({
      actor: req.user.username,
      action: 'delete_server',
      targetType: 'server',
      targetName: server.label,
      details: { serverId: server.id },
      ip: req.ip,
    });

    res.json({ success: true });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/servers/:id/uninstall — désinstalle wg-fux À DISTANCE sur le VPS
// (SSH → wg-fux-uninstall.sh : arrêt des conteneurs/volumes, nettoyage système)
// puis retire l'enregistrement. Action destructive et irréversible sur le VPS
// du revendeur — la confirmation forte se fait côté UI avant cet appel.
// Ownership : admin tout, revendeur seulement les siens.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/:id/uninstall',
  auth,
  requireReseller,
  asyncWrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json(createError('Identifiant de serveur invalide'));
    }
    const isAdmin = req.user.role === 'admin' || req.user.role === 'manager';
    const where = isAdmin
      ? eq(schema.servers.id, id)
      : and(eq(schema.servers.id, id), eq(schema.servers.ownerId, req.user.id));
    const [server] = await db.select().from(schema.servers).where(where).limit(1);
    if (!server) {
      return res
        .status(404)
        .json(createError('Serveur introuvable ou non autorisé', null, 'NOT_FOUND'));
    }

    const executor = await getExecutorForServer(server.id);
    const result = await executor.run('wg-uninstall.sh', []);
    if (!result.success) {
      return res.status(502).json(
        createError(
          `Désinstallation distante échouée : ${result.error || 'erreur inconnue'}`,
          null,
          'UNINSTALL_FAILED'
        )
      );
    }

    await db.delete(schema.servers).where(eq(schema.servers.id, server.id));

    await auditLog({
      actor: req.user.username,
      action: 'uninstall_server',
      targetType: 'server',
      targetName: server.label,
      details: { serverId: server.id, host: server.host },
      ip: req.ip,
    });

    res.json({ success: true });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/servers/push-update — déploiement GOUVERNÉ (admin uniquement).
// Approuve la version courante de la plateforme pour une sélection d'instances
// (ou toute la flotte) : elles la verront au prochain heartbeat / cron de maj.
// Body : { serverIds: [1,2] } OU { all: true } ; { clear: true } annule.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/push-update',
  auth,
  asyncWrap(async (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json(createError('Réservé à l’admin', null, 'FORBIDDEN'));
    }
    const { serverIds, all, clear, mode } = req.body || {};
    const value = clear === true ? null : PLATFORM_VERSION;
    // Mode de déploiement : 'auto' (défaut — le cron applique sous ~6 h) ou
    // 'instant' (offert tout de suite, l'opérateur de l'instance confirme).
    const updateMode = mode === 'instant' ? 'instant' : 'auto';

    let targetIds;
    if (all === true) {
      const rows = await db.select({ id: schema.servers.id }).from(schema.servers);
      targetIds = rows.map((r) => r.id);
    } else {
      if (!Array.isArray(serverIds) || serverIds.length === 0) {
        return res.status(400).json(createError('serverIds (liste) ou all:true requis'));
      }
      targetIds = serverIds.map((n) => parseInt(n, 10)).filter(Number.isInteger);
      if (targetIds.length === 0) {
        return res.status(400).json(createError('serverIds invalides'));
      }
    }

    if (targetIds.length > 0) {
      const { inArray } = require('drizzle-orm');
      await db
        .update(schema.servers)
        .set({ targetVersion: value, ...(clear === true ? {} : { updateMode }) })
        .where(inArray(schema.servers.id, targetIds));
    }

    await auditLog({
      actor: req.user.username,
      action: clear === true ? 'cancel_update' : 'push_update',
      targetType: 'server',
      targetName: all === true ? 'flotte' : targetIds.join(','),
      details: { version: value, count: targetIds.length, mode: updateMode },
      ip: req.ip,
    });

    res.json({
      success: true,
      version: value,
      count: targetIds.length,
      serverIds: targetIds,
      mode: updateMode,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/servers/:id/license — renouvelle la licence (ADMIN uniquement :
// c'est l'acte de facturation — le revendeur paie, l'admin prolonge).
// Body : { extendDays: 30 }  OU  { expiry: "2026-08-01T00:00:00Z" }
//        { revoke: true } coupe immédiatement (impayé).
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  '/:id/license',
  auth,
  asyncWrap(async (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json(createError('Réservé à l’admin', null, 'FORBIDDEN'));
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json(createError('Identifiant de serveur invalide'));
    }
    const [server] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, id))
      .limit(1);
    if (!server) {
      return res.status(404).json(createError('Serveur introuvable', null, 'NOT_FOUND'));
    }

    const { extendDays, expiry, revoke, maxClients, updateChannel } = req.body || {};
    const updates = {};

    let newExpiry = null;
    if (revoke === true) {
      newExpiry = new Date(0); // licence coupée immédiatement
    } else if (Number.isInteger(extendDays) && extendDays > 0 && extendDays <= 3650) {
      // Prolonge depuis l'expiry courante si encore valide, sinon depuis maintenant
      // (un renouvellement tardif ne "perd" pas de jours, un anticipé les cumule).
      const base = Math.max(
        Date.now(),
        server.licenseExpiry ? new Date(server.licenseExpiry).getTime() : 0
      );
      newExpiry = new Date(base + extendDays * 24 * 3600 * 1000);
    } else if (expiry && !Number.isNaN(Date.parse(expiry))) {
      newExpiry = new Date(expiry);
    }
    if (newExpiry) updates.licenseExpiry = newExpiry;

    // Palier de licence : plafond de clients de l'instance (null = illimité).
    // Poussé à l'instance au prochain heartbeat, appliqué là-bas à la création.
    if (maxClients !== undefined) {
      if (
        maxClients !== null &&
        (!Number.isInteger(maxClients) || maxClients < 1 || maxClients > 100000)
      ) {
        return res.status(400).json(createError('maxClients : entier ≥ 1 ou null'));
      }
      updates.maxClients = maxClients;
    }

    // Canal de mise à jour : stable | canary (serveurs pilotes) | hold (gelé —
    // aucune mise à jour offerte au heartbeat).
    if (updateChannel !== undefined) {
      if (!['stable', 'canary', 'hold'].includes(updateChannel)) {
        return res.status(400).json(createError('updateChannel : stable | canary | hold'));
      }
      updates.updateChannel = updateChannel;
    }

    if (Object.keys(updates).length === 0) {
      return res
        .status(400)
        .json(
          createError(
            'extendDays (1-3650), expiry (ISO), revoke:true, maxClients ou updateChannel requis'
          )
        );
    }

    await db.update(schema.servers).set(updates).where(eq(schema.servers.id, id));

    const changed = {
      serverId: id,
      ...(newExpiry ? { licenseExpiry: newExpiry.toISOString() } : {}),
      ...(updates.maxClients !== undefined ? { maxClients: updates.maxClients } : {}),
      ...(updates.updateChannel ? { updateChannel: updates.updateChannel } : {}),
    };
    await auditLog({
      actor: req.user.username,
      action: revoke ? 'revoke_license' : 'update_license',
      targetType: 'server',
      targetName: server.label,
      details: changed,
      ip: req.ip,
    });

    res.json({ success: true, ...changed });
  })
);

module.exports = router;
