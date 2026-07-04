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

let app, db, schema, eq, and;
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
  ({ eq, and } = require('drizzle-orm'));
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

describe('déploiement gouverné — push-update + heartbeat/bundle gatés', () => {
  const PLATFORM_VERSION = require('../package.json').version;

  it("sans approbation : le heartbeat n'offre AUCUNE version", async () => {
    const srv = await mkServer(admin.id, { scriptsVersion: '1.0.0' });
    const res = await request(app)
      .post('/license/heartbeat')
      .set('Authorization', `Bearer ${srv.licenseKey}`)
      .send({ version: '1.0.0', clients: 0 });
    expect(res.statusCode).toBe(200);
    expect(res.body.latestVersion).toBeNull();
  });

  it('push-update (admin) approuve la version plateforme → heartbeat + bundle 200', async () => {
    const srv = await mkServer(admin.id, { scriptsVersion: '1.0.0' });
    const push = await as(admin)(
      request(app)
        .post('/api/servers/push-update')
        .send({ serverIds: [srv.id] })
    );
    expect(push.statusCode).toBe(200);
    expect(push.body.version).toBe(PLATFORM_VERSION);

    const hb = await request(app)
      .post('/license/heartbeat')
      .set('Authorization', `Bearer ${srv.licenseKey}`)
      .send({ version: '1.0.0' });
    expect(hb.body.latestVersion).toBe(PLATFORM_VERSION);

    const list = await as(admin)(request(app).get('/api/servers'));
    expect(list.body.find((s) => s.id === srv.id).updateApproved).toBe(true);
  });

  it('sans approbation le bundle répond 204 (rien servi)', async () => {
    const srv = await mkServer(admin.id);
    const res = await request(app)
      .get('/license/bundle.tgz')
      .set('Authorization', `Bearer ${srv.licenseKey}`);
    expect(res.statusCode).toBe(204);
  });

  it('mode instant : persisté et renvoyé par update-check', async () => {
    const srv = await mkServer(admin.id, { scriptsVersion: '1.0.0' });
    const push = await as(admin)(
      request(app)
        .post('/api/servers/push-update')
        .send({ serverIds: [srv.id], mode: 'instant' })
    );
    expect(push.body.mode).toBe('instant');

    const check = await request(app)
      .get('/license/update-check')
      .set('Authorization', `Bearer ${srv.licenseKey}`);
    expect(check.body.offeredVersion).toBe(PLATFORM_VERSION);
    expect(check.body.mode).toBe('instant');

    const list = await as(admin)(request(app).get('/api/servers'));
    expect(list.body.find((s) => s.id === srv.id).updateMode).toBe('instant');
  });

  it('mode par défaut = auto', async () => {
    const srv = await mkServer(admin.id);
    await as(admin)(request(app).post('/api/servers/push-update').send({ serverIds: [srv.id] }));
    const check = await request(app)
      .get('/license/update-check')
      .set('Authorization', `Bearer ${srv.licenseKey}`);
    expect(check.body.mode).toBe('auto');
  });

  it('clear:true annule le déploiement', async () => {
    const srv = await mkServer(admin.id);
    await as(admin)(
      request(app)
        .post('/api/servers/push-update')
        .send({ serverIds: [srv.id] })
    );
    const cancel = await as(admin)(
      request(app)
        .post('/api/servers/push-update')
        .send({ serverIds: [srv.id], clear: true })
    );
    expect(cancel.statusCode).toBe(200);
    const hb = await request(app)
      .post('/license/heartbeat')
      .set('Authorization', `Bearer ${srv.licenseKey}`)
      .send({});
    expect(hb.body.latestVersion).toBeNull();
  });

  it('réservé à l’admin : un revendeur → 403', async () => {
    const srv = await mkServer(vendor.id);
    const res = await as(vendor)(
      request(app)
        .post('/api/servers/push-update')
        .send({ serverIds: [srv.id] })
    );
    expect(res.statusCode).toBe(403);
  });

  it("le canal 'hold' prime sur l'approbation", async () => {
    const srv = await mkServer(admin.id, { updateChannel: 'hold' });
    await as(admin)(
      request(app)
        .post('/api/servers/push-update')
        .send({ serverIds: [srv.id] })
    );
    const hb = await request(app)
      .post('/license/heartbeat')
      .set('Authorization', `Bearer ${srv.licenseKey}`)
      .send({});
    expect(hb.body.latestVersion).toBeNull();
  });
});

