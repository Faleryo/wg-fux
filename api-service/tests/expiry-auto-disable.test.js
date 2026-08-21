/**
 * disableExpiredClients (services/jobs.js).
 *
 * wg-enforcer.sh (cron côté hôte) retire déjà le peer du noyau à l'échéance
 * en lisant le fichier `expiry` sur disque, mais n'a pas accès à la DB :
 * sans ce job, `clients.enabled` restait bloqué à `true` indéfiniment après
 * expiration — désync permanente signalée par le bandeau de réconciliation
 * ("OK files but missing from tunnel") pour une expiration pourtant normale.
 *
 * Couvre :
 *  - un client expiré (enabled=true) est désactivé (enabled=false).
 *  - un client non expiré n'est jamais touché.
 *  - un client déjà désactivé n'est jamais re-traité (idempotent).
 *  - un client sans date d'expiration n'est jamais touché.
 */
import { describe, it, expect, beforeAll } from 'vitest';
const crypto = require('crypto');

process.env.WG_FUX_MASTER_KEY =
  process.env.WG_FUX_MASTER_KEY || crypto.randomBytes(32).toString('hex');

let db, schema, eq, jobs;

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ db, schema } = require('../db'));
  ({ eq } = require('drizzle-orm'));
  jobs = require('../src/services/jobs');
});

function pastDate(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
}
function futureDate(daysAhead) {
  return new Date(Date.now() + daysAhead * 86400000).toISOString().split('T')[0];
}

async function mkClient(overrides = {}) {
  const name = 'exp-' + crypto.randomBytes(4).toString('hex');
  const [c] = await db
    .insert(schema.clients)
    .values({
      container: 'exp-test',
      name,
      publicKey: crypto.randomBytes(16).toString('base64'),
      enabled: true,
      ...overrides,
    })
    .returning();
  return c;
}

describe('disableExpiredClients', () => {
  it('désactive un client dont la date est passée', async () => {
    const c = await mkClient({ expiry: pastDate(3) });
    await jobs.disableExpiredClients();

    const [after] = await db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, c.id))
      .limit(1);
    expect(after.enabled).toBe(false);
  });

  it("ne touche pas un client dont l'expiry est future", async () => {
    const c = await mkClient({ expiry: futureDate(5) });
    await jobs.disableExpiredClients();

    const [after] = await db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, c.id))
      .limit(1);
    expect(after.enabled).toBe(true);
  });

  it('ne re-traite pas un client déjà désactivé', async () => {
    const c = await mkClient({ expiry: pastDate(10), enabled: false });
    await jobs.disableExpiredClients();

    const [after] = await db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, c.id))
      .limit(1);
    expect(after.enabled).toBe(false); // inchangé, pas de crash
  });

  it("ne touche pas un client sans date d'expiration", async () => {
    const c = await mkClient({ expiry: null });
    await jobs.disableExpiredClients();

    const [after] = await db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, c.id))
      .limit(1);
    expect(after.enabled).toBe(true);
  });
});
