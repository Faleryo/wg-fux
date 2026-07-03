/**
 * Verrou anti-sabotage de la licence (côté instance revendeur).
 *
 * Une instance qui a tourné sous licence est marquée en base (app_settings
 * 'license_locked'). Si le client root efface WG_FUX_LICENSE_KEY de son .env,
 * l'instance est traitée comme EXPIRÉE (création bloquée, VPN intact) — pas
 * comme une instance mère illimitée. Une instance jamais licenciée (la vraie
 * mère) reste illimitée.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
const crypto = require('crypto');
const os = require('os');
const path = require('path');

process.env.WG_FUX_MASTER_KEY =
  process.env.WG_FUX_MASTER_KEY || crypto.randomBytes(32).toString('hex');
// État licence dans un fichier jetable (pas le data/ du repo).
process.env.LICENSE_STATE_PATH = path.join(
  os.tmpdir(),
  `license-state-${crypto.randomBytes(4).toString('hex')}.json`
);

let license;

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  license = require('../src/services/license');
});

afterEach(() => {
  delete process.env.WG_FUX_LICENSE_KEY;
  delete process.env.WG_FUX_PLATFORM_URL;
  vi.unstubAllGlobals();
});

describe('licence — verrou anti-sabotage', () => {
  it('instance jamais licenciée (mère) : tout permis, pas de bandeau', () => {
    expect(license.licenseEnabled()).toBe(false);
    expect(license.isLicensed()).toBe(true);
    expect(license.licenseStatus().enabled).toBe(false);
    expect(license.licenseStatus().tampered).toBe(false);
  });

  it('clé retirée APRÈS un boot licencié → traitée comme expirée (tampered)', async () => {
    process.env.WG_FUX_LICENSE_KEY = 'k'.repeat(32);
    process.env.WG_FUX_PLATFORM_URL = 'https://mere.test';
    // Plateforme injoignable : le verrou doit être posé AVANT le réseau.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    await license.checkLicenseNow();
    // Clé présente + plateforme down → grâce de 7 j, toujours licencié.
    expect(license.isLicensed()).toBe(true);

    // Sabotage : le client efface la clé de son .env.
    delete process.env.WG_FUX_LICENSE_KEY;
    delete process.env.WG_FUX_PLATFORM_URL;

    expect(license.licenseEnabled()).toBe(false);
    expect(license.isLicensed()).toBe(false); // création bloquée
    const st = license.licenseStatus();
    expect(st.tampered).toBe(true);
    expect(st.enabled).toBe(true); // l'UI affiche le bandeau licence
    expect(st.valid).toBe(false);
  });

  it('clé restaurée → le fonctionnement licencié normal reprend', async () => {
    process.env.WG_FUX_LICENSE_KEY = 'k'.repeat(32);
    process.env.WG_FUX_PLATFORM_URL = 'https://mere.test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
        }),
      })
    );
    await license.checkLicenseNow();
    expect(license.isLicensed()).toBe(true);
    expect(license.licenseStatus().tampered).toBe(false);
  });
});
