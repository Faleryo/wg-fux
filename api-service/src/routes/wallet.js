// routes/wallet.js — Portefeuille de crédits du compte courant. Monté /api/wallet.
// GET / → solde + relevé + marge calculée depuis le ledger (jamais stockée).

const express = require('express');
const router = express.Router();

const wallet = require('../services/wallet');
const { ACQUISITION_REASONS } = wallet;
const { asyncWrap } = require('../utils/errors');

// Marge (en centimes) sur le relevé : Σ(transfer_out × prix de revente) − coût
// d'acquisition (toutes les entrées : top-up manuel, achat Stripe, réception).
// La liste vit dans services/wallet.js, au plus près des écritures.
function computeMargin(entries) {
  let resold = 0; // valeur revendue (crédits sortis × prix appliqué)
  let acquiredCost = 0; // ce que ce compte a payé pour ses crédits entrants
  for (const e of entries) {
    const price = e.priceCents || 0;
    if (e.reason === 'transfer_out') resold += Math.abs(e.delta) * price;
    if (ACQUISITION_REASONS.includes(e.reason)) acquiredCost += e.delta * price;
  }
  return { resoldCents: resold, acquiredCostCents: acquiredCost };
}

// Cumuls de crédits sur tout le relevé : acquis (entrées) vs consommés (sorties).
// Sert le suivi d'abonnement de l'onglet Ventes (inclus / utilisés / restants).
function computeCredits(entries, balance) {
  let acquired = 0; // crédits entrés (achat, réception)
  let used = 0; // crédits sortis (renouvellements, envois)
  for (const e of entries) {
    if (e.delta > 0) acquired += e.delta;
    else used += Math.abs(e.delta);
  }
  return { acquired, used, balance };
}

router.get(
  '/',
  asyncWrap(async (req, res) => {
    const { balance, entries } = wallet.statement(req.user.id, 5000);
    res.json({
      balance,
      margin: computeMargin(entries),
      credits: computeCredits(entries, balance),
      entries: entries.slice(0, 100),
    });
  })
);

// GET /api/wallet/stats — séries mensuelles (12 derniers mois) pour les courbes
// business : crédits acquis / revendus / consommés et marge par mois.
router.get(
  '/stats',
  asyncWrap(async (req, res) => {
    const { entries } = wallet.statement(req.user.id, 5000);
    const months = new Map(); // 'YYYY-MM' → agrégat
    const key = (sec) => {
      const d = new Date((sec || 0) * 1000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    for (const e of entries) {
      const k = key(e.createdAt);
      const m = months.get(k) || { month: k, acquired: 0, resold: 0, consumed: 0, marginCents: 0 };
      const price = e.priceCents || 0;
      if (ACQUISITION_REASONS.includes(e.reason)) m.acquired += e.delta;
      if (e.reason === 'transfer_out') {
        m.resold += Math.abs(e.delta);
        m.marginCents += Math.abs(e.delta) * price;
      }
      if (['monthly', 'client_renewal', 'license_renewal'].includes(e.reason)) {
        m.consumed += Math.abs(e.delta);
      }
      months.set(k, m);
    }
    // 12 derniers mois, ordre chronologique (mois vides inclus pour une courbe lisse).
    const series = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      series.push(
        months.get(k) || { month: k, acquired: 0, resold: 0, consumed: 0, marginCents: 0 }
      );
    }
    res.json({ series });
  })
);

// Début du mois courant (UTC) — borne des agrégats « ce mois-ci ».
function startOfMonthSec() {
  const n = new Date();
  return Math.floor(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1) / 1000);
}

/**
 * Agrégats business d'un relevé. Fonction PURE (testable sans DB).
 *
 * Vocabulaire, pour lever l'ambiguïté du mot « marge » :
 *   - CA (chiffre d'affaires) = ce que mes acheteurs m'ont payé
 *                             = Σ(crédits transférés × MON prix de revente) ;
 *   - coût d'acquisition      = ce que j'ai payé mes propres crédits ;
 *   - marge                   = CA − coût d'acquisition.
 * Un compte au sommet de la chaîne (admin) a un coût d'acquisition nul : sa
 * marge égale son CA, ce qui est correct.
 */
