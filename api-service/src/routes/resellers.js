// routes/resellers.js — Réseau de distribution. Monté /api/resellers.
//   POST /            : créer un sous-revendeur (revendeur N1 ou admin).
//   GET  /            : vue du réseau (sous-arbre : comptes + solde + conso).
//   PUT  /price       : fixer son prix de revente d'1 crédit (sellPriceCents).
//   POST /invites     : générer un lien d'inscription (croissance du réseau).

const express = require('express');
const { z } = require('zod');
const router = express.Router();

const { db, schema } = require('../../db');
const { eq, inArray } = require('drizzle-orm');
const { requireReseller, invalidateUserCache } = require('../middleware/auth');
const { hashPassword } = require('../services/auth');
const { descendantIds } = require('../services/scope');
const wallet = require('../services/wallet');
const { auditLog } = require('../services/audit');
const { asyncWrap, createError } = require('../utils/errors');

const createSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Nom invalide'),
  password: z.string().min(8, 'Mot de passe trop court (min 8)'),
  sellPriceCents: z.number().int().nonnegative().optional(),
  email: z.string().email('Email invalide').max(255).optional(),
});

// Crée un sous-revendeur rattaché à req.user. Cap de profondeur 2 : seul un
// compte SANS parent (admin, ou revendeur N1) peut en créer.
router.post(
  '/',
  requireReseller,
  asyncWrap(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && req.user.parentId != null) {
      return res
        .status(403)
        .json(createError('Un sous-revendeur ne peut pas créer de revendeurs', null, 'FORBIDDEN'));
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json(createError(parsed.error, 'Validation échouée'));
    const { username, password, sellPriceCents, email } = parsed.data;

    const [exists] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);
    if (exists) return res.status(409).json(createError('Nom déjà pris', null, 'CONFLICT'));

    const { hash, salt } = await hashPassword(password);
    // Convention de hiérarchie : un revendeur créé par l'ADMIN est top-level
    // (parentId NULL — il peut revendre et créer des N2). Créé par un N1 →
    // sous-revendeur (parentId = N1). Sans ça, les N1 créés par l'admin étaient
    // traités comme des N2 incapables de revendre (incohérence corrigée).
    const parentId = isAdmin ? null : req.user.id;
    let created;
    try {
      [created] = await db
        .insert(schema.users)
        .values({
          username,
          hash,
          salt,
          role: 'reseller',
          parentId,
          email: email ?? null,
          sellPriceCents: sellPriceCents ?? null,
          enabled: true,
        })
        .returning({ id: schema.users.id, username: schema.users.username });
    } catch (dbErr) {
      // Course entre le check d'existence et l'insert (index unique username).
      if (
        dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        dbErr.message?.includes('UNIQUE constraint')
      ) {
        return res.status(409).json(createError('Nom déjà pris', null, 'CONFLICT'));
      }
      throw dbErr;
    }

    wallet.ensureWallet(created.id);
    await auditLog({
      actor: req.user.username,
      action: 'create_reseller',
      targetType: 'user',
      targetName: username,
      details: { childId: created.id, parentId },
      ip: req.ip,
    });
    res.json({ success: true, id: created.id, username: created.username });
  })
);

// Vue du réseau : sous-arbre (root exclu de la liste des "enfants"), avec solde
// et nombre de serveurs de chaque compte.
router.get(
  '/',
  requireReseller,
  asyncWrap(async (req, res) => {
    const fields = {
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
      parentId: schema.users.parentId,
      sellPriceCents: schema.users.sellPriceCents,
      enabled: schema.users.enabled,
      email: schema.users.email,
    };

    let rows;
    if (req.user.role === 'admin') {
      // L'admin voit TOUT le réseau (les N1 sont top-level : parentId NULL,
      // donc hors de son sous-arbre — on liste par rôle).
      rows = await db.select(fields).from(schema.users).where(eq(schema.users.role, 'reseller'));
    } else {
      const ids = descendantIds(req.user.id).filter((id) => id !== req.user.id);
      if (ids.length === 0) return res.json([]);
      rows = await db.select(fields).from(schema.users).where(inArray(schema.users.id, ids));
    }

    // Vue d'ensemble par compte : nombre de serveurs + clients cumulés + état
    // licence (la plus proche de l'expiration). Une seule requête agrégée.
    const ids = rows.map((u) => u.id);
    const srvByOwner = new Map();
    if (ids.length > 0) {
      const srvRows = await db
        .select({
          ownerId: schema.servers.ownerId,
          status: schema.servers.status,
          clientCount: schema.servers.clientCount,
          licenseExpiry: schema.servers.licenseExpiry,
        })
        .from(schema.servers)
        .where(inArray(schema.servers.ownerId, ids));
      for (const s of srvRows) {
        const agg = srvByOwner.get(s.ownerId) || {
          serversCount: 0,
          serversOnline: 0,
          clientsTotal: 0,
          nextLicenseExpiry: null,
        };
        agg.serversCount += 1;
        if (s.status === 'online') agg.serversOnline += 1;
        agg.clientsTotal += s.clientCount || 0;
        if (
          s.licenseExpiry &&
          (!agg.nextLicenseExpiry || new Date(s.licenseExpiry) < new Date(agg.nextLicenseExpiry))
        ) {
          agg.nextLicenseExpiry = s.licenseExpiry;
        }
        srvByOwner.set(s.ownerId, agg);
      }
    }

    const network = rows.map((u) => ({
      ...u,
      balance: wallet.getBalance(u.id),
      serversCount: srvByOwner.get(u.id)?.serversCount || 0,
      serversOnline: srvByOwner.get(u.id)?.serversOnline || 0,
      clientsTotal: srvByOwner.get(u.id)?.clientsTotal || 0,
      nextLicenseExpiry: srvByOwner.get(u.id)?.nextLicenseExpiry || null,
    }));
    res.json(network);
  })
);

