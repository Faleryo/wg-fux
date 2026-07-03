/**
 * Réglages plateforme (settings) + webhook Stripe.
 *  - secrets chiffrés, jamais renvoyés en clair
 *  - clés inconnues refusées
 *  - vérification de signature Stripe (anti-forge / anti-rejeu)
 *  - un paiement valide prolonge licenseExpiry
 */
import { describe, it, expect, beforeAll } from 'vitest';
const crypto = require('crypto');

process.env.WG_FUX_MASTER_KEY =
  process.env.WG_FUX_MASTER_KEY || crypto.randomBytes(32).toString('hex');

let db, schema, eq, settings, stripeRoute;

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ db, schema } = require('../db'));
  ({ eq } = require('drizzle-orm'));
  settings = require('../src/services/settings');
  stripeRoute = require('../src/routes/stripe');
  // Propriétaire pour la FK servers.ownerId.
  await db
    .insert(schema.users)
    .values({ id: 4242, username: 'reseller-billing', hash: 'x', salt: 'y', role: 'viewer' })
    .onConflictDoNothing();
});

describe('services/settings', () => {
  it('stocke un secret chiffré et ne le renvoie jamais en clair', async () => {
    await settings.setSetting('stripe_secret_key', 'sk_test_SUPERSECRET');
    // Valeur brute en base = JSON chiffré, pas le secret.
    const [row] = await db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, 'stripe_secret_key'))
      .limit(1);
    expect(row.value).not.toContain('SUPERSECRET');
    expect(row.secret).toBe(true);
    // getSetting déchiffre.
    expect(await settings.getSetting('stripe_secret_key')).toBe('sk_test_SUPERSECRET');
    // La vue publique masque.
    const pub = await settings.getPublicSettings();
    expect(pub.stripe_secret_key).toEqual({ configured: true });
  });

  it('stocke une valeur publique en clair et refuse les clés inconnues', async () => {
    await settings.setSetting('payment_contact_whatsapp', '+33612345678');
    expect(await settings.getSetting('payment_contact_whatsapp')).toBe('+33612345678');
    await expect(settings.setSetting('cle_inconnue', 'x')).rejects.toThrow(/inconnu/i);
  });

  it("getResellerFacing reflète l'état Stripe + le contact", async () => {
    const rf = await settings.getResellerFacing();
    expect(rf.stripeEnabled).toBe(true); // stripe_secret_key posé plus haut
    expect(rf.contact.whatsapp).toBe('+33612345678');
  });
});

describe('routes/stripe — signature & renouvellement', () => {
  function sign(rawBody, secret, t = Math.floor(Date.now() / 1000)) {
    const payload = `${t}.${rawBody}`;
    const v1 = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `t=${t},v1=${v1}`;
  }

  it('accepte une signature valide, rejette une forgée et un horodatage périmé', () => {
    const secret = 'whsec_test';
    const body = JSON.stringify({ hello: 'world' });
    const raw = Buffer.from(body);
    expect(stripeRoute.verifyStripeSignature(raw, sign(body, secret), secret)).toBe(true);
    expect(stripeRoute.verifyStripeSignature(raw, sign(body, 'mauvais'), secret)).toBe(false);
    // Horodatage vieux de 10 min → rejeté (anti-rejeu).
    const old = Math.floor(Date.now() / 1000) - 600;
    expect(stripeRoute.verifyStripeSignature(raw, sign(body, secret, old), secret)).toBe(false);
  });

  it('parseTarget lit serverId + days (défaut 30, borné)', () => {
    expect(stripeRoute.parseTarget({ metadata: { serverId: '7', days: '90' } })).toEqual({
      serverId: 7,
      days: 90,
    });
    expect(stripeRoute.parseTarget({ client_reference_id: '4' })).toEqual({
      serverId: 4,
      days: 30,
    });
    expect(stripeRoute.parseTarget({ metadata: { serverId: '9', days: '99999' } })).toEqual({
      serverId: 9,
      days: 30, // hors bornes → défaut
    });
  });

  it('webhook signé → prolonge la licence du serveur ciblé', async () => {
    await settings.setSetting('stripe_webhook_secret', 'whsec_e2e');
    const [srv] = await db
      .insert(schema.servers)
      .values({
        ownerId: 4242,
        label: 'stripe-e2e',
        host: 'stripe-e2e-host',
        port: 22,
        status: 'online',
        licenseExpiry: new Date(Date.now() + 2 * 86400_000), // 2 jours restants
      })
      .returning();

    const request = require('supertest');
    const { app } = require('../server');
    const event = {
      type: 'checkout.session.completed',
      data: { object: { metadata: { serverId: String(srv.id), days: '30' } } },
    };
    const body = JSON.stringify(event);
    const res = await request(app)
      .post('/stripe/webhook')
      .set('Stripe-Signature', sign(body, 'whsec_e2e'))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.statusCode).toBe(200);
    expect(res.body.received).toBe(true);

    const [after] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, srv.id))
      .limit(1);
    // 2 jours restants + 30 → ~32 jours dans le futur.
    const daysLeft = (new Date(after.licenseExpiry).getTime() - Date.now()) / 86400_000;
    expect(daysLeft).toBeGreaterThan(31);
  });

  it('webhook avec signature invalide → 400, licence inchangée', async () => {
    const request = require('supertest');
    const { app } = require('../server');
    const body = JSON.stringify({ type: 'invoice.paid', data: { object: {} } });
    const res = await request(app)
      .post('/stripe/webhook')
      .set('Stripe-Signature', 't=1,v1=deadbeef')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.statusCode).toBe(400);
  });
});