describe('POST /clients/:container/:name/renew — renouvellement payant', () => {
  const wallet = () => require('../src/services/wallet');
  const mkClient = async (container, name, owner, expiry = null) => {
    await db
      .insert(schema.containers)
      .values({ name: container, owner, interface: 'wg0' })
      .onConflictDoNothing();
    // Dossier disque présent (client réel, pas un fantôme).
    require('fs').mkdirSync(require('path').join(process.env.WG_CLIENTS_DIR, container, name), {
      recursive: true,
    });
    const [c] = await db
      .insert(schema.clients)
      .values({
        container,
        name,
        publicKey: 'renew-' + crypto.randomBytes(8).toString('hex'),
        enabled: true,
        expiry,
      })
      .returning();
    return c;
  };

  // ⚠️ Environnement de test : writeFileAsRoot passe par sudo + wg-file-proxy,
  // qui échoue hors root (les mocks de module ne s'appliquent pas aux require
  // CJS dans cette suite). On teste donc la LOGIQUE MÉTIER : calcul d'échéance
  // (helper pur), tarification/tenance, et l'invariant clé — un débit dont
  // l'écriture disque échoue est REMBOURSÉ.
  const { computeNewExpiry } = require('../src/routes/clients');

  it("computeNewExpiry : +30 j depuis aujourd'hui quand pas d'échéance", () => {
    const d = Math.round((new Date(computeNewExpiry(null, 30)) - Date.now()) / 86400_000);
    expect(d).toBeGreaterThanOrEqual(29);
    expect(d).toBeLessThanOrEqual(31);
  });

  it('computeNewExpiry : un renouvellement anticipé CUMULE, un tardif ne perd rien', () => {
    const in10 = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    const early = Math.round((new Date(computeNewExpiry(in10, 30)) - Date.now()) / 86400_000);
    expect(early).toBeGreaterThanOrEqual(39); // ~10 restants + 30

    const past = '2020-01-01';
    const late = Math.round((new Date(computeNewExpiry(past, 30)) - Date.now()) / 86400_000);
    expect(late).toBeGreaterThanOrEqual(29); // base = maintenant, pas 2020
  });

  it("échec d'écriture disque → le crédit débité est REMBOURSÉ (solde intact)", async () => {
    wallet().credit(vendor.id, 3, 'topup');
    const before = wallet().getBalance(vendor.id);
    await mkClient('sale-box', 'abo-1', vendor.username, null);

    // Dans cet environnement, l'écriture root échoue toujours → 503 attendu,
    // ET le portefeuille doit être re-crédité (débit + refund dans le ledger).
    const res = await as(vendor)(
      request(app).post('/api/clients/sale-box/abo-1/renew').send({ days: 30 })
    );
    expect(res.statusCode).toBe(503);
    expect(wallet().getBalance(vendor.id)).toBe(before);
    const { entries } = wallet().statement(vendor.id, 10);
    expect(entries.some((e) => e.reason === 'client_renewal' && e.delta === -1)).toBe(true);
    expect(entries.some((e) => e.reason === 'refund' && e.delta === 1)).toBe(true);
  });

  it('solde insuffisant → 402, expiry inchangée', async () => {
    const broke = await mkUser('ws-broke', 'reseller');
    await mkClient('broke-box', 'abo-3', broke.username, null);
    const res = await as(broke)(
      request(app).post('/api/clients/broke-box/abo-3/renew').send({ days: 90 })
    );
    expect(res.statusCode).toBe(402);
    const [c] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, 'broke-box'), eq(schema.clients.name, 'abo-3')))
      .limit(1);
    expect(c.expiry).toBeNull();
  });

  it("conteneur d'autrui → 403 pour un vendeur (aucun débit)", async () => {
    await mkClient('adm-box', 'abo-4', admin.username, null);
    const before = wallet().getBalance(vendor.id);
    const res = await as(vendor)(
      request(app).post('/api/clients/adm-box/abo-4/renew').send({ days: 30 })
    );
    expect(res.statusCode).toBe(403);
    expect(wallet().getBalance(vendor.id)).toBe(before);
  });
});

