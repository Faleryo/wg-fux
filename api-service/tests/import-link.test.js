/**
 * Lien d'import sécurisé du .conf (feature demandée par l'utilisateur) :
 *
 *   POST /api/clients/:container/:name/import-link  (auth) → URL à jeton
 *   GET  /api/import/:token                         (public) → fichier .conf
 *
 * Garanties testées : jeton jamais stocké en clair (seul le SHA-256 l'est),
 * expiration, usage unique (le 2e GET reçoit 404), régénération = invalidation
 * de l'ancien lien, et 404 indistinct pour les jetons inconnus/malformés.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
const request = require('supertest');

// NB : la couche shell (readFileAsRoot, etc.) est déjà mockée globalement par
// tests/setup.js — le .conf « lu » est donc un contenu de mock, pas un vrai
// fichier. On teste ici le protocole du lien (jeton/expiration/usage unique),
// pas la lecture disque.

let app, db, schema, eq, and;

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ db, schema } = require('../db'));
  ({ eq, and } = require('drizzle-orm'));
  ({ app } = require('../server'));
  process.env.TEST_BYPASS_AUTH = 'true';

  await db
    .insert(schema.containers)
    .values({ name: 'imp_cont', owner: 'admin', interface: 'wg0' })
    .onConflictDoNothing();
  await db
    .insert(schema.clients)
    .values({
      container: 'imp_cont',
      name: 'imp_client',
      ip: '10.0.0.9',
      publicKey: 'imp_test_pubkey_AAAA=',
    })
    .onConflictDoNothing();
});

// Le bypass de test exige un header x-api-token PRÉSENT (peu importe sa valeur).
const createLink = () =>
  request(app)
    .post('/api/clients/imp_cont/imp_client/import-link')
    .set('x-api-token', 'test-bypass')
    .expect(200);

describe('POST /api/clients/:container/:name/import-link', () => {
  it('renvoie une URL /api/import/<jeton> et une expiration future', async () => {
    const res = await createLink();
    expect(res.body.url).toMatch(/\/api\/import\/[A-Za-z0-9_-]{40,64}$/);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("ne stocke JAMAIS le jeton en clair — seulement son SHA-256", async () => {
    const res = await createLink();
    const token = res.body.url.split('/').pop();
    const [row] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, 'imp_cont'), eq(schema.clients.name, 'imp_client')));
    expect(row.importTokenHash).toBeTruthy();
    expect(row.importTokenHash).not.toContain(token);
    const expectedHash = require('crypto').createHash('sha256').update(token).digest('hex');
    expect(row.importTokenHash).toBe(expectedHash);
  });

  it('404 pour un client inexistant', async () => {
    await request(app)
      .post('/api/clients/imp_cont/ghost_client/import-link')
      .set('x-api-token', 'test-bypass')
      .expect(404);
  });
});

describe('GET /api/import/:token', () => {
  it('sert le .conf en attachment puis invalide le lien (usage unique)', async () => {
    const { body } = await createLink();
    const token = body.url.split('/').pop();

    const dl = await request(app).get(`/api/import/${token}`).expect(200);
    expect(dl.headers['content-disposition']).toContain('imp_client.conf');
    // supertest bufferise l'octet-stream dans .body (pas .text) ; le contenu
    // vient du mock global de setup.js — on vérifie juste qu'il est servi.
    const bodyText = dl.text || Buffer.from(dl.body).toString('utf8');
    expect(bodyText.length).toBeGreaterThan(0);

    // Deuxième tentative : le jeton est consommé.
    await request(app).get(`/api/import/${token}`).expect(404);
  });

  it('404 pour un jeton inconnu ou malformé', async () => {
    await request(app).get(`/api/import/${'A'.repeat(43)}`).expect(404);
    await request(app).get('/api/import/short').expect(404);
    await request(app).get('/api/import/../../etc/passwd').expect(404);
  });

  it('404 pour un lien expiré, et le hash mort est nettoyé', async () => {
    const { body } = await createLink();
    const token = body.url.split('/').pop();
    await db
      .update(schema.clients)
      .set({ importTokenExpiry: new Date(Date.now() - 1000) })
      .where(and(eq(schema.clients.container, 'imp_cont'), eq(schema.clients.name, 'imp_client')));

    await request(app).get(`/api/import/${token}`).expect(404);
    const [row] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, 'imp_cont'), eq(schema.clients.name, 'imp_client')));
    expect(row.importTokenHash).toBeNull();
  });

  it("régénérer un lien invalide l'ancien", async () => {
    const first = await createLink();
    const oldToken = first.body.url.split('/').pop();
    await createLink(); // nouveau lien → nouveau hash
    await request(app).get(`/api/import/${oldToken}`).expect(404);
  });
});
