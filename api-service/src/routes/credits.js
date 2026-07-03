// routes/credits.js — Mouvements de crédits. Monté /api/credits.
//   POST /topup    (admin)      : crédite un compte après paiement reçu.
//   POST /transfer (revendeur)  : transfère des crédits à un sous-revendeur (marge).
//   POST /checkout (revendeur top-level) : achat de crédits par Stripe Checkout.
//
// Modèle de distribution : SEULS les comptes top-level (parentId NULL) achètent
// à la plateforme (au prix credit_price_cents). Un sous-revendeur N2 achète ses
// crédits à son parent N1 (transfert avec marge) — jamais à la plateforme, sinon
// la marge du réseau serait contournée.

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

const checkoutSchema = z.object({
  credits: z.number().int().positive().max(10_000),
});

// Base publique de la plateforme (URLs de retour Stripe).
function platformBase(req) {
  const fromEnv = (process.env.PLATFORM_BASE_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers.host;
  return host ? `${proto}://${host}` : 'https://localhost';
}

// Top-up : réservé à l'admin (il crédite après encaissement hors plateforme).
router.post(
  '/topup',
  requireAdmin,
  asyncWrap(async (req, res) => {
    const parsed = topupSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json(createError(parsed.error, 'Validation échouée'));
    const { userId, credits, priceCents } = parsed.data;

    const [target] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
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
    if (!parsed.success)
      return res.status(400).json(createError(parsed.error, 'Validation échouée'));
    const { toUserId, credits } = parsed.data;

    if (toUserId === req.user.id) {
      return res.status(400).json(createError('Auto-transfert interdit', null, 'INVALID'));
    }
    // Seul un revendeur niveau 1 (parentId NULL) peut revendre ; et la cible doit
    // être dans son sous-arbre. Admin : autorisé partout.
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      if (req.user.parentId != null) {
        return res
          .status(403)
          .json(createError('Un sous-revendeur ne peut pas revendre', null, 'FORBIDDEN'));
      }
      if (!isInScope(req.user.id, toUserId)) {
        return res.status(403).json(createError('Cible hors de votre réseau', null, 'FORBIDDEN'));
      }
    }

    // Le destinataire doit exister (sinon la FK ledger→users lèverait un 500).
    const [target] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, toUserId))
      .limit(1);
    if (!target) {
      return res.status(404).json(createError('Destinataire introuvable', null, 'NOT_FOUND'));
    }

    const [me] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, req.user.id))
      .limit(1);
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

// Achat self-service de crédits par Stripe Checkout. Réservé aux comptes
// TOP-LEVEL (parentId NULL) et à l'admin : c'est l'unique entrée d'argent réel
// dans l'économie de crédits — les N2 achètent à leur parent (marge préservée).
router.post(
  '/checkout',
  requireReseller,
  asyncWrap(async (req, res) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json(createError(parsed.error, 'Validation échouée'));
    const { credits } = parsed.data;

    if (req.user.role !== 'admin' && req.user.parentId != null) {
      return res
        .status(403)
        .json(
          createError(
            'Les crédits s’achètent auprès de votre revendeur parent, pas de la plateforme.',
            null,
            'BUY_FROM_PARENT'
          )
        );
    }

    const { getSetting } = require('../services/settings');
    const [secretKey, priceRaw, currencyRaw] = await Promise.all([
      getSetting('stripe_secret_key'),
      getSetting('credit_price_cents'),
      getSetting('billing_currency'),
    ]);
    const unitAmount = parseInt(priceRaw, 10);
    if (!secretKey || !Number.isInteger(unitAmount) || unitAmount <= 0) {
      return res
        .status(503)
        .json(
          createError(
            'Paiement en ligne non configuré (stripe_secret_key + credit_price_cents requis) — contactez l’administrateur.',
            null,
            'BILLING_NOT_CONFIGURED'
          )
        );
    }
    const currency = (currencyRaw || 'eur').toLowerCase().slice(0, 3);

    // Création de la Checkout Session via l'API REST Stripe (form-encoded —
    // pas de SDK, cohérent avec le webhook vérifié à la main).
    const base = platformBase(req);
    const params = new URLSearchParams({
      mode: 'payment',
      success_url: `${base}/?checkout=success`,
      cancel_url: `${base}/?checkout=cancel`,
      'line_items[0][quantity]': String(credits),
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][unit_amount]': String(unitAmount),
      'line_items[0][price_data][product_data][name]': 'Crédit de licence (30 jours / serveur)',
      'metadata[type]': 'credits',
      'metadata[userId]': String(req.user.id),
      'metadata[credits]': String(credits),
    });

    let session;
    try {
      const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(15000),
      });
      session = await resp.json();
      if (!resp.ok || !session.url) {
        const msg = session?.error?.message || `HTTP ${resp.status}`;
        throw new Error(msg);
      }
    } catch (e) {
      return res
        .status(502)
        .json(
          createError(`Création de la session Stripe échouée : ${e.message}`, null, 'STRIPE_ERROR')
        );
    }

    await auditLog({
      actor: req.user.username,
      action: 'checkout_credits',
      targetType: 'wallet',
      targetName: req.user.username,
      details: { credits, unitAmount, currency, sessionId: session.id },
      ip: req.ip,
    });
    res.json({ url: session.url, credits, unitAmount, currency });
  })
);

module.exports = router;