describe('GET /license/update-check — sonde légère du déploiement gouverné', () => {
  const PLATFORM_VERSION = require('../package.json').version;

  it('sans approbation → offeredVersion null + lastHeartbeat rafraîchi', async () => {
    const srv = await mkServer(admin.id, { lastHeartbeat: null });
    const res = await request(app)
      .get('/license/update-check')
      .set('Authorization', `Bearer ${srv.licenseKey}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.offeredVersion).toBeNull();
    const [after] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, srv.id))
      .limit(1);
    expect(after.lastHeartbeat).toBeTruthy();
    expect(after.status).toBe('online');
  });

  it('approuvé → offeredVersion = version plateforme ; clé inconnue → 401', async () => {
    const srv = await mkServer(admin.id, { targetVersion: PLATFORM_VERSION });
    const ok = await request(app)
      .get('/license/update-check')
      .set('Authorization', `Bearer ${srv.licenseKey}`);
    expect(ok.body.offeredVersion).toBe(PLATFORM_VERSION);

    const bad = await request(app)
      .get('/license/update-check')
      .set('Authorization', 'Bearer ' + 'z'.repeat(43));
    expect(bad.statusCode).toBe(401);
  });
});

describe('réconciliation DB ↔ disque ↔ WireGuard', () => {
  const fs = require('fs');
  const path = require('path');

  it('détecte les fantômes DB et les purge (admin), conteneur vide compris', async () => {
    // Fantôme : client en DB, aucun dossier sur le disque.
    await db
      .insert(schema.containers)
      .values({ name: 'ghost-box', owner: admin.username, interface: 'wg0' })
      .onConflictDoNothing();
    await db.insert(schema.clients).values({
      container: 'ghost-box',
      name: 'ghost-1',
      publicKey: 'ghostkey-' + crypto.randomBytes(8).toString('hex'),
      enabled: true,
    });

    const report = await as(admin)(request(app).get('/api/clients/reconcile'));
    expect(report.statusCode).toBe(200);
    expect(report.body.dbOrphans.some((o) => o.container === 'ghost-box')).toBe(true);

    const purge = await as(admin)(
      request(app).post('/api/clients/reconcile').send({ purgeDbOrphans: true })
    );
    expect(purge.statusCode).toBe(200);
    expect(purge.body.purged).toBeGreaterThanOrEqual(1);
    expect(purge.body.after.dbOrphans.some((o) => o.container === 'ghost-box')).toBe(false);

    const [ctr] = await db
      .select()
      .from(schema.containers)
      .where(eq(schema.containers.name, 'ghost-box'))
      .limit(1);
    expect(ctr).toBeUndefined(); // conteneur fantôme retiré aussi
  });

  it('un client avec fichiers sur le disque n’est PAS un fantôme', async () => {
    const dir = path.join(process.env.WG_CLIENTS_DIR, 'real-box', 'real-1');
    fs.mkdirSync(dir, { recursive: true });
    await db.insert(schema.clients).values({
      container: 'real-box',
      name: 'real-1',
      publicKey: 'realkey-' + crypto.randomBytes(8).toString('hex'),
      enabled: true,
    });
    const report = await as(admin)(request(app).get('/api/clients/reconcile'));
    expect(report.body.dbOrphans.some((o) => o.container === 'real-box')).toBe(false);
  });

  it('RBAC : purge réservée à l’admin (revendeur → 403)', async () => {
    const res = await as(vendor)(
      request(app).post('/api/clients/reconcile').send({ purgeDbOrphans: true })
    );
    expect(res.statusCode).toBe(403);
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
