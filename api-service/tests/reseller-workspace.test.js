/**
 * Espace de travail revendeur (post-pivot "instance complète").
 *
 * Couvre les régressions qui rendaient le rôle reseller inutilisable :
 *  - resolveServer : contexte LOCAL autorisé sans x-server-id (avant : 400) ;
 *    tenance conservée sur cible distante (serveur d'autrui → 403).
 *  - /api/system/health accessible à tout utilisateur authentifié.
 *  - /api/clients/containers en local pour un revendeur (avant : 400/403).
 *  - création de client par un revendeur (conteneur implicite = le sien).
 *  - GET /api/servers : version d'instance + updateAvailable + owner (admin).
 *  - POST /api/servers/:id/one-liner : régénération scopée par propriétaire.
 *  - PATCH /api/resellers/:id : enable/prix par l'admin ou l'ancêtre seulement.
 */
import { describe, it, expect, beforeAll } from 'vitest';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.WG_FUX_MASTER_KEY =
  process.env.WG_FUX_MASTER_KEY || crypto.randomBytes(32).toString('hex');
process.env.PLATFORM_BASE_URL = 'https://vpn-labs.test';
// Répertoire clients isolé : sur une machine de dev, /etc/wireguard/clients
// peut exister mais être illisible (EACCES) — hors sujet pour ces tests.
process.env.WG_CLIENTS_DIR = require('fs').mkdtempSync(
  require('path').join(require('os').tmpdir(), 'wg-clients-test-')
);

let app, db, schema, eq;
let admin, vendor, otherVendor; // { id, username, token }

const sign = (username) =>
  jwt.sign({ username }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

async function mkUser(username, role, parentId = null) {
  const [u] = await db
    .insert(schema.users)
    .values({ username, hash: 'x', salt: 'y', role, parentId, enabled: true })
    .returning({ id: schema.users.id });
  return { id: u.id, username, token: sign(username) };
}

async function mkServer(ownerId, overrides = {}) {
  const [s] = await db
    .insert(schema.servers)
    .values({
      ownerId,
      label: overrides.label || `ws-${crypto.randomBytes(3).toString('hex')}`,
      host: overrides.host || `ws-host-${crypto.randomBytes(3).toString('hex')}`,
      port: 22,
      status: overrides.status || 'online',
      licenseKey: crypto.randomBytes(16).toString('hex'),
      licenseExpiry: new Date(Date.now() + 30 * 86400_000),
      ...overrides,
    })
    .returning();
  return s;
}

const as = (user) => (req) => req.set('X-Api-Token', user.token);

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ db, schema } = require('../db'));
  ({ eq } = require('drizzle-orm'));
  ({ app } = require('../server'));

  admin = await mkUser('ws-admin', 'admin');
  vendor = await mkUser('ws-vendor', 'reseller');
  otherVendor = await mkUser('ws-other', 'reseller');
}, 30000);

