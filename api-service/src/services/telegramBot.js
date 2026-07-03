// services/telegramBot.js — Bot Telegram ADMIN de la plateforme.
//
// Version admin-only : SEUL le chat configuré (telegram_chat_id) est écouté.
// Commande principale : /nouveauvps <label> <host> [port] → crée un serveur et
// renvoie le one-liner à coller sur le VPS. Long-polling (getUpdates), aucune
// exposition publique. Token + chat_id lus dans app_settings (rechargés à chaud).
//
// Multi-revendeur (liaison de compte) = évolution future ; ici tout ce qui vient
// d'un autre chat que l'admin est ignoré.

const log = require('./logger');

let running = false;
let offset = 0;

const api = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendMessage(token, chatId, text) {
  try {
    await fetch(api(token, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    log.warn('telegram', 'sendMessage échoué', { err: e.message });
  }
}

const HELP =
  '<b>wg-fux — bot admin</b>\n\n' +
  '/nouveauvps <code>&lt;label&gt; &lt;host&gt; [port]</code> — créer un serveur et obtenir le one-liner\n' +
  '/aide — afficher cette aide';

// Résout l'id du propriétaire admin (les serveurs créés via le bot lui appartiennent).
async function resolveAdminOwnerId() {
  const { db, schema } = require('../../db');
  const { eq } = require('drizzle-orm');
  const [admin] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.role, 'admin'))
    .limit(1);
  return admin ? admin.id : null;
}

async function handleNewVps(token, chatId, args) {
  const [label, host, portRaw] = args;
  if (!label || !host) {
    return sendMessage(token, chatId, 'Usage : /nouveauvps <label> <host> [port]');
  }
  if (!/^[a-zA-Z0-9.:_-]+$/.test(host)) {
    return sendMessage(token, chatId, '❌ Host invalide (IPv4/IPv6/hostname).');
  }
  const port = portRaw ? parseInt(portRaw, 10) : 22;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return sendMessage(token, chatId, '❌ Port invalide.');
  }

  const ownerId = await resolveAdminOwnerId();
  if (!ownerId) {
    return sendMessage(token, chatId, '❌ Aucun compte admin trouvé sur la plateforme.');
  }

  const { createServer, ServerConflictError } = require('./serverProvision');
  try {
    const { oneLiner, expiresAt } = await createServer({
      ownerId,
      label: label.slice(0, 64),
      host,
      port,
      actor: 'telegram-admin',
    });
    const exp = new Date(expiresAt).toLocaleTimeString('fr-FR');
    await sendMessage(
      token,
      chatId,
      `✅ Serveur <b>${escapeHtml(label)}</b> (${escapeHtml(host)}) créé.\n` +
        `Collez ce one-liner en root sur le VPS (valable jusqu'à ${exp}) :\n\n` +
        `<pre>${escapeHtml(oneLiner)}</pre>`
    );
  } catch (e) {
    if (e instanceof ServerConflictError) {
      return sendMessage(token, chatId, `⚠️ ${escapeHtml(e.message)}`);
    }
    log.error('telegram', 'Création serveur via bot échouée', { err: e.message });
    await sendMessage(token, chatId, '❌ Erreur lors de la création du serveur.');
  }
}

async function processUpdate(token, adminChatId, update) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  // Admin-only : on ignore tout autre chat (et on ne répond pas, pas de fuite).
  if (String(msg.chat.id) !== String(adminChatId)) return;

  const text = msg.text.trim();
  const [cmd, ...args] = text.split(/\s+/);
  const base = cmd.split('@')[0].toLowerCase();

  switch (base) {
    case '/nouveauvps':
    case '/newvps':
      return handleNewVps(token, msg.chat.id, args);
    case '/start':
    case '/aide':
    case '/help':
      return sendMessage(token, msg.chat.id, HELP);
    default:
      return sendMessage(token, msg.chat.id, "Commande inconnue. /aide pour la liste.");
  }
}

async function pollOnce(token, adminChatId) {
  const res = await fetch(`${api(token, 'getUpdates')}?offset=${offset}&timeout=30`, {
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) throw new Error(`getUpdates HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok || !Array.isArray(data.result)) return;
  for (const update of data.result) {
    offset = Math.max(offset, update.update_id + 1);
    try {
      await processUpdate(token, adminChatId, update);
    } catch (e) {
      log.warn('telegram', 'processUpdate échoué', { err: e.message });
    }
  }
}

// Boucle superviseur : lit la config à chaque tour (pickup à chaud), long-poll
// si configurée, sinon dort 60s. Ne lève jamais (le bot ne doit pas tuer l'API).
async function loop() {
  const { getSetting } = require('./settings');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let token, chatId;
    try {
      token = await getSetting('telegram_bot_token');
      chatId = await getSetting('telegram_chat_id');
    } catch {
      /* db pas prête */
    }
    if (!token || !chatId) {
      await new Promise((r) => setTimeout(r, 60000));
      continue;
    }
    try {
      await pollOnce(token, chatId);
    } catch (e) {
      log.warn('telegram', 'poll échoué (retry dans 15s)', { err: e.message });
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
}

function startTelegramBot() {
  if (running) return;
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') return;
  running = true;
  log.info('telegram', 'Superviseur bot Telegram démarré');
  loop().catch((e) => log.error('telegram', 'Boucle bot arrêtée', { err: e.message }));
}

module.exports = { startTelegramBot, processUpdate, escapeHtml };
