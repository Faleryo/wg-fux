/**
 * Économie de licence réconciliée (crédits = moyen de paiement de la licence).
 *
 * Couvre :
 *  - renewLicensesByCredits : débit 1 crédit → +30 j ; solde insuffisant →
 *    licence non prolongée ; serveurs admin et instances mortes jamais débités ;
 *    idempotence (pas de double débit dans la fenêtre).
 *  - anti-abus d'essai : 1 seul essai 30 j par host (ré-enrôlement = 72 h).
 *  - Stripe : parseCreditsTarget (metadata type=credits).
 *  - inscription par invitation : usage unique, hiérarchie (admin → N1 top-level,
 *    N1 → N2), CGU exigées si terms_url configuré.
 *  - achat de crédits : un N2 est renvoyé vers son parent (marge préservée).
 */
import { describe, it, expect, beforeAll } from 'vitest';
const crypto = require('crypto');

process.env.WG_FUX_MASTER_KEY =
  process.env.WG_FUX_MASTER_KEY || crypto.randomBytes(32).toString('hex');
process.env.PLATFORM_BASE_URL = 'https://vpn-labs.test';
process.env.PLATFORM_PUBLIC_IP = '203.0.113.7';

let db, schema, eq, wallet, jobs;
let admin, n1, n2, broke, ghost;

const DAY = 24 * 3600 * 1000;

async function mkUser(username, role, parentId = null) {
  const [u] = await db
    .insert(schema.users)
    .values({ username, hash: 'x', salt: 'y', role, parentId, enabled: true })
    .returning({ id: schema.users.id });
  return u.id;
}

async function mkServer(ownerId, overrides = {}) {
  const [s] = await db
    .insert(schema.servers)
    .values({
      ownerId,
      label: overrides.label || `srv-${crypto.randomBytes(3).toString('hex')}`,
      host: overrides.host || `host-${crypto.randomBytes(3).toString('hex')}`,
      port: overrides.port ?? 22,
      status: 'online',
      licenseKey: crypto.randomBytes(16).toString('hex'),
      licenseExpiry: new Date(Date.now() + DAY), // expire dans 1 jour → exigible
      lastHeartbeat: new Date(),
      ...overrides,
    })
    .returning();
  return s;
}

async function getServer(id) {
  const [s] = await db.select().from(schema.servers).where(eq(schema.servers.id, id)).limit(1);
  return s;
}

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ db, schema } = require('../db'));
  ({ eq } = require('drizzle-orm'));
  wallet = require('../src/services/wallet');
  jobs = require('../src/services/jobs');

  admin = await mkUser('eco-admin', 'admin');
  n1 = await mkUser('eco-n1', 'reseller', null);
  n2 = await mkUser('eco-n2', 'reseller', n1);
  broke = await mkUser('eco-broke', 'reseller', null);
  ghost = await mkUser('eco-ghost', 'reseller', null);
});

