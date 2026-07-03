// routes/credits.js — Mouvements de crédits. Monté /api/credits.
//   POST /topup    (admin)      : crédite un compte après paiement reçu.
//   POST /transfer (revendeur)  : transfère des crédits à un sous-revendeur (marge).

const express = require('express');
const { z } = require('zod');
const router = express.Router();

const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');
const { requireAdmin, requireReseller } = require('../middleware/auth');
const wallet = require('../services/wallet');
const { isInScope } = require('../services/scope');
const { auditLog } = require('../services/audit');
const { asyncWrap, createError } = require('../utils/errors');

const topupSchema = z.object({
  userId: z.number().int().positive(),
  credits: z.number().int().positive().max(1_000_000),
  priceCents: z.number().int().nonnegative().optional(),
});

const transferSchema = z.object({
  toUserId: z.number().int().positive(),
  credits: z.number().int().positive().max(1_000_000),
});

// Top-up : réservé à l'admin (il crédite après encaissement hors plateforme).
router.post(
  '/topup',
  requireAdmin,
  asyncWrap(async (req, res) => {
    const parsed = topupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(createError(parsed.error, 'Validation échouée'));
    const { userId, credits, priceCents } = parsed.data;

    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!target) return res.status(404).json(createError('Compte introuvable', null, 'NOT_FOUND'));

    const balance = wallet.credit(userId, credits, 'topup', { priceCents });
    await auditLog({
      actor: req.user.username,
      action: 'topup',
      targetType: 'wallet',
      targetName: target.username,
      details: { userId, credits, priceCents: priceCents ?? null },
      ip: req.ip,
    });
    res.json({ success: true, userId, balance });
  })
);

// Transfert : revendeur N1 → un de ses sous-revendeurs (dans son sous-arbre).
router.post(
  '/transfer',
  requireReseller,
  asyncWrap(async (req, res) => {
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(createError(parsed.error, 'Validation échouée'));
    const { toUserId, credits } = parsed.data;

    if (toUserId === req.user.id) {
      return res.status(400).json(createError('Auto-transfert interdit', null, 'INVALID'));
    }
    // Seul un revendeur niveau 1 (parentId NULL) peut revendre ; et la cible doit
    // être dans son sous-arbre. Admin : autorisé partout.
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      if (req.user.parentId != null) {
        return res.status(403).json(createError('Un sous-revendeur ne peut pas revendre', null, 'FORBIDDEN'));
      }
      if (!isInScope(req.user.id, toUserId)) {
        return res.status(403).json(createError('Cible hors de votre réseau', null, 'FORBIDDEN'));
      }
    }

    const [me] = await db.select().from(schema.users).where(eq(schema.users.id, req.user.id)).limit(1);
    const priceCents = me?.sellPriceCents ?? null;

    try {
      const result = wallet.transfer(req.user.id, toUserId, credits, priceCents);
      await auditLog({
        actor: req.user.username,
        action: 'transfer',
        targetType: 'wallet',
        targetName: String(toUserId),
        details: { toUserId, credits, priceCents, ref: result.ref },
        ip: req.ip,
      });
      res.json({ success: true, ...result });
    } catch (e) {
      if (e.code === 'INSUFFICIENT_FUNDS') {
        return res.status(400).json(createError('Solde insuffisant', null, 'INSUFFICIENT_FUNDS'));
      }
      throw e;
    }
  })
);

module.exports = router;
