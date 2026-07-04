/**
 * Régression : better-sqlite3 REFUSE une fonction async dans db.transaction
 * ("Transaction function cannot return a promise"). Deux chemins de prod
 * l'utilisaient et échouaient silencieusement :
 *   - jobs.updateUsage (usage/quota jamais persistés)
 *   - clients bulk-update (rollback FS déclenché à tort)
 * Ce test verrouille le fait qu'une transaction SYNCHRONE avec nos opérations
 * (upsert usage, update clients) fonctionne, et qu'une async lève toujours.
 */
import { describe, it, expect, beforeAll } from 'vitest';
const crypto = require('crypto');

let db, schema, eq;

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ db, schema } = require('../db'));
  ({ eq } = require('drizzle-orm'));
}, 30000);

describe('db.transaction — synchrone uniquement (better-sqlite3)', () => {
  it('une fonction ASYNC lève "cannot return a promise"', () => {
    expect(() => db.transaction(async () => {})).toThrow(/cannot return a promise/i);
  });

  it('upsert usage en transaction SYNCHRONE persiste (pattern jobs.updateUsage)', async () => {
    const pk = 'tx-' + crypto.randomBytes(6).toString('hex');
    // usage.publicKey référence clients.publicKey (FK) — comme en prod, le peer
    // correspond toujours à un client existant.
    await db
      .insert(schema.clients)
      .values({ container: 'tx-box', name: 'tx-c', publicKey: pk, enabled: true });
    db.transaction((tx) => {
      const existing = tx
        .select()
        .from(schema.usage)
        .where(eq(schema.usage.publicKey, pk))
        .limit(1)
        .get();
      const total = (Number(existing?.total) || 0) + 500;
      tx
        .insert(schema.usage)
        .values({ publicKey: pk, total, daily: JSON.stringify({ '2026-07-04': 500 }) })
        .onConflictDoUpdate({
          target: schema.usage.publicKey,
          set: { total, daily: JSON.stringify({ '2026-07-04': 500 }) },
        })
        .run();
    });
    const row = db
      .select()
      .from(schema.usage)
      .where(eq(schema.usage.publicKey, pk))
      .limit(1)
      .get();
    expect(row.total).toBe(500);
  });
});
