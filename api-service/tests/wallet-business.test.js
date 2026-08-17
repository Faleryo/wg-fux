/**
 * Agrégats du tableau de bord de revenus (routes/wallet.js).
 *
 * Fonctions PURES testées directement : c'est exactement sur ce fichier qu'un
 * motif de ledger oublié ('topup_stripe') avait déjà faussé la marge sans
 * qu'aucun test ne le voie. Le vocabulaire est verrouillé ici :
 *   CA = Σ(crédits transférés × mon prix) ; coût = mes crédits acquis ;
 *   marge = CA − coût.
 */
import { describe, it, expect } from 'vitest';

const { computeBusiness, computeTopBuyers } = require('../src/routes/wallet');

const JAN = Math.floor(Date.UTC(2026, 0, 15) / 1000); // hors mois courant
const NOW = Math.floor(Date.UTC(2026, 5, 10) / 1000); // dans le mois courant
const SINCE = Math.floor(Date.UTC(2026, 5, 1) / 1000); // début du mois courant

describe('computeBusiness', () => {
  it('calcule CA, coût et marge sur tout le relevé', () => {
    const entries = [
      { reason: 'topup', delta: 100, priceCents: 200, createdAt: JAN }, // coût 20000
      { reason: 'transfer_out', delta: -40, priceCents: 500, createdAt: JAN }, // CA 20000
      { reason: 'transfer_out', delta: -10, priceCents: 500, createdAt: NOW }, // CA 5000
    ];
    const { all } = computeBusiness(entries, SINCE);
    expect(all.revenueCents).toBe(25000);
    expect(all.costCents).toBe(20000);
    expect(all.marginCents).toBe(5000);
    expect(all.creditsSold).toBe(50);
  });

  it('isole correctement le mois en cours', () => {
    const entries = [
      { reason: 'transfer_out', delta: -40, priceCents: 500, createdAt: JAN },
      { reason: 'transfer_out', delta: -10, priceCents: 500, createdAt: NOW },
    ];
    const { month } = computeBusiness(entries, SINCE);
    expect(month.revenueCents).toBe(5000);
    expect(month.creditsSold).toBe(10);
  });

  it("compte les achats Stripe dans le coût d'acquisition", () => {
    // Régression connue : 'topup_stripe' avait été oublié → marge surévaluée.
    const entries = [
      { reason: 'topup_stripe', delta: 50, priceCents: 300, createdAt: NOW },
      { reason: 'transfer_out', delta: -50, priceCents: 400, createdAt: NOW },
    ];
    const { all } = computeBusiness(entries, SINCE);
    expect(all.costCents).toBe(15000);
    expect(all.marginCents).toBe(20000 - 15000);
  });

  it('donne marge = CA pour un compte sans coût (haut de chaîne)', () => {
    const entries = [{ reason: 'transfer_out', delta: -10, priceCents: 900, createdAt: NOW }];
    const { all } = computeBusiness(entries, SINCE);
    expect(all.costCents).toBe(0);
    expect(all.marginCents).toBe(all.revenueCents);
  });

  it('ignore les consommations internes (renouvellements) dans le CA', () => {
    const entries = [
      { reason: 'license_renewal', delta: -1, priceCents: 0, createdAt: NOW },
      { reason: 'client_renewal', delta: -1, priceCents: 0, createdAt: NOW },
    ];
    const { all } = computeBusiness(entries, SINCE);
    expect(all.revenueCents).toBe(0);
    expect(all.creditsSold).toBe(0);
  });
});

describe('computeTopBuyers', () => {
  it('classe les acheteurs par chiffre d’affaires décroissant', () => {
    const entries = [
      { reason: 'transfer_out', delta: -10, priceCents: 100, counterpartyId: 2, createdAt: JAN },
      { reason: 'transfer_out', delta: -5, priceCents: 900, counterpartyId: 3, createdAt: NOW },
      { reason: 'transfer_out', delta: -5, priceCents: 100, counterpartyId: 2, createdAt: NOW },
    ];
    const names = new Map([
      [2, 'revendeur-a'],
      [3, 'revendeur-b'],
    ]);
    const top = computeTopBuyers(entries, names);
    expect(top).toHaveLength(2);
    expect(top[0]).toMatchObject({ username: 'revendeur-b', revenueCents: 4500, credits: 5 });
    expect(top[1]).toMatchObject({ username: 'revendeur-a', revenueCents: 1500, credits: 15 });
    // La dernière transaction sert à repérer un acheteur devenu inactif.
    expect(top[1].lastAt).toBe(NOW);
  });

  it('ignore tout ce qui n’est pas une revente', () => {
    const entries = [
      { reason: 'topup', delta: 100, priceCents: 200, counterpartyId: 9, createdAt: NOW },
      { reason: 'transfer_in', delta: 10, priceCents: 500, counterpartyId: 9, createdAt: NOW },
    ];
    expect(computeTopBuyers(entries)).toHaveLength(0);
  });

  it('retombe sur un libellé lisible si le nom est inconnu', () => {
    const entries = [
      { reason: 'transfer_out', delta: -1, priceCents: 100, counterpartyId: 42, createdAt: NOW },
    ];
    expect(computeTopBuyers(entries)[0].username).toBe('#42');
  });
});
