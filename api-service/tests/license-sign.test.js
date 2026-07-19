/**
 * Grants de licence signés (Ed25519) — cœur cryptographique.
 * Prouve : roundtrip sign/verify, détection d'altération, rejet cross-instance
 * (keyId), et rétro-compatibilité (sans clé → désactivé, jamais de faux positif).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let ls;
let KP;
const saved = {};

beforeAll(() => {
  ls = require('../src/services/licenseSign');
  KP = ls.generateKeyPairB64();
  saved.priv = process.env.LICENSE_SIGNING_PRIVKEY;
  saved.pub = process.env.LICENSE_SIGNING_PUBKEY;
});

afterAll(() => {
  if (saved.priv === undefined) delete process.env.LICENSE_SIGNING_PRIVKEY;
  else process.env.LICENSE_SIGNING_PRIVKEY = saved.priv;
  if (saved.pub === undefined) delete process.env.LICENSE_SIGNING_PUBKEY;
  else process.env.LICENSE_SIGNING_PUBKEY = saved.pub;
  ls._resetCache();
});

const withKeys = (priv, pub) => {
  if (priv === null) delete process.env.LICENSE_SIGNING_PRIVKEY;
  else process.env.LICENSE_SIGNING_PRIVKEY = priv;
  if (pub === null) delete process.env.LICENSE_SIGNING_PUBKEY;
  else process.env.LICENSE_SIGNING_PUBKEY = pub;
  ls._resetCache();
};

const sampleGrant = () => ({
  v: 1,
  keyId: ls.keyIdFor('LICENSE-KEY-ABC'),
  serverId: 42,
  valid: true,
  expiresAt: '2027-01-01T00:00:00.000Z',
  maxClients: 50,
  issuedAt: Date.now(),
});

describe('licenseSign (Ed25519)', () => {
  it('roundtrip : un grant signé par la mère est vérifié par l’instance', () => {
    withKeys(KP.privateKey, KP.publicKey);
    const { grant, sig } = ls.signGrant(sampleGrant());
    expect(typeof sig).toBe('string');
    expect(ls.verifyGrant(grant, sig)).toBe(true);
  });

  it('altération du grant → signature invalide', () => {
    withKeys(KP.privateKey, KP.publicKey);
    const { grant, sig } = ls.signGrant(sampleGrant());
    const tampered = { ...grant, valid: grant.valid, maxClients: 999999 }; // hausse du plafond
    expect(ls.verifyGrant(tampered, sig)).toBe(false);
  });

  it('passer valid:false → true casse la signature (le cœur de l’anti-bypass)', () => {
    withKeys(KP.privateKey, KP.publicKey);
    const { grant, sig } = ls.signGrant({ ...sampleGrant(), valid: false });
    const forged = { ...grant, valid: true };
    expect(ls.verifyGrant(forged, sig)).toBe(false);
  });

  it('clé publique d’une AUTRE mère → refus', () => {
    const other = ls.generateKeyPairB64();
    withKeys(KP.privateKey, other.publicKey); // signé par KP, vérifié avec autre pubkey
    const { grant, sig } = ls.signGrant(sampleGrant());
    expect(ls.verifyGrant(grant, sig)).toBe(false);
  });

  it('keyId : le grant est lié à la clé de licence (anti-rejeu cross-instance)', () => {
    expect(ls.keyIdFor('KEY-A')).not.toBe(ls.keyIdFor('KEY-B'));
    expect(ls.keyIdFor('KEY-A')).toBe(ls.keyIdFor('KEY-A')); // stable
  });

  it('rétro-compat : sans pubkey, verificationEnabled=false et verifyGrant=false', () => {
    withKeys(KP.privateKey, null);
    expect(ls.verificationEnabled()).toBe(false);
    // Jamais de faux positif quand la vérification est désactivée.
    const { grant, sig } = (() => {
      withKeys(KP.privateKey, KP.publicKey);
      const r = ls.signGrant(sampleGrant());
      withKeys(KP.privateKey, null);
      return r;
    })();
    expect(ls.verifyGrant(grant, sig)).toBe(false);
  });

  it('signingEnabled/verificationEnabled reflètent la présence des clés', () => {
    withKeys(null, null);
    expect(ls.signingEnabled()).toBe(false);
    expect(ls.verificationEnabled()).toBe(false);
    withKeys(KP.privateKey, KP.publicKey);
    expect(ls.signingEnabled()).toBe(true);
    expect(ls.verificationEnabled()).toBe(true);
  });
});
