/**
 * Périmètre du SENTINEL_TOKEN.
 *
 * Ce token statique servait de passe-partout ADMIN sur TOUTES les routes REST.
 * Une fuite donnait la main sur /api/users, /api/clients, /api/settings…
 * Il est désormais scopé à /api/sentinel/* — le seul endpoint REST que l'agent
 * (core-vpn/scripts/sentinel.sh) appelle réellement. Les flux WebSocket restent
 * gérés séparément dans services/ws.js.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const request = require('supertest');

let app;
const SENTINEL = crypto.randomBytes(24).toString('hex'); // ≥32 chars
let savedToken, savedBypass;

beforeAll(async () => {
  savedToken = process.env.SENTINEL_TOKEN;
  savedBypass = process.env.TEST_BYPASS_AUTH;
  // Le bypass de test court-circuiterait l'auth : on le désactive ici.
  delete process.env.TEST_BYPASS_AUTH;
  process.env.SENTINEL_TOKEN = SENTINEL;

  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ app } = require('../server'));
});

afterAll(() => {
  if (savedToken === undefined) delete process.env.SENTINEL_TOKEN;
  else process.env.SENTINEL_TOKEN = savedToken;
  if (savedBypass === undefined) delete process.env.TEST_BYPASS_AUTH;
  else process.env.TEST_BYPASS_AUTH = savedBypass;
});

describe('SENTINEL_TOKEN — périmètre restreint', () => {
  it('est ACCEPTÉ sur son endpoint (/api/sentinel/*)', async () => {
    const res = await request(app)
      .post('/api/sentinel/heartbeat')
      .set('x-api-token', SENTINEL)
      .send({ status: 'ok' });
    // Le point clé : PAS 401/403 → l'auth sentinel a bien fonctionné.
    expect([200, 201, 204, 400, 404, 500]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it('est REFUSÉ (403) sur une route admin hors périmètre — /api/users', async () => {
    const res = await request(app).get('/api/users').set('x-api-token', SENTINEL);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('SENTINEL_SCOPE');
  });

  it('est REFUSÉ (403) sur /api/clients (plus de passe-partout admin)', async () => {
    const res = await request(app).get('/api/clients').set('x-api-token', SENTINEL);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('SENTINEL_SCOPE');
  });

  it('est REFUSÉ (403) sur /api/settings', async () => {
    const res = await request(app).get('/api/settings').set('x-api-token', SENTINEL);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('SENTINEL_SCOPE');
  });

  it('un token bidon reste un 401 classique (pas de fuite de périmètre)', async () => {
    const res = await request(app).get('/api/users').set('x-api-token', 'pas-le-bon-token');
    expect(res.statusCode).toBe(401);
  });
});
