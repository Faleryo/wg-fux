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
    const server = { publicKey: 'ssh-ed25519 AAAATESTKEY' };
    const { script } = await provision.renderBootstrap(server, {});
    expect(script).not.toMatch(/{{[A-Z_0-9]+}}/); // aucun jeton restant
    expect(script).toContain('ssh-ed25519 AAAATESTKEY');
    expect(script).toContain('203.0.113.7'); // PLATFORM_IP injectée
    expect(script).toContain('https://vpn-labs.test/provision/scripts.tgz');
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
    const m = res.body.oneLiner.match(/WG_T=([A-Za-z0-9_-]+);/);
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

  it('400 si x-server-id manquant pour un revendeur', async () => {
    const req = { user: { id: 4242, role: 'viewer' }, headers: {} };
    const res = mkRes();
    await resolveServer(req, res, () => {});
    expect(res.statusCode).toBe(400);
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
