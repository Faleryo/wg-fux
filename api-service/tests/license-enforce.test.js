/**
 * Application des grants signés côté INSTANCE (isLicensed).
 *
 * Le cœur de l'anti-bypass : en mode durci (pubkey provisionnée), éditer
 * license-state.json ne suffit plus — il faut un grant SIGNÉ par la mère, lié à
 * la clé de licence de CETTE instance, frais et non expiré.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');

const GRACE_MS = 7 * 24 * 3600 * 1000;
const INSTANCE_KEY = 'INSTANCE-LICENSE-KEY-XYZ';

// Ces tests mutent process.env globalement (clés de licence/signature). Sans
// nettoyage, un fichier de test suivant hériterait d'une "instance licenciée
// durcie" et verrait sa création de clients bloquée. On restaure après CHAQUE test.
const ENV_KEYS = [
  'LICENSE_SIGNING_PRIVKEY',
  'LICENSE_SIGNING_PUBKEY',
  'WG_FUX_LICENSE_KEY',
  'WG_FUX_PLATFORM_URL',
  'LICENSE_STATE_PATH',
];
const _envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (_envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = _envSnapshot[k];
  }
});

// Pose les clés (mère+instance dans le même process de test) dans l'env. Ces clés
// PERSISTENT à travers vi.resetModules() → signature et vérification partagent
// la même paire.
function setupKeys({ withPubkey = true, licenseKey = INSTANCE_KEY } = {}) {
  const ls = require('../src/services/licenseSign');
  const kp = ls.generateKeyPairB64();
  process.env.LICENSE_SIGNING_PRIVKEY = kp.privateKey;
  process.env.LICENSE_SIGNING_PUBKEY = withPubkey ? kp.publicKey : '';
  process.env.WG_FUX_LICENSE_KEY = licenseKey;
  process.env.WG_FUX_PLATFORM_URL = 'https://mother.test';
  ls._resetCache();
  return ls;
}

// Grant signé (côté "mère") pour une clé donnée.
function signedState(
  ls,
  { keyForGrant = INSTANCE_KEY, valid = true, expiresInDays = 30, issuedAgoMs = 0 } = {}
) {
  const grant = {
    v: 1,
    keyId: ls.keyIdFor(keyForGrant),
    serverId: 7,
    valid,
    expiresAt: new Date(Date.now() + expiresInDays * 86400_000).toISOString(),
    maxClients: null,
    issuedAt: Date.now() - issuedAgoMs,
  };
  const { sig } = ls.signGrant(grant);
  return { grant, grantSig: sig, valid, expiresAt: grant.expiresAt, lastCheckOk: Date.now() };
}

// Charge une instance FRAÎCHE de license.js lisant un license-state.json donné.
// Les clés en env (posées par setupKeys) survivent au resetModules.
function loadLicense(state) {
  vi.resetModules();
  const stateFile = path.join(os.tmpdir(), `lic-state-${Date.now()}-${Math.random()}.json`);
  process.env.LICENSE_STATE_PATH = stateFile;
  if (state) fs.writeFileSync(stateFile, JSON.stringify(state));
  return require('../src/services/license');
}

describe('isLicensed — mode durci (grants signés)', () => {
  it('grant signé valide, non expiré, frais → licencié', () => {
    const ls = setupKeys();
    const license = loadLicense(signedState(ls));
    expect(license.isLicensed()).toBe(true);
  });

  it('ANTI-BYPASS : valid:true SANS grant signé → refusé', () => {
    setupKeys();
    const license = loadLicense({
      valid: true,
      expiresAt: '2099-01-01T00:00:00.000Z',
      lastCheckOk: Date.now(),
    });
    expect(license.isLicensed()).toBe(false);
  });

  it('ANTI-BYPASS : grant altéré (valid retourné à true) → signature KO → refusé', () => {
    const ls = setupKeys();
    const st = signedState(ls, { valid: false });
    st.grant = { ...st.grant, valid: true }; // on force valid, la sig ne colle plus
    st.valid = true;
    const license = loadLicense(st);
    expect(license.isLicensed()).toBe(false);
  });

  it('grant signé pour une AUTRE clé de licence → keyId ne matche pas → refusé', () => {
    const ls = setupKeys();
    const license = loadLicense(signedState(ls, { keyForGrant: 'AUTRE-INSTANCE-KEY' }));
    expect(license.isLicensed()).toBe(false);
  });

  it('grant signé mais EXPIRÉ (expiresAt passé) → refusé', () => {
    const ls = setupKeys();
    const license = loadLicense(signedState(ls, { expiresInDays: -1 }));
    expect(license.isLicensed()).toBe(false);
  });

  it('grant signé mais PÉRIMÉ (issuedAt au-delà de la grâce) → refusé', () => {
    const ls = setupKeys();
    const license = loadLicense(signedState(ls, { issuedAgoMs: GRACE_MS + 86400_000 }));
    expect(license.isLicensed()).toBe(false);
  });

  it('rétro-compat : sans pubkey, un état legacy valid:true reste honoré', () => {
    setupKeys({ withPubkey: false });
    const license = loadLicense({
      valid: true,
      expiresAt: null,
      lastCheckOk: Date.now(),
      firstFailure: null,
    });
    expect(license.isLicensed()).toBe(true);
  });
});