// Gestion d'un compte du réseau : activer/désactiver, prix de revente, email.
// Admin : n'importe quel revendeur ; revendeur : uniquement ses descendants.
const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    sellPriceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
    email: z.string().email('Email invalide').max(255).nullable().optional(),
  })
  .strict();

router.patch(
  '/:id',
  requireReseller,
  asyncWrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json(createError('Identifiant invalide'));

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json(createError(parsed.error, 'Validation échouée'));
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json(createError('enabled, sellPriceCents ou email requis'));
    }

    const [target] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    if (!target || target.role !== 'reseller') {
      return res.status(404).json(createError('Revendeur introuvable', null, 'NOT_FOUND'));
    }
    // Tenance : un revendeur ne gère que son sous-arbre (jamais lui-même via
    // cette route — son prix passe par PUT /price).
    if (req.user.role !== 'admin') {
      const ids = descendantIds(req.user.id).filter((d) => d !== req.user.id);
      if (!ids.includes(id)) {
        return res.status(403).json(createError('Hors de votre réseau', null, 'FORBIDDEN'));
      }
    }

    await db.update(schema.users).set(updates).where(eq(schema.users.id, id));
    // La désactivation doit être immédiate (cache auth 1 min sinon).
    invalidateUserCache(target.username);

    await auditLog({
      actor: req.user.username,
      action: 'update_reseller',
      targetType: 'user',
      targetName: target.username,
      details: { id, ...updates },
      ip: req.ip,
    });
    res.json({ success: true, id, ...updates });
  })
);

// Génère un lien d'invitation à durée limitée (7 jours, usage unique). L'invité
// crée son compte via POST /auth/register — rattaché à l'inviteur (admin → N1
// top-level ; revendeur top-level → N2). Cap de profondeur 2 : un N2 n'invite pas.
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
router.post(
  '/invites',
  requireReseller,
  asyncWrap(async (req, res) => {
    if (req.user.role !== 'admin' && req.user.parentId != null) {
      return res
        .status(403)
        .json(
          createError('Un sous-revendeur ne peut pas inviter de revendeurs', null, 'FORBIDDEN')
        );
    }

    const { generateToken, hashToken } = require('../services/sshKeys');
    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await db.insert(schema.invites).values({
      tokenHash: hashToken(token),
      inviterId: req.user.id,
      expiresAt,
    });

    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const base =
      (process.env.PLATFORM_BASE_URL || '').trim().replace(/\/+$/, '') ||
      (req.headers.host ? `${proto}://${req.headers.host}` : '');
    await auditLog({
      actor: req.user.username,
      action: 'create_invite',
      targetType: 'invite',
      targetName: req.user.username,
      details: { expiresAt: expiresAt.toISOString() },
      ip: req.ip,
    });
    res.json({
      token,
      url: base ? `${base}/?invite=${token}` : null,
      expiresAt: expiresAt.toISOString(),
    });
  })
);

// Fixe son propre prix de revente (marge future sur les transferts).
router.put(
  '/price',
  requireReseller,
  asyncWrap(async (req, res) => {
    const price = parseInt(req.body?.sellPriceCents, 10);
    if (!Number.isInteger(price) || price < 0 || price > 10_000_000) {
      return res.status(400).json(createError('Prix invalide'));
    }
    await db
      .update(schema.users)
      .set({ sellPriceCents: price })
      .where(eq(schema.users.id, req.user.id));
    res.json({ success: true, sellPriceCents: price });
  })
);

module.exports = router;
