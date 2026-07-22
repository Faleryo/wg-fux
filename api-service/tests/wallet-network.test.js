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

describe('wallet — agrégats du relevé (marge / crédits)', () => {
  // Régression : stripe.js crédite avec la raison 'topup_stripe' (et le VRAI
  // prix payé dans priceCents), mais les agrégats ne testaient que 'topup'.
  // Conséquence : les achats Stripe sortaient du coût d'acquisition (marge
  // surévaluée du montant total des achats) et de la courbe « crédits acquis ».
  const walletRoute = () => require('../src/routes/wallet');

  const ENTRIES = [
    { reason: 'topup', delta: 100, priceCents: 100 }, // top-up manuel : 100 €
    { reason: 'topup_stripe', delta: 50, priceCents: 200 }, // achat Stripe : 100 €
    { reason: 'transfer_in', delta: 10, priceCents: 150 }, // reçu : 15 €
    { reason: 'transfer_out', delta: -20, priceCents: 300 }, // revendu : 60 €
    { reason: 'client_renewal', delta: -5, priceCents: null }, // consommé
  ];

  it('compte les achats Stripe dans le coût d’acquisition', () => {
    const { acquiredCostCents, resoldCents } = walletRoute().computeMargin(ENTRIES);
    // 100*100 + 50*200 + 10*150 = 10000 + 10000 + 1500
    expect(acquiredCostCents).toBe(21500);
    expect(resoldCents).toBe(6000); // 20 * 300
    // Sans le correctif, les 10000 centimes Stripe manquaient : la marge
    // (resold - acquiredCost) était surévaluée d'exactement ce montant.
    expect(resoldCents - acquiredCostCents).toBe(-15500);
  });

  it('toute entrée positive du ledger est une acquisition reconnue', () => {
    // Garde-fou structurel : si un nouveau motif d'entrée est ajouté côté
    // écriture sans être déclaré, ce test tombe au lieu de fausser la marge.
    const positives = [...new Set(ENTRIES.filter((e) => e.delta > 0).map((e) => e.reason))];
    for (const r of positives) expect(wallet.ACQUISITION_REASONS).toContain(r);
  });

  it('computeCredits : acquis / utilisés cohérents avec les deltas', () => {
    const { acquired, used, balance } = walletRoute().computeCredits(ENTRIES, 135);
    expect(acquired).toBe(160); // 100 + 50 + 10
    expect(used).toBe(25); // 20 + 5
    expect(balance).toBe(135);
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

describe('brand — résolution white-label (T4)', () => {
  it('hérite de la marque du parent quand le compte n’en a pas', async () => {
    const brand = require('../src/services/brand');
    await brand.setBrand(n1, { name: 'Acme VPN', primaryColor: '#ff8800' });
    // n2 (enfant de n1) sans marque propre → hérite d'Acme.
    const resolved = await brand.resolveBrand(n2);
    expect(resolved.name).toBe('Acme VPN');
    expect(resolved.inherited).toBe(true);
    expect(resolved.sourceUserId).toBe(n1);
    // n1 a sa propre marque, non héritée.
    const own = await brand.resolveBrand(n1);
    expect(own.name).toBe('Acme VPN');
    expect(own.inherited).toBe(false);
    // outsider sans ancêtre marqué → défaut wg-fux.
    const def = await brand.resolveBrand(outsider);
    expect(def.name).toBe('wg-fux');
  });
});
