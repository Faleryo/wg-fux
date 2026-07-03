// routes/stripe.js — Webhook Stripe PUBLIC : renouvellement automatique des
// licences revendeurs. Monté sous /stripe avec express.raw (corps brut requis
// pour vérifier la signature). Aucune dépendance au SDK Stripe : la signature
// est vérifiée à la main (schéma documenté : HMAC-SHA256 de "t.payload").
//
// Flux : le revendeur paie (Payment Link / Checkout) ; Stripe POST l'événement
// ici ; on retrouve le serveur via metadata.serverId (ou client_reference_id)
// et on prolonge licenseExpiry. Idempotent (une même facture ne prolonge qu'une
// fois, borné par la période).

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { db, schema, sqlite } = require('../../db');
const { eq } = require('drizzle-orm');
const { getSetting } = require('../services/settings');
const { auditLog } = require('../services/audit');
const log = require('../services/logger');

// Idempotence : un event.id Stripe n'est traité qu'une seule fois (préparation
// paresseuse — la table stripe_events est créée par la migration v18, après le
// chargement des routes). Renvoie true si l'event est NOUVEAU (à traiter).
let _stmtMarkEvent = null;
function markEventNew(eventId) {
  if (!eventId) return true; // pas d'id → on ne peut pas dédupliquer, on traite
  if (!_stmtMarkEvent) {
    _stmtMarkEvent = sqlite.prepare('INSERT OR IGNORE INTO stripe_events (id) VALUES (?)');
  }
  return _stmtMarkEvent.run(eventId).changes > 0;
}

// Vérifie la signature Stripe (header "Stripe-Signature: t=...,v1=...").
// Tolérance 5 min contre le rejeu. rawBody = Buffer (express.raw).
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  // Un header peut contenir PLUSIEURS v1 (rotation de secret) → on les collecte tous.
  let timestamp = null;
  const v1s = [];
  for (const kv of sigHeader.split(',')) {
    const idx = kv.indexOf('=');
    if (idx === -1) continue;
    const k = kv.slice(0, idx).trim();
    const v = kv.slice(idx + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') v1s.push(v);
  }
  if (!timestamp || v1s.length === 0) return false;

  // Anti-rejeu : horodatage numérique ET récent (un t non numérique est rejeté).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  const expectedBuf = Buffer.from(expected);
  // Accepte si l'un des v1 correspond (comparaison à temps constant).
  return v1s.some((v1) => {
    try {
      const vBuf = Buffer.from(v1);
      return vBuf.length === expectedBuf.length && crypto.timingSafeEqual(expectedBuf, vBuf);
    } catch {
      return false;
    }
  });
}

// Prolonge la licence d'un serveur de `days` jours (cumul depuis l'expiry
// courante si encore valide, sinon depuis maintenant).
async function extendLicense(serverId, days, reason) {
  const [server] = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
    .limit(1);
  if (!server) {
    log.warn('stripe', 'Paiement reçu pour un serveur inconnu', { serverId });
    return false;
  }
  const base = Math.max(
    Date.now(),
    server.licenseExpiry ? new Date(server.licenseExpiry).getTime() : 0
  );
  const newExpiry = new Date(base + days * 24 * 3600 * 1000);
  await db
    .update(schema.servers)
    .set({ licenseExpiry: newExpiry })
    .where(eq(schema.servers.id, serverId));

  await auditLog({
    actor: 'stripe',
    action: 'renew_license',
    targetType: 'server',
    targetName: server.label,
    details: { serverId, days, reason, licenseExpiry: newExpiry.toISOString() },
  });
  log.info('stripe', 'Licence prolongée par paiement Stripe', {
    serverId,
    days,
    licenseExpiry: newExpiry.toISOString(),
  });
  return true;
}

// Extrait serverId + durée depuis un objet Stripe (checkout session ou invoice).
// Convention : metadata.serverId + metadata.days (défaut 30).
function parseTarget(obj) {
  const md = obj.metadata || {};
  const serverId = parseInt(md.serverId || obj.client_reference_id, 10);
  const days = parseInt(md.days, 10);
  return {
    serverId: Number.isInteger(serverId) ? serverId : null,
    days: Number.isInteger(days) && days > 0 && days <= 3650 ? days : 30,
  };
}

