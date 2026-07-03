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

router.get(
  '/',
  asyncWrap(async (req, res) => {
    const { balance, entries } = wallet.statement(req.user.id, 500);
    res.json({
      balance,
      margin: computeMargin(entries),
      entries: entries.slice(0, 100),
    });
  })
);

module.exports = router;
