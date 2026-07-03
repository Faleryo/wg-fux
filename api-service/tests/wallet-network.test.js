/**
 * Réseau de distribution : portefeuille (T1) + hiérarchie/marge (T2).
 * Invariants monétaires : pas de découvert, ledger = vérité, transfert = 2 lignes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
const crypto = require('crypto');

process.env.WG_FUX_MASTER_KEY =
  process.env.WG_FUX_MASTER_KEY || crypto.randomBytes(32).toString('hex');

let db, schema, eq, wallet, scope;
let admin, n1, n2, outsider;

async function mkUser(role, parentId = null, sellPriceCents = null) {
  const [u] = await db
    .insert(schema.users)
    .values({
      username: `${role}-${crypto.randomBytes(4).toString('hex')}`,
      hash: 'x',
      salt: 'y',
      role,
      parentId,
      sellPriceCents,
    })
    .returning({ id: schema.users.id });
  return u.id;
}

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ db, schema } = require('../db'));
  ({ eq } = require('drizzle-orm'));
  wallet = require('../src/services/wallet');
  scope = require('../src/services/scope');

  admin = await mkUser('admin');
  n1 = await mkUser('reseller', null, 150); // revend 1 crédit à 1,50 €
  n2 = await mkUser('reseller', n1);
  outsider = await mkUser('reseller', null);
});

describe('wallet — invariants comptables', () => {
  it('crédit puis relevé : balance == SUM(ledger)', () => {
    wallet.credit(n1, 100, 'topup', { priceCents: 100 });
    expect(wallet.getBalance(n1)).toBe(100);
    expect(wallet.reconcile(n1).ok).toBe(true);
  });

  it('refuse un débit à découvert (solde inchangé)', () => {
    const before = wallet.getBalance(n2);
    expect(() => wallet.debit(n2, before + 5, 'monthly')).toThrow(/insuffisant/i);
    expect(wallet.getBalance(n2)).toBe(before);
  });

  it('transfert = 2 lignes corrélées, soldes déplacés, marge traçable', () => {
    const startN1 = wallet.getBalance(n1);
    const { ref } = wallet.transfer(n1, n2, 10, 150);
    expect(wallet.getBalance(n1)).toBe(startN1 - 10);
    expect(wallet.getBalance(n2)).toBe(10);
    // Deux lignes ledger de même ref, deltas opposés.
    const stN1 = wallet.statement(n1).entries.find((e) => e.ref === ref);
    const stN2 = wallet.statement(n2).entries.find((e) => e.ref === ref);
    expect(stN1.delta).toBe(-10);
    expect(stN2.delta).toBe(10);
    expect(stN1.priceCents).toBe(150);
    expect(wallet.reconcile(n1).ok).toBe(true);
    expect(wallet.reconcile(n2).ok).toBe(true);
  });

  it('interdit l’auto-transfert', () => {
    expect(() => wallet.transfer(n1, n1, 1, 100)).toThrow(/auto-transfert/i);
  });
});

describe('scope — sous-arbre', () => {
  it('descendantIds inclut root + enfants, exclut les autres', () => {
    const ids = scope.descendantIds(n1);
    expect(ids).toContain(n1);
    expect(ids).toContain(n2);
    expect(ids).not.toContain(outsider);
    expect(scope.isInScope(n1, n2)).toBe(true);
    expect(scope.isInScope(n1, outsider)).toBe(false);
  });
});