function computeBusiness(entries, sinceSec) {
  const zero = () => ({ revenueCents: 0, costCents: 0, marginCents: 0, creditsSold: 0 });
  const all = zero();
  const month = zero();

  for (const e of entries) {
    const price = e.priceCents || 0;
    const qty = Math.abs(e.delta);
    const inMonth = (e.createdAt || 0) >= sinceSec;

    if (e.reason === 'transfer_out') {
      all.revenueCents += qty * price;
      all.creditsSold += qty;
      if (inMonth) {
        month.revenueCents += qty * price;
        month.creditsSold += qty;
      }
    }
    if (ACQUISITION_REASONS.includes(e.reason)) {
      all.costCents += e.delta * price;
      if (inMonth) month.costCents += e.delta * price;
    }
  }
  all.marginCents = all.revenueCents - all.costCents;
  month.marginCents = month.revenueCents - month.costCents;
  return { all, month };
}

/**
 * Classement des acheteurs (« top vendeurs ») depuis les transferts sortants.
 * PURE : `names` mappe counterpartyId → username, résolu par l'appelant.
 */
function computeTopBuyers(entries, names = new Map(), limit = 10) {
  const byId = new Map();
  for (const e of entries) {
    if (e.reason !== 'transfer_out' || !e.counterpartyId) continue;
    const qty = Math.abs(e.delta);
    const row = byId.get(e.counterpartyId) || {
      id: e.counterpartyId,
      username: names.get(e.counterpartyId) || `#${e.counterpartyId}`,
      credits: 0,
      revenueCents: 0,
      lastAt: 0,
    };
    row.credits += qty;
    row.revenueCents += qty * (e.priceCents || 0);
    if ((e.createdAt || 0) > row.lastAt) row.lastAt = e.createdAt || 0;
    byId.set(e.counterpartyId, row);
  }
  return [...byId.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, limit);
}

// GET /api/wallet/business — tableau de bord de revenus du compte courant :
// CA, coût, marge (total + mois en cours) et classement de ses acheteurs.
router.get(
  '/business',
  asyncWrap(async (req, res) => {
    const { balance, entries } = wallet.statement(req.user.id, 5000);

    // Ventes par CRÉDIT MANUEL : elles vivent sur le registre de l'ACHETEUR
    // (une seule ligne 'topup'), pas sur celui du vendeur — invisibles d'un
    // simple statement(). On les récupère par counterpartyId et on les
    // normalise en 'transfer_out' pour que les agrégats les comptent comme
    // n'importe quelle revente. Sans ça, un opérateur qui encaisse hors
    // plateforme (virement, espèces) voyait un chiffre d'affaires nul.
    const { db, schema } = require('../../db');
    const { and, eq } = require('drizzle-orm');
    const manualSales = await db
      .select({
        delta: schema.ledger.delta,
        priceCents: schema.ledger.priceCents,
        createdAt: schema.ledger.createdAt,
        counterpartyId: schema.ledger.userId, // l'acheteur, vu du vendeur
      })
      .from(schema.ledger)
      .where(and(eq(schema.ledger.reason, 'topup'), eq(schema.ledger.counterpartyId, req.user.id)));

    const salesAsOut = manualSales.map((s) => ({
      reason: 'transfer_out',
      delta: -Math.abs(s.delta),
      priceCents: s.priceCents,
      counterpartyId: s.counterpartyId,
      createdAt: s.createdAt ? Math.floor(new Date(s.createdAt).getTime() / 1000) : 0,
    }));
    const allEntries = [...entries, ...salesAsOut];

    const { all, month } = computeBusiness(allEntries, startOfMonthSec());

    // Noms des contreparties : une seule requête, uniquement les ids présents.
    const ids = [
      ...new Set(allEntries.filter((e) => e.counterpartyId).map((e) => e.counterpartyId)),
    ];
    const names = new Map();
    if (ids.length > 0) {
      const { db, schema } = require('../../db');
      const { inArray } = require('drizzle-orm');
      const rows = await db
        .select({ id: schema.users.id, username: schema.users.username })
        .from(schema.users)
        .where(inArray(schema.users.id, ids));
      rows.forEach((r) => names.set(r.id, r.username));
    }

    res.json({
      balance,
      total: all,
      month: month,
      topBuyers: computeTopBuyers(allEntries, names),
      currency: 'EUR',
    });
  })
);

module.exports = router;
// Exposées pour les tests : ce sont des fonctions pures d'agrégation, et c'est
// exactement là que le motif 'topup_stripe' avait été oublié sans qu'aucun test
// ne le voie (0 % de couverture de branches sur ce fichier).
module.exports.computeMargin = computeMargin;
module.exports.computeCredits = computeCredits;
module.exports.computeBusiness = computeBusiness;
module.exports.computeTopBuyers = computeTopBuyers;