describe('resolveServer — contexte local ouvert, tenance distante conservée', () => {
  it('revendeur SANS x-server-id → 200 en local (plus de 400)', async () => {
    const res = await as(vendor)(request(app).get('/api/clients/containers'));
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("revendeur ciblant le serveur d'autrui → 403 (pas de fuite)", async () => {
    const foreign = await mkServer(otherVendor.id);
    const res = await as(vendor)(
      request(app).get('/api/clients/containers').set('x-server-id', String(foreign.id))
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('/api/system/health — accessible à tout rôle authentifié', () => {
  it('revendeur → 200 avec un statut', async () => {
    const res = await as(vendor)(request(app).get('/api/system/health'));
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBeDefined();
  });

  it('sans token → 401', async () => {
    const res = await request(app).get('/api/system/health');
    expect(res.statusCode).toBe(401);
  });
});

describe('création de client par un revendeur (conteneur implicite)', () => {
  it('un revendeur peut créer un client dans SON nouveau conteneur', async () => {
    const res = await as(vendor)(
      request(app).post('/api/clients').send({ container: 'ws-vendor-box', name: 'c1' })
    );
    // Le gate 403 "Conteneur inexistant ou accès refusé" ne doit PLUS bloquer
    // un revendeur. Les mocks shell font réussir la création.
    expect(res.statusCode).not.toBe(403);
    expect([200, 201]).toContain(res.statusCode);

    const [ctr] = await db
      .select()
      .from(schema.containers)
      .where(eq(schema.containers.name, 'ws-vendor-box'))
      .limit(1);
    expect(ctr?.owner).toBe(vendor.username);
  });

  it("un revendeur ne crée PAS dans le conteneur d'autrui", async () => {
    await db
      .insert(schema.containers)
      .values({ name: 'ws-foreign-box', owner: otherVendor.username, interface: 'wg0' })
      .onConflictDoNothing();
    const res = await as(vendor)(
      request(app).post('/api/clients').send({ container: 'ws-foreign-box', name: 'c2' })
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/servers — télémétrie de flotte', () => {
  it("expose version, updateAvailable et owner pour l'admin", async () => {
    const srv = await mkServer(vendor.id, { scriptsVersion: '0.0.1' });
    const res = await as(admin)(request(app).get('/api/servers'));
    expect(res.statusCode).toBe(200);
    const row = res.body.find((s) => s.id === srv.id);
    expect(row.version).toBe('0.0.1');
    expect(row.updateAvailable).toBe(true); // 0.0.1 ≠ version plateforme
    expect(row.owner).toBe(vendor.username);
    expect(row.platformVersion).toBeTruthy();
  });

  it('un revendeur ne voit que SES serveurs, sans owner', async () => {
    const res = await as(vendor)(request(app).get('/api/servers'));
    expect(res.statusCode).toBe(200);
    expect(res.body.every((s) => s.owner === undefined)).toBe(true);
    const foreignVisible = res.body.some((s) => s.label?.startsWith('ws-') === false);
    expect(foreignVisible).toBe(false);
  });
});

describe('POST /api/servers/:id/one-liner — régénération scopée', () => {
  it('le propriétaire régénère le one-liner de SON serveur', async () => {
    const srv = await mkServer(vendor.id);
    const res = await as(vendor)(request(app).post(`/api/servers/${srv.id}/one-liner`));
    expect(res.statusCode).toBe(200);
    expect(res.body.oneLiner).toContain('/provision/');
    expect(res.body.scriptSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("le serveur d'autrui → 404 (pas de fuite d'existence)", async () => {
    const srv = await mkServer(otherVendor.id);
    const res = await as(vendor)(request(app).post(`/api/servers/${srv.id}/one-liner`));
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/resellers/:id — gestion du réseau', () => {
  it("l'admin désactive puis réactive un revendeur", async () => {
    const off = await as(admin)(
      request(app).patch(`/api/resellers/${vendor.id}`).send({ enabled: false })
    );
    expect(off.statusCode).toBe(200);
    // L'accès est coupé immédiatement (cache invalidé).
    const blocked = await as(vendor)(request(app).get('/api/clients/containers'));
    expect(blocked.statusCode).toBe(401);

    const on = await as(admin)(
      request(app).patch(`/api/resellers/${vendor.id}`).send({ enabled: true })
    );
    expect(on.statusCode).toBe(200);
  });

  it('un revendeur ne gère PAS un compte hors de son sous-arbre', async () => {
    const res = await as(vendor)(
      request(app).patch(`/api/resellers/${otherVendor.id}`).send({ enabled: false })
    );
    expect(res.statusCode).toBe(403);
  });

  it("un parent fixe le prix de revente d'un descendant", async () => {
    const child = await mkUser('ws-child', 'reseller', vendor.id);
    const res = await as(vendor)(
      request(app).patch(`/api/resellers/${child.id}`).send({ sellPriceCents: 250 })
    );
    expect(res.statusCode).toBe(200);
    const [row] = await db
      .select({ p: schema.users.sellPriceCents })
      .from(schema.users)
      .where(eq(schema.users.id, child.id))
      .limit(1);
    expect(row.p).toBe(250);
  });

  it('GET /api/resellers renvoie la vue agrégée (serveurs/clients/licence)', async () => {
    await mkServer(vendor.id, { clientCount: 7 });
    const res = await as(admin)(request(app).get('/api/resellers'));
    expect(res.statusCode).toBe(200);
    const row = res.body.find((u) => u.id === vendor.id);
    expect(row.serversCount).toBeGreaterThanOrEqual(1);
    expect(row.clientsTotal).toBeGreaterThanOrEqual(7);
    expect(row).toHaveProperty('nextLicenseExpiry');
  });
});
