/**
 * Invalidation du cache du bundle durci (routes/provision.js).
 *
 * BUG (découvert 2026-08-16 en provisionnant un VPS réel) : `buildBundleTarball`
 * commençait par `if (_bundleCache && !fresh) return _bundleCache`, AVANT la
 * lecture du mtime censée détecter une re-fabrication. Le code d'invalidation
 * était donc inatteignable dès que le cache était chaud.
 *
 * Conséquence : après chaque `build-protected-bundle.sh`, l'API continuait de
 * servir l'ANCIEN sha256 jusqu'à un redémarrage. Le bootstrap annonçait un
 * bundle périmé, et le VPS refusait l'installation sur
 * « sha256sum: WARNING: 1 computed checksum did NOT match » — panne silencieuse
 * du provisioning après toute release.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const provision = require('../src/routes/provision');
const { buildBundleTarball, _resetTarballCache } = provision;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wgfux-bundle-'));
const bundlePath = path.join(tmpDir, 'wg-fux-bundle.tgz');
const savedEnv = process.env.PROTECTED_BUNDLE_PATH;

const writeBundle = (content, mtimeSeconds) => {
  fs.writeFileSync(bundlePath, content);
  // mtime explicite : deux écritures rapprochées peuvent partager le même
  // horodatage et masquer le défaut qu'on veut couvrir.
  const t = new Date(mtimeSeconds * 1000);
  fs.utimesSync(bundlePath, t, t);
};

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

beforeEach(() => {
  _resetTarballCache();
  process.env.PROTECTED_BUNDLE_PATH = bundlePath;
});

afterAll(() => {
  if (savedEnv === undefined) delete process.env.PROTECTED_BUNDLE_PATH;
  else process.env.PROTECTED_BUNDLE_PATH = savedEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildBundleTarball — bundle pré-fabriqué', () => {
  it('sert le sha256 du fichier présent sur le disque', async () => {
    writeBundle('bundle-v1', 1_700_000_000);
    const r = await buildBundleTarball();
    expect(r.sha256).toBe(sha('bundle-v1'));
  });

  it('reflète une RE-FABRICATION du bundle sans redémarrage', async () => {
    writeBundle('bundle-v1', 1_700_000_000);
    const first = await buildBundleTarball();
    expect(first.sha256).toBe(sha('bundle-v1'));

    // Équivalent d'un `build-protected-bundle.sh` : même chemin, contenu neuf.
    writeBundle('bundle-v2-regenere', 1_700_000_500);

    const second = await buildBundleTarball();
    // C'est ici que le bug se manifestait : `second` restait le bundle v1.
    expect(second.sha256).toBe(sha('bundle-v2-regenere'));
    expect(second.sha256).not.toBe(first.sha256);
  });

  it('sert bien le CONTENU à jour, pas seulement une empreinte à jour', async () => {
    writeBundle('bundle-v1', 1_700_001_000);
    await buildBundleTarball();
    writeBundle('bundle-v2', 1_700_001_500);
    const r = await buildBundleTarball();
    expect(r.buffer.toString()).toBe('bundle-v2');
  });

  it('réutilise le cache tant que le fichier ne change pas', async () => {
    writeBundle('bundle-stable', 1_700_002_000);
    const a = await buildBundleTarball();
    const b = await buildBundleTarball();
    // Même objet en mémoire = aucune relecture disque inutile à chaque appel.
    expect(b).toBe(a);
  });
});