describe('renewLicensesByCredits — le crédit paie la licence', () => {
  it('débite 1 crédit et prolonge de 30 j (idempotent dans la fenêtre)', async () => {
    wallet.credit(n1, 2, 'topup');
    const srv = await mkServer(n1);

    await jobs.renewLicensesByCredits();

    expect(wallet.getBalance(n1)).toBe(1);
    const after = await getServer(srv.id);
    const daysLeft = (new Date(after.licenseExpiry).getTime() - Date.now()) / DAY;
    expect(daysLeft).toBeGreaterThan(29); // 1 j restant + 30
    // Trace comptable : reason license_renewal, ref lic:<id>:<date>.
    const entry = wallet.statement(n1).entries.find((e) => e.reason === 'license_renewal');
    expect(entry).toBeTruthy();
    expect(entry.ref).toMatch(new RegExp(`^lic:${srv.id}:`));

    // 2e passage : l'échéance est sortie de la fenêtre → aucun re-débit.
    await jobs.renewLicensesByCredits();
    expect(wallet.getBalance(n1)).toBe(1);
  });

  it('solde insuffisant → licence NON prolongée (expire naturellement)', async () => {
    const srv = await mkServer(broke);
    await jobs.renewLicensesByCredits();
    expect(wallet.getBalance(broke)).toBe(0);
    const after = await getServer(srv.id);
    expect(new Date(after.licenseExpiry).getTime()).toBe(new Date(srv.licenseExpiry).getTime());
  });

  it("ne débite jamais l'admin (la plateforme ne se facture pas)", async () => {
    wallet.credit(admin, 5, 'topup');
    await mkServer(admin);
    await jobs.renewLicensesByCredits();
    expect(wallet.getBalance(admin)).toBe(5);
  });

  it('ne débite pas une instance morte (silence > 30 j)', async () => {
    wallet.credit(ghost, 5, 'topup');
    const srv = await mkServer(ghost, { lastHeartbeat: new Date(Date.now() - 40 * DAY) });
    await jobs.renewLicensesByCredits();
    expect(wallet.getBalance(ghost)).toBe(5);
    const after = await getServer(srv.id);
    expect(new Date(after.licenseExpiry).getTime()).toBe(new Date(srv.licenseExpiry).getTime());
  });
});

describe("anti-abus d'essai — 1 seul essai gratuit par host", () => {
  it('1er enrôlement = 30 j ; ré-enrôlement du même host = 72 h, trial:false', async () => {
    const { createServer } = require('../src/services/serverProvision');
    const host = `trial-${crypto.randomBytes(3).toString('hex')}`;

    const first = await createServer({ ownerId: n1, label: 'trial-1', host, port: 22 });
    expect(first.trial).toBe(true);
    const d1 = (new Date(first.licenseExpiry).getTime() - Date.now()) / DAY;
    expect(d1).toBeGreaterThan(29);

    // Même host (autre port pour éviter l'index unique) → plus d'essai gratuit.
    const second = await createServer({ ownerId: n1, label: 'trial-2', host, port: 2222 });
    expect(second.trial).toBe(false);
    const d2 = (new Date(second.licenseExpiry).getTime() - Date.now()) / DAY;
    expect(d2).toBeLessThan(4);
  });
});

describe('Stripe — achat de crédits (metadata type=credits)', () => {
  const { parseCreditsTarget } = require('../src/routes/stripe');

  it('lit userId + credits, rejette les objets invalides', () => {
    expect(
      parseCreditsTarget({ metadata: { type: 'credits', userId: '7', credits: '10' } })
    ).toEqual({ userId: 7, credits: 10 });
    expect(parseCreditsTarget({ metadata: { serverId: '7' } })).toBe(null); // legacy
    expect(parseCreditsTarget({ metadata: { type: 'credits', userId: '0', credits: '10' } })).toBe(
      null
    );
    expect(parseCreditsTarget({ metadata: { type: 'credits', userId: '7', credits: '-1' } })).toBe(
      null
    );
  });

  it(
    'webhook signé type=credits → crédite le wallet (pas la licence)',
    { timeout: 20000 },
    async () => {
      const settings = require('../src/services/settings');
      await settings.setSetting('stripe_webhook_secret', 'whsec_credits');
      const request = require('supertest');
      const { app } = require('../server');

      const event = {
        id: 'evt_' + crypto.randomBytes(8).toString('hex'),
        type: 'checkout.session.completed',
        data: {
          object: {
            amount_total: 1000, // 10 € pour 5 crédits → 200 c/unité
            metadata: { type: 'credits', userId: String(n2), credits: '5' },
          },
        },
      };
      const body = JSON.stringify(event);
      const t = Math.floor(Date.now() / 1000);
      const v1 = crypto.createHmac('sha256', 'whsec_credits').update(`${t}.${body}`).digest('hex');

      const before = wallet.getBalance(n2);
      const res = await request(app)
        .post('/stripe/webhook')
        .set('Stripe-Signature', `t=${t},v1=${v1}`)
        .set('Content-Type', 'application/json')
        .send(body);
      expect(res.statusCode).toBe(200);
      expect(wallet.getBalance(n2)).toBe(before + 5);
      const entry = wallet.statement(n2).entries.find((e) => e.reason === 'topup_stripe');
      expect(entry.priceCents).toBe(200);
    }
  );
});

