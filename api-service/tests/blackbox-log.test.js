/**
 * Blackbox Log — heure de connexion réelle des peers.
 *
 * BUG (signalé par l'utilisateur) : le dashboard affichait `entry.timestamp`
 * (l'heure du POLL logTrafficHistory, toutes les 60s) comme si c'était l'heure
 * de handshake WireGuard du peer. Fix : nouvelle colonne `logs.handshakeAt`
 * qui stocke le vrai epoch de `wg show dump`, distincte du poll.
 */
import { describe, it, expect, beforeAll } from 'vitest';
const request = require('supertest');

let app, db, schema, eq, and;

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ db, schema } = require('../db'));
  ({ eq, and } = require('drizzle-orm'));
  ({ app } = require('../server'));
  process.env.TEST_BYPASS_AUTH = 'true';
});

describe('logs.handshakeAt (colonne)', () => {
  it('stocke un handshake réel distinct du timestamp de poll', async () => {
    // Colonne integer/mode:'timestamp' = précision SECONDE (comme wg show dump,
    // qui ne donne jamais de sous-seconde) : on aligne les fixtures dessus.
    const pollTime = new Date(Math.floor(Date.now() / 1000) * 1000);
    // Simule un peer connecté depuis 5 minutes : le poll a lieu maintenant,
    // mais le vrai handshake WireGuard date de 5 minutes plus tôt.
    const realHandshake = new Date(pollTime.getTime() - 5 * 60_000);

    await db.insert(schema.logs).values({
      timestamp: pollTime,
      handshakeAt: realHandshake,
      type: 'snapshot',
      status: 'captured',
      name: 'bb_test_pubkey',
      realIp: '203.0.113.5:51820',
      usageDaily: 100,
      usageTotal: 200,
    });

    const [row] = await db
      .select()
      .from(schema.logs)
      .where(and(eq(schema.logs.type, 'snapshot'), eq(schema.logs.name, 'bb_test_pubkey')));

    expect(row.handshakeAt).toBeInstanceOf(Date);
    // Les deux timestamps ne doivent PAS coïncider — c'est précisément le bug :
    // avant le fix, seul `timestamp` (poll) existait et servait à tort d'heure
    // de connexion.
    expect(row.handshakeAt.getTime()).not.toBe(row.timestamp.getTime());
    expect(row.handshakeAt.getTime()).toBe(realHandshake.getTime());
  });

  it("l'API d'historique client expose handshakeAt", async () => {
    const [container] = await db
      .insert(schema.containers)
      .values({ name: 'bb-container', owner: 'admin', interface: 'wg0' })
      .onConflictDoNothing()
      .returning();
    await db
      .insert(schema.clients)
      .values({
        container: 'bb-container',
        name: 'bb-client',
        publicKey: 'bb_client_pubkey',
        enabled: true,
      })
      .onConflictDoNothing();

    const handshake = new Date(Math.floor((Date.now() - 120_000) / 1000) * 1000);
    await db.insert(schema.logs).values({
      timestamp: new Date(),
      handshakeAt: handshake,
      type: 'snapshot',
      status: 'captured',
      name: 'bb_client_pubkey',
      realIp: '203.0.113.9:51820',
    });

    const res = await request(app)
      .get('/api/clients/bb-container/bb-client/history')
      .set('X-Api-Token', 'irrelevant-because-of-test-bypass');

    expect(res.statusCode).toBe(200);
    const entry = res.body.find((e) => e.name === 'bb_client_pubkey');
    expect(entry).toBeDefined();
    expect(entry.handshakeAt).toBeDefined();
    expect(new Date(entry.handshakeAt).getTime()).toBe(handshake.getTime());
  });
});
