/**
 * Tâche #4 — Détection basique de falsification de licence (heartbeat).
 *
 * POST /license/heartbeat reçoit les phone-home des instances revendeurs. Un
 * heartbeat honnête est borné par la licence : l'instance applique elle-même son
 * plafond de clients et ne peut pas tourner une version que la mère n'a jamais
 * publiée. On vérifie qu'un écart grossier déclenche un log.warn NON-BLOQUANT
 * (jamais un rejet), et qu'un heartbeat normal n'en déclenche aucun.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
const crypto = require('crypto');

let db, schema, eq, app, request, log;
const PLATFORM_VERSION = require('../package.json').version;

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ db, schema } = require('../db'));
  ({ eq } = require('drizzle-orm'));
  log = require('../src/services/logger');
  request = require('supertest');
  ({ app } = require('../server'));
  // User propriétaire pour la FK servers.ownerId.
  await db
    .insert(schema.users)
    .values({ id: 7777, username: 'tamper-owner', hash: 'x', salt: 'y', role: 'viewer' })
    .onConflictDoNothing();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function seedLicensed({ key, maxClients }) {
  await db
    .insert(schema.servers)
    .values({
      ownerId: 7777,
      label: 'tamper-' + Math.random().toString(36).slice(2),
      host: 'tamper-host-' + Math.random().toString(36).slice(2),
      port: 22,
      status: 'online',
      licenseKey: key,
      licenseExpiry: new Date(Date.now() + 30 * 86400_000),
      maxClients,
    })
    .returning();
}

// Récupère les messages log.warn du service 'license' contenant 'suspect'.
function suspectWarnings(warnSpy) {
  return warnSpy.mock.calls.filter(
    (c) => c[0] === 'license' && typeof c[1] === 'string' && c[1].includes('suspect')
  );
}

describe('POST /license/heartbeat — détection de falsification', () => {
  it('clients rapportés >> maxClients → log.warn suspect (non-bloquant, 200)', async () => {
    const key = 'tamper-clients-' + crypto.randomBytes(16).toString('hex');
    await seedLicensed({ key, maxClients: 10 });
    const warnSpy = vi.spyOn(log, 'warn');

    const res = await request(app)
      .post('/license/heartbeat')
      .send({ key, version: '1.0.0', clients: 500 });

    // Non-bloquant : la requête réussit toujours.
    expect(res.statusCode).toBe(200);
    expect(res.body.valid).toBe(true);

    const warns = suspectWarnings(warnSpy);
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(warns.some((c) => c[1].includes('plafond'))).toBe(true);
    // Le contexte porte le détail utile pour l'audit.
    const meta = warns.find((c) => c[1].includes('plafond'))[2];
    expect(meta.reportedClients).toBe(500);
    expect(meta.maxClients).toBe(10);
  });

  it('version rapportée en avance sur la plateforme → log.warn suspect', async () => {
    const key = 'tamper-version-' + crypto.randomBytes(16).toString('hex');
    await seedLicensed({ key, maxClients: 100 });
    const warnSpy = vi.spyOn(log, 'warn');

    const res = await request(app)
      .post('/license/heartbeat')
      .send({ key, version: '999.0.0', clients: 3 });

    expect(res.statusCode).toBe(200);
    const warns = suspectWarnings(warnSpy);
    expect(warns.some((c) => c[1].includes('version'))).toBe(true);
  });

  it('heartbeat normal (clients ≤ plafond, version antérieure) → aucun warn suspect', async () => {
    const key = 'tamper-clean-' + crypto.randomBytes(16).toString('hex');
    await seedLicensed({ key, maxClients: 50 });
    const warnSpy = vi.spyOn(log, 'warn');

    const res = await request(app)
      .post('/license/heartbeat')
      .send({ key, version: '0.0.1', clients: 20 });

    expect(res.statusCode).toBe(200);
    expect(suspectWarnings(warnSpy).length).toBe(0);
  });

  it('licence sans plafond (maxClients null) → jamais de warn sur les clients', async () => {
    const key = 'tamper-nolimit-' + crypto.randomBytes(16).toString('hex');
    await seedLicensed({ key, maxClients: null });
    const warnSpy = vi.spyOn(log, 'warn');

    const res = await request(app)
      .post('/license/heartbeat')
      .send({ key, version: PLATFORM_VERSION, clients: 100000 });

    expect(res.statusCode).toBe(200);
    expect(suspectWarnings(warnSpy).some((c) => c[1].includes('plafond'))).toBe(false);
  });
});
