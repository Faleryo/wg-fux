/* eslint-disable no-empty, no-unused-vars */
/**
 * WG-FUX INTEGRATION TESTS — Auth & Users routes
 *
 * Runs against real in-memory SQLite (no mocks on DB).
 * Shell + system services are mocked in setup.js.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const request = require('supertest');

let app;
let db;
let schema;
let hashPassword;
let adminToken;
const TEST_USERNAME = 'test_operator';
const TEST_PASSWORD = 'secure-pass-123';

beforeAll(async () => {
  process.env.TEST_BYPASS_AUTH = 'false';
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ app } = require('../server'));
  ({ db, schema } = require('../db'));
  ({ hashPassword } = require('../src/services/auth'));

  // Seed a test admin and a test operator directly into the DB
  const { hash: adminHash, salt: adminSalt } = await hashPassword('admin-pass-456');
  await db.insert(schema.users).values({
    username: 'test_admin',
    hash: adminHash,
    salt: adminSalt,
    role: 'admin',
    enabled: true,
  }).onConflictDoNothing();

  const { hash, salt } = await hashPassword(TEST_PASSWORD);
  await db.insert(schema.users).values({
    username: TEST_USERNAME,
    hash,
    salt,
    role: 'viewer',
    enabled: true,
  }).onConflictDoNothing();

  // Obtain a real admin JWT for protected-route tests
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'test_admin', password: 'admin-pass-456' });
  adminToken = loginRes.body.token;
});

afterAll(() => {
  process.env.TEST_BYPASS_AUTH = 'true';
});

// ─── Auth routes ────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns JWT on valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.role).toBe('viewer');
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USERNAME, password: 'wrong-password' });
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('INVALID_AUTH');
  });

  it('returns 401 on unknown username', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody_exists', password: 'anything' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 on missing password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USERNAME });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when account is disabled', async () => {
    const { eq } = require('drizzle-orm');
    // Disable the test operator
    await db.update(schema.users).set({ enabled: false }).where(eq(schema.users.username, TEST_USERNAME));
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    // Re-enable before asserting
    await db.update(schema.users).set({ enabled: true }).where(eq(schema.users.username, TEST_USERNAME));
    // disabled user: password is valid but account is disabled — should fail
    expect([401, 403]).toContain(res.statusCode);
  });
});

describe('GET /api/auth/check', () => {
  it('returns valid: true with a fresh token', async () => {
    const res = await request(app)
      .get('/api/auth/check')
      .set('X-Api-Token', adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.username).toBe('test_admin');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/check');
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with garbage token', async () => {
    const res = await request(app)
      .get('/api/auth/check')
      .set('X-Api-Token', 'not.a.valid.jwt');
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns success and subsequent check with same token fails', async () => {
    // Get a fresh token for this test
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    const token = loginRes.body.token;
    expect(token).toBeTruthy();

    // Logout — blacklists the token
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('X-Api-Token', token);
    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    // Same token should now be rejected
    const checkRes = await request(app)
      .get('/api/auth/check')
      .set('X-Api-Token', token);
    expect(checkRes.statusCode).toBe(401);
  });
});

// ─── Users routes (admin-only) ───────────────────────────────────────────────

describe('GET /api/users', () => {
  it('returns user list for admin', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('X-Api-Token', adminToken);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Both test users should appear
    const names = res.body.map((u) => u.username);
    expect(names).toContain('test_admin');
    expect(names).toContain(TEST_USERNAME);
    // enabled field must be present
    expect(res.body[0]).toHaveProperty('enabled');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/users');
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/users', () => {
  const NEW_USER = 'new_operator_' + Date.now();

  it('creates a new user (201)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('X-Api-Token', adminToken)
      .send({ username: NEW_USER, password: 'my-strong-pass', role: 'viewer' });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 on duplicate username', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('X-Api-Token', adminToken)
      .send({ username: NEW_USER, password: 'another-pass', role: 'viewer' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on short password', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('X-Api-Token', adminToken)
      .send({ username: 'new_short', password: 'abc', role: 'viewer' });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /api/users/:username — enabled toggle', () => {
  it('suspends a user (enabled: false) and login fails', async () => {
    const { eq } = require('drizzle-orm');

    // Suspend via API
    const patchRes = await request(app)
      .patch(`/api/users/${TEST_USERNAME}`)
      .set('X-Api-Token', adminToken)
      .send({ enabled: false });
    expect(patchRes.statusCode).toBe(200);

    // Login should fail for suspended user
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    expect([401, 403]).toContain(loginRes.statusCode);

    // Re-enable
    await request(app)
      .patch(`/api/users/${TEST_USERNAME}`)
      .set('X-Api-Token', adminToken)
      .send({ enabled: true });
  });

  it('returns 404 on unknown username', async () => {
    const res = await request(app)
      .patch('/api/users/nobody_exists_xyz')
      .set('X-Api-Token', adminToken)
      .send({ role: 'viewer' });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/users/:username', () => {
  it('deletes an existing user', async () => {
    // Create a throwaway user
    const tmp = 'tmp_del_' + Date.now();
    await request(app)
      .post('/api/users')
      .set('X-Api-Token', adminToken)
      .send({ username: tmp, password: 'passw0rd-long', role: 'viewer' });

    const res = await request(app)
      .delete(`/api/users/${tmp}`)
      .set('X-Api-Token', adminToken);
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 when deleting self', async () => {
    const res = await request(app)
      .delete('/api/users/test_admin')
      .set('X-Api-Token', adminToken);
    expect(res.statusCode).toBe(400);
  });
});
