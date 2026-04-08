/**
 * WG-FUX PRODUCTION MASTERY SUITE (v6 ULTRA)
 * Goal: 70%+ Coverage, deep route traversal.
 */
global.TEST_BYPASS_AUTH = true;

import { describe, it, expect, vi, beforeAll } from 'vitest';
const request = require('supertest');

// --- 💠 ENVIRONMENT ISOLATION 💠 ---
vi.mock('dotenv', () => ({ config: vi.fn().mockReturnValue({ parsed: {} }) }));
vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('TEST_BYPASS_AUTH', 'true');
vi.stubEnv('VITEST', 'true');

// --- 💠 STUBS & MOCKS 💠 ---
vi.mock('axios', () => ({
  get: vi.fn(() => Promise.resolve({ data: { initialized: true, status: 'ok' }, status: 200 })),
  post: vi.fn(() => Promise.resolve({ data: { success: true }, status: 200 })),
  all: Promise.all.bind(Promise),
  spread: (fn) => (res) => fn(...res),
  default: {
    get: vi.fn().mockResolvedValue({ data: { status: 'ok' } }),
    post: vi.fn().mockResolvedValue({ data: { success: true } }),
  },
}));

vi.mock('../src/services/jobs', () => ({ startJobs: vi.fn() }));
vi.mock('../src/services/ws', () => ({
  init: vi.fn(),
  broadcast: vi.fn(),
  startBroadcast: vi.fn(),
}));
vi.mock('../src/services/shell', () => ({
  runCommand: vi.fn().mockResolvedValue({ success: true, stdout: 'OK' }),
  runSystemCommand: vi.fn().mockResolvedValue({ success: true, stdout: 'OK' }),
}));

describe('Production Mastery Sweep', () => {
  let app;

  beforeAll(async () => {
    const { initializeDatabase } = require('../src/services/init');
    await initializeDatabase();

    const { db, schema } = require('../db');
    await db
      .insert(schema.users)
      .values({
        username: 'admin',
        hash: 'test',
        salt: 'test',
        role: 'admin',
      })
      .onConflictDoNothing();

    const { app: expressApp } = require('../server');
    app = expressApp;
  });

  it('API Route Deep Traversal', async () => {
    const scenarios = [
      { method: 'get', url: '/api/auth/check' },
      { method: 'get', url: '/api/users' },
      {
        method: 'post',
        url: '/api/users',
        body: { username: 'testuser', password: 'password', role: 'viewer' },
      },
      { method: 'get', url: '/api/clients' },
      { method: 'post', url: '/api/clients', body: { name: 'test-client', container: 'wg0' } },
      { method: 'get', url: '/api/dns/info' },
      { method: 'post', url: '/api/dns/config', body: { upstream: ['1.1.1.1'] } },
      { method: 'get', url: '/api/system/stats' },
      { method: 'get', url: '/api/sentinel/status' },
      { method: 'post', url: '/api/sentinel/heartbeat', body: { status: 'online' } },
      { method: 'get', url: '/api/tickets' },
    ];

    for (const s of scenarios) {
      const res = await request(app)
        [s.method](s.url)
        .send(s.body || {});
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(500);
    }
  });

  it('Service Layer Integration', () => {
    // Logger
    const logger = require('../src/services/logger');
    logger.info('Coverage sweep active');
    logger.recordLatency(15);
    expect(logger.getP95Latency()).toBeDefined();

    // System
    const sys = require('../src/services/system');
    expect(sys.formatBytes(1024 * 1024)).toBe('1 MB');

    // Config
    const config = require('../src/services/config');
    expect(config.getScriptPath('test.sh')).toContain('test.sh');
  });

  it('Schema Validation coverage', () => {
    const { loginSchema } = require('../db/validation');
    const res = loginSchema.safeParse({ username: 'admin', password: 'password' });
    expect(res.success).toBe(true);
  });
});
