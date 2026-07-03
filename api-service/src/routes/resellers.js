// routes/resellers.js — Réseau de distribution. Monté /api/resellers.
//   POST /            : créer un sous-revendeur (revendeur N1 ou admin).
//   GET  /            : vue du réseau (sous-arbre : comptes + solde + conso).
//   PUT  /:id/price   : fixer son prix de revente d'1 crédit (sellPriceCents).

const express = require('express');
const { z } = require('zod');
const router = express.Router();

const { db, schema } = require('../../db');
const { eq, inArray } = require('drizzle-orm');
const { requireReseller } = require('../middleware/auth');
const { hashPassword } = require('../services/auth');
const { descendantIds } = require('../services/scope');
const wallet = require('../services/wallet');
const { auditLog } = require('../services/audit');
const { asyncWrap, createError } = require('../utils/errors');

const createSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_-]+$/, 'Nom invalide'),
  password: z.string().min(8, 'Mot de passe trop court (min 8)'),
  sellPriceCents: z.number().int().nonnegative().optional(),
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
    if (!parsed.success) return res.status(400).json(createError(parsed.error, 'Validation échouée'));
    const { username, password, sellPriceCents } = parsed.data;

    const [exists] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);
    if (exists) return res.status(409).json(createError('Nom déjà pris', null, 'CONFLICT'));

    const { hash, salt } = await hashPassword(password);
    const [created] = await db
      .insert(schema.users)
      .values({
        username,
        hash,
        salt,
        role: 'reseller',
        parentId: req.user.id,
        sellPriceCents: sellPriceCents ?? null,
        enabled: true,
      })
      .returning({ id: schema.users.id, username: schema.users.username });

    wallet.ensureWallet(created.id);
    await auditLog({
      actor: req.user.username,
      action: 'create_reseller',
      targetType: 'user',
      targetName: username,
      details: { childId: created.id, parentId: req.user.id },
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
    const ids = descendantIds(req.user.id).filter((id) => id !== req.user.id);
    if (ids.length === 0) return res.json([]);

    const rows = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
        parentId: schema.users.parentId,
        sellPriceCents: schema.users.sellPriceCents,
        enabled: schema.users.enabled,
      })
      .from(schema.users)
      .where(inArray(schema.users.id, ids));

    const network = rows.map((u) => ({
      ...u,
      balance: wallet.getBalance(u.id),
    }));
    res.json(network);
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