describe('inscription par invitation', () => {
  const request = require('supertest');
  const { hashToken } = require('../src/services/sshKeys');

  async function mkInvite(inviterId, overrides = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    await db.insert(schema.invites).values({
      tokenHash: hashToken(token),
      inviterId,
      expiresAt: new Date(Date.now() + DAY),
      ...overrides,
    });
    return token;
  }

  it(
    'GET /api/auth/invite/:token → infos publiques ; token bidon → 404',
    { timeout: 20000 },
    async () => {
      const { app } = require('../server');
      const token = await mkInvite(admin);
      const ok = await request(app).get(`/api/auth/invite/${token}`);
      expect(ok.statusCode).toBe(200);
      expect(ok.body.inviter).toBe('eco-admin');
      const ko = await request(app).get('/api/auth/invite/tok-bidon-inexistant-123456');
      expect(ko.statusCode).toBe(404);
    }
  );

  it(
    'invité par ADMIN → N1 top-level (parentId NULL) ; token consommé (2e usage → 403)',
    { timeout: 20000 },
    async () => {
      const { app } = require('../server');
      const token = await mkInvite(admin);
      const res = await request(app)
        .post('/api/auth/register')
        .send({ token, username: 'invited-n1', password: 'motdepasse8' });
      expect(res.statusCode).toBe(201);
      const [u] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, 'invited-n1'))
        .limit(1);
      expect(u.role).toBe('reseller');
      expect(u.parentId).toBe(null);

      const again = await request(app)
        .post('/api/auth/register')
        .send({ token, username: 'invited-bis', password: 'motdepasse8' });
      expect(again.statusCode).toBe(403);
    }
  );

  it('invité par un N1 → sous-revendeur N2 (parentId = N1)', { timeout: 20000 }, async () => {
    const { app } = require('../server');
    const token = await mkInvite(n1);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ token, username: 'invited-n2', password: 'motdepasse8' });
    expect(res.statusCode).toBe(201);
    const [u] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, 'invited-n2'))
      .limit(1);
    expect(u.parentId).toBe(n1);
  });

  it('CGU configurées → acceptTerms obligatoire', { timeout: 20000 }, async () => {
    const settings = require('../src/services/settings');
    await settings.setSetting('terms_url', 'https://vpn-labs.test/cgu');
    const { app } = require('../server');
    const token = await mkInvite(admin);
    const no = await request(app)
      .post('/api/auth/register')
      .send({ token, username: 'terms-no', password: 'motdepasse8' });
    expect(no.statusCode).toBe(400);
    const yes = await request(app)
      .post('/api/auth/register')
      .send({ token, username: 'terms-yes', password: 'motdepasse8', acceptTerms: true });
    expect(yes.statusCode).toBe(201);
    await settings.setSetting('terms_url', ''); // nettoie pour les autres tests
  });
});

describe('achat de crédits — la marge du parent est incontournable', () => {
  const request = require('supertest');
  const jwt = require('jsonwebtoken');

  it(
    'un N2 reçoit 403 BUY_FROM_PARENT ; un N1 sans Stripe configuré reçoit 503',
    { timeout: 20000 },
    async () => {
      const { app } = require('../server');
      const tokenFor = (username) =>
        jwt.sign({ username, role: 'reseller' }, process.env.JWT_SECRET, { expiresIn: '1h' });

      const resN2 = await request(app)
        .post('/api/credits/checkout')
        .set('x-api-token', tokenFor('eco-n2'))
        .send({ credits: 10 });
      expect(resN2.statusCode).toBe(403);

      const resN1 = await request(app)
        .post('/api/credits/checkout')
        .set('x-api-token', tokenFor('eco-n1'))
        .send({ credits: 10 });
      expect(resN1.statusCode).toBe(503); // stripe_secret_key/credit_price_cents absents
    }
  );
});
