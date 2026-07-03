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

// Statements préparés PARESSEUX + transactions : ce module est requis (via les
// routes) AVANT que initializeDatabase() ne crée wallets/ledger. Une préparation
// au chargement échouerait ("no such table: wallets"). On prépare donc à la 1re
// utilisation (les tables existent alors), en mémoïsant.
const SQL = {
  balance: 'SELECT balance FROM wallets WHERE userId = ?',
  ensureWallet:
    'INSERT INTO wallets (userId, balance, updatedAt) VALUES (?, 0, ?) ON CONFLICT(userId) DO NOTHING',
  setBalance: 'UPDATE wallets SET balance = ?, updatedAt = ? WHERE userId = ?',
  insertLedger: `INSERT INTO ledger (userId, delta, reason, priceCents, counterpartyId, ref, createdAt)
     VALUES (@userId, @delta, @reason, @priceCents, @counterpartyId, @ref, @createdAt)`,
  sumLedger: 'SELECT COALESCE(SUM(delta), 0) AS s FROM ledger WHERE userId = ?',
  statement:
    'SELECT id, delta, reason, priceCents, counterpartyId, ref, createdAt FROM ledger WHERE userId = ? ORDER BY id DESC LIMIT ?',
};
const _cache = {};
function stmt(name) {
  if (!_cache[name]) _cache[name] = sqlite.prepare(SQL[name]);
  return _cache[name];
}

// Transactions préparées paresseusement (mêmes contraintes de timing).
const _tx = {};
function tx(name, fn) {
  if (!_tx[name]) _tx[name] = sqlite.transaction(fn);
  return _tx[name];
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function ensureWallet(userId) {
  stmt('ensureWallet').run(userId, nowSec());
}

function getBalance(userId) {
  const row = stmt('balance').get(userId);
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
  stmt('insertLedger').run({
    userId,
    delta,
    reason: meta.reason,
    priceCents: meta.priceCents ?? null,
    counterpartyId: meta.counterpartyId ?? null,
    ref: meta.ref ?? null,
    createdAt: nowSec(),
  });
  stmt('setBalance').run(next, nowSec(), userId);
  return next;
}

// Crédit (admin top-up, remboursement…). Renvoie le nouveau solde.
function credit(userId, amount, reason, meta = {}) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Montant invalide');
  return tx('credit', (uId, amt, rsn, m) => {
    ensureWallet(uId);
    return applyDelta(uId, amt, { ...m, reason: rsn });
  })(userId, amount, reason, meta);
}

// Débit interne (ex. correction). Renvoie le nouveau solde ; lève si découvert.
function debit(userId, amount, reason, meta = {}) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Montant invalide');
  return tx('debit', (uId, amt, rsn, m) => {
    ensureWallet(uId);
    return applyDelta(uId, -amt, { ...m, reason: rsn });
  })(userId, amount, reason, meta);
}

// Transfert avec marge : 2 lignes ledger corrélées par ref. priceCents = prix de
// revente appliqué par le parent (pour le calcul de marge côté relevé).
function transfer(fromId, toId, amount, priceCents) {
  if (fromId === toId) throw new Error('Auto-transfert interdit');
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Montant invalide');
  return tx('transfer', (fId, tId, amt, price) => {
    ensureWallet(fId);
    ensureWallet(tId);
    const ref = crypto.randomUUID();
    applyDelta(fId, -amt, { reason: 'transfer_out', priceCents: price, counterpartyId: tId, ref });
    applyDelta(tId, amt, { reason: 'transfer_in', priceCents: price, counterpartyId: fId, ref });
    return { ref, fromBalance: getBalance(fId), toBalance: getBalance(tId) };
  })(fromId, toId, amount, priceCents);
}

// Relevé (N dernières lignes) + solde. Sert au calcul de marge côté route.
function statement(userId, limit = 200) {
  return { balance: getBalance(userId), entries: stmt('statement').all(userId, limit) };
}

// Réconciliation : le cache balance colle-t-il à la somme du ledger ?
function reconcile(userId) {
  const cache = getBalance(userId);
  const truth = stmt('sumLedger').get(userId).s;
  return { userId, cache, truth, ok: cache === truth };
}

module.exports = { ensureWallet, getBalance, credit, debit, transfer, statement, reconcile };