// Achat de CRÉDITS (flux principal depuis la réconciliation licence↔crédits) :
// metadata.type='credits' + metadata.userId + metadata.credits. Le crédit devient
// le moyen de paiement de la licence — le renouvellement débitera le wallet.
function parseCreditsTarget(obj) {
  const md = obj.metadata || {};
  if (md.type !== 'credits') return null;
  const userId = parseInt(md.userId, 10);
  const credits = parseInt(md.credits, 10);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!Number.isInteger(credits) || credits <= 0 || credits > 1_000_000) return null;
  return { userId, credits };
}

// Crédite le wallet après paiement Stripe. priceCents = prix unitaire payé
// (amount_total / credits) pour la traçabilité de marge dans le ledger.
async function creditWallet(target, obj, eventId, eventType) {
  const wallet = require('../services/wallet');
  const { db: _db, schema: _schema } = require('../../db');
  const { eq: _eq } = require('drizzle-orm');
  const [user] = await _db
    .select({ id: _schema.users.id, username: _schema.users.username })
    .from(_schema.users)
    .where(_eq(_schema.users.id, target.userId))
    .limit(1);
  if (!user) {
    log.warn('stripe', 'Paiement de crédits pour un compte inconnu', { userId: target.userId });
    return false;
  }
  const amountTotal = Number.isInteger(obj.amount_total) ? obj.amount_total : null;
  const priceCents = amountTotal ? Math.round(amountTotal / target.credits) : null;
  const balance = wallet.credit(target.userId, target.credits, 'topup_stripe', {
    priceCents,
    ref: eventId || null,
  });
  await auditLog({
    actor: 'stripe',
    action: 'topup',
    targetType: 'wallet',
    targetName: user.username,
    details: { userId: target.userId, credits: target.credits, priceCents, eventType, balance },
  });
  log.info('stripe', 'Crédits ajoutés par paiement Stripe', {
    userId: target.userId,
    credits: target.credits,
    balance,
  });
  return true;
}

router.post('/webhook', async (req, res) => {
  try {
    const secret = await getSetting('stripe_webhook_secret');
    if (!secret) {
      return res.status(503).json({ error: 'Stripe non configuré' });
    }
    // req.body est un Buffer (express.raw monté au niveau du app.use).
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'], secret)) {
      log.warn('stripe', 'Signature de webhook invalide');
      return res.status(400).json({ error: 'Signature invalide' });
    }

    const event = JSON.parse(raw.toString('utf8'));
    const obj = event.data && event.data.object ? event.data.object : {};

    // Idempotence : ignore un event.id déjà traité (redélivrance Stripe, rejeu
    // signé, ou double émission checkout.session.completed + invoice.paid).
    if (!markEventNew(event.id)) {
      log.info('stripe', 'Event Stripe déjà traité (ignoré)', { id: event.id });
      return res.json({ received: true, duplicate: true });
    }

    if (event.type === 'checkout.session.completed' || event.type === 'invoice.paid') {
      // Flux principal : achat de crédits (metadata.type='credits'). Flux legacy
      // conservé : prolongation directe de licence via metadata.serverId (anciens
      // Payment Links déjà distribués).
      const creditsTarget = parseCreditsTarget(obj);
      if (creditsTarget) {
        await creditWallet(creditsTarget, obj, event.id, event.type);
      } else {
        const { serverId, days } = parseTarget(obj);
        if (serverId) {
          await extendLicense(serverId, days, event.type);
        } else {
          log.warn('stripe', 'Paiement sans cible exploitable (ni credits ni serverId)', {
            type: event.type,
          });
        }
      }
    }

    // Toujours 200 pour les événements traités/ignorés (sinon Stripe rejoue).
    res.json({ received: true });
  } catch (err) {
    log.error('stripe', 'Erreur webhook', { err: err.message });
    res.status(400).json({ error: 'Webhook error' });
  }
});

module.exports = router;
module.exports.verifyStripeSignature = verifyStripeSignature;
module.exports.parseTarget = parseTarget;
module.exports.parseCreditsTarget = parseCreditsTarget;
