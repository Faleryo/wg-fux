/**
 * Bot Telegram admin : gating admin-only + création de serveur via /nouveauvps.
 * On mocke l'API Telegram (fetch) pour capturer les réponses sortantes.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
const crypto = require('crypto');

process.env.WG_FUX_MASTER_KEY =
  process.env.WG_FUX_MASTER_KEY || crypto.randomBytes(32).toString('hex');
process.env.PLATFORM_BASE_URL = 'https://vpn-labs.test';

let db, schema, bot;

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ db, schema } = require('../db'));
  bot = require('../src/services/telegramBot');
  await db
    .insert(schema.users)
    .values({ id: 1, username: 'admin', hash: 'x', salt: 'y', role: 'admin' })
    .onConflictDoNothing();
});

// Capture les appels sortants sendMessage (POST .../sendMessage).
function mockTelegram() {
  const sent = [];
  vi.stubGlobal('fetch', async (url, opts) => {
    if (String(url).includes('/sendMessage')) {
      sent.push(JSON.parse(opts.body));
    }
    return { ok: true, json: async () => ({ ok: true, result: [] }) };
  });
  return sent;
}

const ADMIN_CHAT = '424242';
const mkUpdate = (chatId, text) => ({
  update_id: Math.floor(Math.random() * 1e9),
  message: { chat: { id: chatId }, text },
});

describe('telegramBot.processUpdate', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("ignore un message d'un chat non-admin (aucune réponse)", async () => {
    const sent = mockTelegram();
    await bot.processUpdate('tok', ADMIN_CHAT, mkUpdate('999999', '/aide'));
    expect(sent).toHaveLength(0);
  });

  it('/aide depuis le chat admin répond', async () => {
    const sent = mockTelegram();
    await bot.processUpdate('tok', ADMIN_CHAT, mkUpdate(ADMIN_CHAT, '/aide'));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('/nouveauvps');
  });

  it('/nouveauvps crée un serveur et renvoie un one-liner', async () => {
    const sent = mockTelegram();
    const host = 'tg-' + crypto.randomBytes(4).toString('hex') + '.example';
    await bot.processUpdate('tok', ADMIN_CHAT, mkUpdate(ADMIN_CHAT, `/nouveauvps MonVPS ${host}`));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('WG_T=');
    expect(sent[0].text).toContain('WG_H=');
    // Le serveur existe bien en base, en pending.
    const rows = await db.select().from(schema.servers);
    const created = rows.find((s) => s.host === host);
    expect(created).toBeTruthy();
    expect(created.status).toBe('pending');
    expect(created.licenseKey).toBeTruthy();
  });

  it('/nouveauvps avec host invalide est rejeté', async () => {
    const sent = mockTelegram();
    await bot.processUpdate('tok', ADMIN_CHAT, mkUpdate(ADMIN_CHAT, '/nouveauvps X bad host!!'));
    expect(sent[0].text).toContain('invalide');
  });
});
