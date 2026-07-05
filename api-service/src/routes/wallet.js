// routes/wallet.js — Portefeuille de crédits du compte courant. Monté /api/wallet.
// GET / → solde + relevé + marge calculée depuis le ledger (jamais stockée).

const express = require('express');
const router = express.Router();

const wallet = require('../services/wallet');
const { asyncWrap } = require('../utils/errors');

// Marge (en centimes) sur le relevé : Σ(transfer_out × prix de revente) − coût
// d'acquisition (topup + transfer_in). Le tout depuis le ledger, recalculé.
function computeMargin(entries) {
  let resold = 0; // valeur revendue (crédits sortis × prix appliqué)
  let acquiredCost = 0; // ce que ce compte a payé pour ses crédits entrants
  for (const e of entries) {
    const price = e.priceCents || 0;
    if (e.reason === 'transfer_out') resold += Math.abs(e.delta) * price;
    if (e.reason === 'transfer_in' || e.reason === 'topup') acquiredCost += e.delta * price;
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
      if (e.reason === 'topup' || e.reason === 'transfer_in') m.acquired += e.delta;
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
      series.push(months.get(k) || { month: k, acquired: 0, resold: 0, consumed: 0, marginCents: 0 });
    }
    res.json({ series });
  })
);

module.exports = router;
