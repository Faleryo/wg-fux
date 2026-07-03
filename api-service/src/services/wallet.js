// services/wallet.js — Portefeuille de crédits (source de vérité = ledger).
//
// Toute variation de solde passe par une écriture ledger + mise à jour du cache
// wallets.balance, DANS UNE MÊME TRANSACTION SQLite SYNCHRONE (sqlite.transaction).
// On n'utilise PAS db.transaction (drizzle) avec une fonction async : better-sqlite3
// exige un callback synchrone (sinon "Transaction function cannot return a promise").
//
// Invariants garantis :
//   - wallets.balance == SUM(ledger.delta) hors transaction
//   - jamais de solde négatif (assertion DANS la transaction)
//   - un transfert = exactement 2 lignes ledger de deltas opposés, même `ref`
//   - ledger append-only (aucun UPDATE/DELETE ici)

const crypto = require('crypto');
const { sqlite } = require('../../db');

// Statements préparés (réutilisés). better-sqlite3 = synchrone.
const stmtBalance = sqlite.prepare('SELECT balance FROM wallets WHERE userId = ?');
const stmtEnsureWallet = sqlite.prepare(
  'INSERT INTO wallets (userId, balance, updatedAt) VALUES (?, 0, ?) ON CONFLICT(userId) DO NOTHING'
);
const stmtSetBalance = sqlite.prepare(
  'UPDATE wallets SET balance = ?, updatedAt = ? WHERE userId = ?'
);
const stmtInsertLedger = sqlite.prepare(
  `INSERT INTO ledger (userId, delta, reason, priceCents, counterpartyId, ref, createdAt)
   VALUES (@userId, @delta, @reason, @priceCents, @counterpartyId, @ref, @createdAt)`
);
const stmtSumLedger = sqlite.prepare(
  'SELECT COALESCE(SUM(delta), 0) AS s FROM ledger WHERE userId = ?'
);
const stmtStatement = sqlite.prepare(
  'SELECT id, delta, reason, priceCents, counterpartyId, ref, createdAt FROM ledger WHERE userId = ? ORDER BY id DESC LIMIT ?'
);

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function ensureWallet(userId) {
  stmtEnsureWallet.run(userId, nowSec());
}

function getBalance(userId) {
  const row = stmtBalance.get(userId);
  return row ? row.balance : 0;
}

// Applique un delta au solde + écrit une ligne ledger, dans la transaction en cours.
// (helper interne : suppose ensureWallet déjà appelé)
function applyDelta(userId, delta, meta) {
  const current = getBalance(userId);
  const next = current + delta;
  if (next < 0) {
    const err = new Error('Solde insuffisant');
    err.code = 'INSUFFICIENT_FUNDS';
    throw err;
  }
  stmtInsertLedger.run({
    userId,
    delta,
    reason: meta.reason,
    priceCents: meta.priceCents ?? null,
    counterpartyId: meta.counterpartyId ?? null,
    ref: meta.ref ?? null,
    createdAt: nowSec(),
  });
  stmtSetBalance.run(next, nowSec(), userId);
  return next;
}

// Crédit (admin top-up, remboursement…). Renvoie le nouveau solde.
const credit = sqlite.transaction((userId, amount, reason, meta = {}) => {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Montant invalide');
  ensureWallet(userId);
  return applyDelta(userId, amount, { ...meta, reason });
});

// Débit interne (ex. correction). Renvoie le nouveau solde ; lève si découvert.
const debit = sqlite.transaction((userId, amount, reason, meta = {}) => {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Montant invalide');
  ensureWallet(userId);
  return applyDelta(userId, -amount, { ...meta, reason });
});

// Transfert avec marge : 2 lignes ledger corrélées par ref. priceCents = prix de
// revente appliqué par le parent (pour le calcul de marge côté relevé).
const transfer = sqlite.transaction((fromId, toId, amount, priceCents) => {
  if (fromId === toId) throw new Error('Auto-transfert interdit');
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Montant invalide');
  ensureWallet(fromId);
  ensureWallet(toId);
  const ref = crypto.randomUUID();
  applyDelta(fromId, -amount, { reason: 'transfer_out', priceCents, counterpartyId: toId, ref });
  applyDelta(toId, amount, { reason: 'transfer_in', priceCents, counterpartyId: fromId, ref });
  return { ref, fromBalance: getBalance(fromId), toBalance: getBalance(toId) };
});

// Relevé (N dernières lignes) + solde. Sert au calcul de marge côté route.
function statement(userId, limit = 200) {
  return { balance: getBalance(userId), entries: stmtStatement.all(userId, limit) };
}

// Réconciliation : le cache balance colle-t-il à la somme du ledger ?
function reconcile(userId) {
  const cache = getBalance(userId);
  const truth = stmtSumLedger.get(userId).s;
  return { userId, cache, truth, ok: cache === truth };
}

module.exports = { ensureWallet, getBalance, credit, debit, transfer, statement, reconcile };
