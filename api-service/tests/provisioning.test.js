/**
 * Tests du provisioning one-liner (mode revendeur).
 *
 * Couvre :
 *  - sshKeys : génération paire/token, hash, vérif constante-temps.
 *  - renderBootstrap : tous les {{...}} substitués, aucun jeton résiduel.
 *  - sha256 du one-liner == sha256 du script rendu.
 *  - token de provisioning : usage unique + expiration.
 *  - resolveServer : 403 si ownerId != user.
 *  - verifyServer : online seulement si l'executor SSH réussit (mocké).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
const crypto = require('crypto');

// Clé maître requise par services/crypto.js (non posée par tests/setup.js).
process.env.WG_FUX_MASTER_KEY =
  process.env.WG_FUX_MASTER_KEY || crypto.randomBytes(32).toString('hex');
process.env.PLATFORM_BASE_URL = 'https://vpn-labs.test';
process.env.PLATFORM_PUBLIC_IP = '203.0.113.7';

let db, schema, eq;

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ db, schema } = require('../db'));
  ({ eq } = require('drizzle-orm'));
  // Un user revendeur pour les FK ownerId.
  await db
    .insert(schema.users)
    .values({ id: 4242, username: 'reseller-test', hash: 'x', salt: 'y', role: 'viewer' })
    .onConflictDoNothing();
  await db
    .insert(schema.users)
    .values({ id: 4343, username: 'reseller-other', hash: 'x', salt: 'y', role: 'viewer' })
    .onConflictDoNothing();
});

describe('sshKeys', () => {
  const sshKeys = require('../src/services/sshKeys');

  it('génère une paire ed25519 (privée OpenSSH + publique ssh-ed25519)', () => {
    const { privateKey, publicKey } = sshKeys.generateKeyPair();
    expect(privateKey).toContain('BEGIN OPENSSH PRIVATE KEY');
    expect(publicKey).toMatch(/^ssh-ed25519 AAAA/);
  });

  it('génère des tokens uniques en base64url, hash sha256 stable', () => {
    const t1 = sshKeys.generateToken();
    const t2 = sshKeys.generateToken();
    expect(t1).not.toBe(t2);
    expect(t1).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(sshKeys.hashToken(t1)).toBe(sshKeys.hashToken(t1));
    expect(sshKeys.hashToken(t1)).toHaveLength(64); // sha256 hex
  });

  it('verifyToken : vrai pour le bon token, faux sinon (constante-temps)', () => {
    const token = sshKeys.generateToken();
    const hash = sshKeys.hashToken(token);
    expect(sshKeys.verifyToken(token, hash)).toBe(true);
    expect(sshKeys.verifyToken('mauvais', hash)).toBe(false);
    expect(sshKeys.verifyToken(token, '')).toBe(false);
    expect(sshKeys.verifyToken('', hash)).toBe(false);
  });
});

describe('renderBootstrap', () => {
  const provision = require('../src/routes/provision');

  it('substitue TOUS les jetons {{...}} (aucun résiduel)', async () => {
    const server = { host: '198.51.100.10', licenseKey: 'LICKEY-TEST-123' };
    const { script } = await provision.renderBootstrap(server, {});
    expect(script).not.toMatch(/{{[A-Z_0-9]+}}/); // aucun jeton restant
    expect(script).toContain('https://vpn-labs.test'); // PLATFORM_BASE injectée
    expect(script).toContain('LICKEY-TEST-123'); // licence de l'instance injectée
    expect(script).toMatch(/BUNDLE_SHA256='[a-f0-9]{64}'/); // intégrité du bundle
    expect(script).toContain('setup.sh --install'); // lance l'installateur interactif
    expect(script).not.toContain('git clone'); // le code part via bundle, pas via git
  });

  it('le bundle produit exclut secrets/VCS et contient le produit', async () => {
    const { buffer, sha256 } = await provision.buildBundleTarball();
    expect(buffer.length).toBeGreaterThan(1000);
    expect(sha256).toHaveLength(64);
    const { execFileSync } = require('child_process');
    const list = execFileSync('tar', ['-tzf', '-'], { input: buffer, maxBuffer: 64 * 1024 * 1024 })
      .toString();
    expect(list).toContain('./setup.sh');
    expect(list).toContain('./docker-compose.yml');
    expect(list).toMatch(/\.\/api-service\/server\.js/);
    expect(list).not.toMatch(/\.git\//); // jamais l'historique git
    expect(list).not.toMatch(/node_modules/);
    expect(list).not.toMatch(/^\.\/docs\//m); // doc interne exclue
    expect(list).not.toMatch(/\.env$/m); // jamais de secrets
  });

  it('le bundle sert le template nginx COMMITTÉ (pas les modifs locales de la prod)', async () => {
    // Régression : setup-ssl.sh réécrit les chemins ssl_certificate en prod ;
    // un bundle du working tree embarquerait ces chemins Let's Encrypt → nginx
    // planterait chez chaque revendeur. git archive HEAD garantit le template propre.
    const { buffer } = await provision.buildBundleTarball();
    const { execFileSync } = require('child_process');
    const conf = execFileSync('tar', ['-xzOf', '-', './infra/nginx/default.conf'], {
      input: buffer,
      maxBuffer: 16 * 1024 * 1024,
    }).toString();
    expect(conf).toContain('/etc/nginx/ssl/server.crt'); // cert bootstrap auto-signé
    expect(conf).not.toContain('/etc/letsencrypt/live/'); // jamais les chemins d'une prod
  });

  it('le sha256 du script rendu est déterministe', async () => {
    const server = { publicKey: 'ssh-ed25519 AAAASTABLE' };
    const a = await provision.renderBootstrap(server, {});
    const b = await provision.renderBootstrap(server, {});
    expect(a.sha256).toBe(b.sha256);
    const recomputed = crypto.createHash('sha256').update(a.script, 'utf8').digest('hex');
    expect(a.sha256).toBe(recomputed);
  });

  it('le tarball des scripts a un sha256 déterministe et non vide', async () => {
    const { buffer, sha256 } = await provision.buildScriptsTarball();
    expect(buffer.length).toBeGreaterThan(0);
    expect(sha256).toHaveLength(64);
  });
});

describe('buildBundleTarball : fail-closed REQUIRE_PROTECTED_BUNDLE', () => {
  const provision = require('../src/routes/provision');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  // Sauvegarde/restaure l'env pour ne pas polluer les autres suites.
  let savedRequire, savedPath;
  beforeEach(() => {
    savedRequire = process.env.REQUIRE_PROTECTED_BUNDLE;
    savedPath = process.env.PROTECTED_BUNDLE_PATH;
  });
  const restore = () => {
    if (savedRequire === undefined) delete process.env.REQUIRE_PROTECTED_BUNDLE;
    else process.env.REQUIRE_PROTECTED_BUNDLE = savedRequire;
    if (savedPath === undefined) delete process.env.PROTECTED_BUNDLE_PATH;
    else process.env.PROTECTED_BUNDLE_PATH = savedPath;
  };

  it('flag actif SANS bundle durci → REFUS (pas de repli sur le code source)', async () => {
    process.env.REQUIRE_PROTECTED_BUNDLE = '1';
    delete process.env.PROTECTED_BUNDLE_PATH;
    // fresh: true contourne le cache module pour ré-évaluer le garde-fou.
    await expect(provision.buildBundleTarball({ fresh: true })).rejects.toMatchObject({
      code: 'PROTECTED_BUNDLE_UNAVAILABLE',
    });
    restore();
  });

  it('flag actif avec PROTECTED_BUNDLE_PATH illisible → REFUS (pas de repli source)', async () => {
    process.env.REQUIRE_PROTECTED_BUNDLE = 'true';
    process.env.PROTECTED_BUNDLE_PATH = path.join(os.tmpdir(), 'nope-does-not-exist.tgz');
    await expect(provision.buildBundleTarball({ fresh: true })).rejects.toMatchObject({
      code: 'PROTECTED_BUNDLE_UNAVAILABLE',
    });
    restore();
  });

  it('flag actif AVEC bundle durci lisible → sert ce bundle (fail-open quand présent)', async () => {
    const tmp = path.join(os.tmpdir(), `bundle-test-${Date.now()}.tgz`);
    fs.writeFileSync(tmp, Buffer.from('FAKE_HARDENED_BUNDLE_CONTENT'));
    process.env.REQUIRE_PROTECTED_BUNDLE = '1';
    process.env.PROTECTED_BUNDLE_PATH = tmp;
    const { buffer, sha256 } = await provision.buildBundleTarball({ fresh: true });
    expect(buffer.toString()).toBe('FAKE_HARDENED_BUNDLE_CONTENT');
    expect(sha256).toHaveLength(64);
    fs.unlinkSync(tmp);
    restore();
  });

  it('flag INACTIF (défaut) → repli git archive conservé (non-breaking)', async () => {
    delete process.env.REQUIRE_PROTECTED_BUNDLE;
    delete process.env.PROTECTED_BUNDLE_PATH;
    const { buffer } = await provision.buildBundleTarball({ fresh: true });
    expect(buffer.length).toBeGreaterThan(1000); // git archive sert le produit
    restore();
  });
});

describe('POST /api/servers → one-liner', () => {
  let app, request;
  beforeAll(async () => {
    request = require('supertest');
    const { app: expressApp } = require('../server');
    app = expressApp;
    process.env.TEST_BYPASS_AUTH = 'true'; // req.user = admin id:1
  });

  it('crée un serveur pending, renvoie un one-liner dont le WG_H == sha256 du script', async () => {
    // admin user id:1 doit exister pour la FK ownerId.
    await db
      .insert(schema.users)
      .values({ id: 1, username: 'admin', hash: 'x', salt: 'y', role: 'admin' })
      .onConflictDoNothing();

    const res = await request(app)
      .post('/api/servers')
      .set('x-api-token', 'bypass')
      .send({ label: 'VPS-Test', host: '198.51.100.10', port: 22 });

    expect(res.statusCode).toBe(200);
    expect(res.body.serverId).toBeTypeOf('number');
    expect(res.body.scriptSha256).toHaveLength(64);
    expect(res.body.oneLiner).toContain(`WG_H=${res.body.scriptSha256}`);
    expect(res.body.oneLiner).toContain('WG_T=');
    expect(res.body.oneLiner).not.toContain('--pinnedpubkey'); // pas de TLS pin en test

    // Récupère le token brut depuis le one-liner et vérifie que son hash matche la base.
    // Format durci : `WG_T=<token> WG_H=<sha> bash -c '...'` (assignations d'env
    // espacées, plus de `;`).
    const m = res.body.oneLiner.match(/WG_T=([A-Za-z0-9_-]+)\s/);
    expect(m).toBeTruthy();
    const token = m[1];
    const { hashToken } = require('../src/services/sshKeys');
    const [row] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, res.body.serverId))
      .limit(1);
    expect(row.status).toBe('pending');
    expect(row.provisionTokenHash).toBe(hashToken(token));
    // La clé privée n'est JAMAIS en clair en base.
    expect(row.encPrivateKey).not.toContain('BEGIN');
  });

  it('GET /api/servers ne fuit jamais les secrets', async () => {
    const res = await request(app).get('/api/servers').set('x-api-token', 'bypass');
    expect(res.statusCode).toBe(200);
    for (const s of res.body) {
      expect(s.encPrivateKey).toBeUndefined();
      expect(s.provisionTokenHash).toBeUndefined();
      expect(s.hostKey).toBeUndefined();
    }
  });
});

describe('findServerByToken : usage unique + expiration', () => {
  const provision = require('../src/routes/provision');
  const { hashToken } = require('../src/services/sshKeys');

  async function seedServer({ token, expiryMs }) {
    const [row] = await db
      .insert(schema.servers)
      .values({
        ownerId: 4242,
        label: 'tok-test-' + Math.random().toString(36).slice(2),
        host: 'h-' + Math.random().toString(36).slice(2),
        port: 22,
        publicKey: 'ssh-ed25519 AAAA',
        status: 'pending',
        provisionTokenHash: hashToken(token),
        provisionTokenExpiry: new Date(Date.now() + expiryMs),
      })
      .returning();
    return row;
  }

  it('retrouve le serveur pour un token valide non-expiré', async () => {
    const token = 'valid-token-' + crypto.randomBytes(8).toString('hex');
    const row = await seedServer({ token, expiryMs: 60_000 });
    const found = await provision.findServerByToken(token);
    expect(found).toBeTruthy();
    expect(found.id).toBe(row.id);
  });

  it('refuse un token expiré', async () => {
    const token = 'expired-token-' + crypto.randomBytes(8).toString('hex');
    await seedServer({ token, expiryMs: -1000 }); // déjà expiré
    const found = await provision.findServerByToken(token);
    expect(found).toBeNull();
  });

  it('usage unique : après consommation (hash effacé) le token ne marche plus', async () => {
    const token = 'once-token-' + crypto.randomBytes(8).toString('hex');
    const row = await seedServer({ token, expiryMs: 60_000 });
    expect(await provision.findServerByToken(token)).toBeTruthy();
    // Simule la consommation par verifyServer (succès).
    await db
      .update(schema.servers)
      .set({ provisionTokenHash: null, provisionTokenExpiry: null })
      .where(eq(schema.servers.id, row.id));
    expect(await provision.findServerByToken(token)).toBeNull();
  });
});

describe('POST /license/heartbeat (endpoint de facturation)', () => {
  let app, request;
  beforeAll(async () => {
    request = require('supertest');
    ({ app } = require('../server'));
  });

  async function seedLicensed({ key, expiryMs, targetVersion = null }) {
    const [row] = await db
      .insert(schema.servers)
      .values({
        ownerId: 4242,
        label: 'lic-' + Math.random().toString(36).slice(2),
        host: 'lic-host-' + Math.random().toString(36).slice(2),
        port: 22,
        status: 'online',
        licenseKey: key,
        licenseExpiry: new Date(Date.now() + expiryMs),
        // Déploiement gouverné : une maj n'est offerte que si approuvée.
        targetVersion,
      })
      .returning();
    return row;
  }

  const PLATFORM_VERSION = require('../package.json').version;

  it('licence valide → { valid: true } + latestVersion (si approuvée) + lastHeartbeat/clientCount', async () => {
    const key = 'lic-valid-' + crypto.randomBytes(16).toString('hex');
    const row = await seedLicensed({
      key,
      expiryMs: 30 * 86400_000,
      targetVersion: PLATFORM_VERSION, // maj approuvée par l'admin
    });
    const res = await request(app)
      .post('/license/heartbeat')
      .send({ key, version: '3.1.0', clients: 12 });
    expect(res.statusCode).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.latestVersion).toBe(PLATFORM_VERSION); // version approuvée
    const [after] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, row.id))
      .limit(1);
    expect(after.lastHeartbeat).toBeTruthy();
    expect(after.clientCount).toBe(12);
    expect(after.status).toBe('online');
  });

  it('mode durci : la réponse heartbeat porte un grant SIGNÉ vérifiable, lié à la clé', async () => {
    const ls = require('../src/services/licenseSign');
    const kp = ls.generateKeyPairB64();
    const saved = { p: process.env.LICENSE_SIGNING_PRIVKEY, u: process.env.LICENSE_SIGNING_PUBKEY };
    process.env.LICENSE_SIGNING_PRIVKEY = kp.privateKey; // la mère signe
    process.env.LICENSE_SIGNING_PUBKEY = kp.publicKey;
    ls._resetCache();
    try {
      const key = 'lic-signed-' + crypto.randomBytes(16).toString('hex');
      await seedLicensed({ key, expiryMs: 30 * 86400_000 });
      const res = await request(app).post('/license/heartbeat').send({ key, version: '3.1.0', clients: 3 });
      expect(res.statusCode).toBe(200);
      const lg = res.body.licenseGrant;
      expect(lg).toBeTruthy();
      expect(ls.verifyGrant(lg.grant, lg.sig)).toBe(true); // signature mère valide
      expect(lg.grant.keyId).toBe(ls.keyIdFor(key)); // lié à CETTE instance
      expect(lg.grant.valid).toBe(true);
      expect(typeof lg.grant.issuedAt).toBe('number');
    } finally {
      // Restaure l'env (sinon pollue les suites suivantes en mode durci).
      if (saved.p === undefined) delete process.env.LICENSE_SIGNING_PRIVKEY;
      else process.env.LICENSE_SIGNING_PRIVKEY = saved.p;
      if (saved.u === undefined) delete process.env.LICENSE_SIGNING_PUBKEY;
      else process.env.LICENSE_SIGNING_PUBKEY = saved.u;
      ls._resetCache();
    }
  });

  it('GET /license/bundle.tgz : licence valide → gzip ; expirée → 402 ; inconnue → 401', async () => {
    const validKey = 'lic-upd-ok-' + crypto.randomBytes(16).toString('hex');
    await seedLicensed({
      key: validKey,
      expiryMs: 30 * 86400_000,
      targetVersion: PLATFORM_VERSION, // sans approbation → 204 (gouverné)
    });
    const ok = await request(app)
      .get('/license/bundle.tgz')
      .set('Authorization', `Bearer ${validKey}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('gzip');
    expect(ok.headers['x-wg-fux-version']).toMatch(/^\d+\.\d+\.\d+/);

    const expiredKey = 'lic-upd-exp-' + crypto.randomBytes(16).toString('hex');
    await seedLicensed({ key: expiredKey, expiryMs: -1000 });
    const expired = await request(app)
      .get('/license/bundle.tgz')
      .set('Authorization', `Bearer ${expiredKey}`);
    expect(expired.statusCode).toBe(402); // expirée = pas de MAJ

    const unknown = await request(app)
      .get('/license/bundle.tgz')
      .set('Authorization', 'Bearer ' + 'z'.repeat(43));
    expect(unknown.statusCode).toBe(401);
  });

  it('licence expirée → { valid: false } (mais heartbeat enregistré)', async () => {
    const key = 'lic-expired-' + crypto.randomBytes(16).toString('hex');
    const row = await seedLicensed({ key, expiryMs: -1000 });
    const res = await request(app).post('/license/heartbeat').send({ key });
    expect(res.statusCode).toBe(200);
    expect(res.body.valid).toBe(false);
    const [after] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, row.id))
      .limit(1);
    expect(after.lastHeartbeat).toBeTruthy(); // la vie de l'instance reste tracée
  });

  it('clé inconnue → 401 sans fuite', async () => {
    const res = await request(app)
      .post('/license/heartbeat')
      .send({ key: 'x'.repeat(43) });
    expect(res.statusCode).toBe(401);
    expect(res.body.valid).toBe(false);
  });
});

describe('resolveServer middleware', () => {
  const resolveServer = require('../src/middleware/resolveServer');

  function mkRes() {
    return {
      statusCode: 200,
      body: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
        return this;
      },
    };
  }

  it('admin → next() sans serveur requis', async () => {
    const req = { user: { id: 1, role: 'admin' }, headers: {} };
    const res = mkRes();
    let nexted = false;
    await resolveServer(req, res, () => {
      nexted = true;
    });
    expect(nexted).toBe(true);
  });

  it('403 si le serveur n’appartient pas au revendeur', async () => {
    const [row] = await db
      .insert(schema.servers)
      .values({ ownerId: 4242, label: 'owned', host: 'owned-host', port: 2222, status: 'online' })
      .returning();
    // L'autre revendeur (4343) tente d'y accéder.
    const req = { user: { id: 4343, role: 'viewer' }, headers: { 'x-server-id': String(row.id) } };
    const res = mkRes();
    let nexted = false;
    await resolveServer(req, res, () => {
      nexted = true;
    });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('résout req.server quand le revendeur est propriétaire', async () => {
    const [row] = await db
      .insert(schema.servers)
      .values({ ownerId: 4242, label: 'mine', host: 'mine-host', port: 2223, status: 'online' })
      .returning();
    const req = { user: { id: 4242, role: 'viewer' }, headers: { 'x-server-id': String(row.id) } };
    const res = mkRes();
    let nexted = false;
    await resolveServer(req, res, () => {
      nexted = true;
    });
    expect(nexted).toBe(true);
    expect(req.serverId).toBe(row.id);
    expect(req.server.id).toBe(row.id);
  });

  it('contexte LOCAL (sans x-server-id) accepté pour un revendeur (pivot instance complète)', async () => {
    const req = { user: { id: 4242, role: 'viewer' }, headers: {} };
    const res = mkRes();
    let nexted = false;
    await resolveServer(req, res, () => {
      nexted = true;
    });
    expect(nexted).toBe(true);
    expect(req.serverId).toBeUndefined();
  });
});

describe('verifyServer : la confiance vient du SSH (executor mocké)', () => {
  const provision = require('../src/routes/provision');
  const executors = require('../src/services/executors');
  let runMock;

  beforeEach(() => {
    runMock = vi.fn();
    // Spy sur la VRAIE fonction appelée par verifyServer : on renvoie un executor
    // factice dont .run est contrôlé par le test (pas de vraie connexion SSH).
    vi.spyOn(executors, 'getExecutorForServer').mockResolvedValue({ run: runMock });
  });

  async function seedProvisioning() {
    const { encryptPrivateKey } = require('../src/services/crypto');
    const enc = encryptPrivateKey('-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END-----');
    const [row] = await db
      .insert(schema.servers)
      .values({
        ownerId: 4242,
        label: 'verify-' + Math.random().toString(36).slice(2),
        host: 'verify-' + Math.random().toString(36).slice(2),
        port: 22,
        encPrivateKey: enc.encPrivateKey,
        encKeyIv: enc.encKeyIv,
        encKeyAuth: enc.encKeyAuth,
        publicKey: 'ssh-ed25519 AAAA',
        pendingHostKey: 'ssh-ed25519 HOSTKEYAAA',
        status: 'provisioning',
        provisionTokenHash: 'somehash',
        provisionTokenExpiry: new Date(Date.now() + 60000),
      })
      .returning();
    return row;
  }

  it('succès SSH → status online, host key pinnée, token consommé', async () => {
    runMock.mockResolvedValue({ success: true, stdout: 'healthy', stderr: '', code: 0 });
    const row = await seedProvisioning();
    const result = await provision.verifyServer(row.id);
    expect(result.online).toBe(true);

    const [after] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, row.id))
      .limit(1);
    expect(after.status).toBe('online');
    expect(after.hostKey).toBe('ssh-ed25519 HOSTKEYAAA');
    expect(after.pendingHostKey).toBeNull();
    expect(after.provisionTokenHash).toBeNull(); // usage unique
  });

  it('échec SSH (host key divergente/MITM) → status error, JAMAIS online', async () => {
    runMock.mockResolvedValue({ success: false, stderr: 'host key mismatch', code: 1 });
    const row = await seedProvisioning();
    const result = await provision.verifyServer(row.id);
    expect(result.online).toBe(false);

    const [after] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, row.id))
      .limit(1);
    expect(after.status).toBe('error');
    expect(after.hostKey).toBeNull(); // rollback : pas de pin non prouvé
    expect(after.lastError).toMatch(/Vérification SSH/);
    expect(after.provisionTokenHash).toBe('somehash'); // token PAS consommé → retry possible
  });
});
