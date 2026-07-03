// services/settings.js — Réglages plateforme (clé/valeur en base).
//
// Deux familles de valeurs :
//   - publiques : stockées en clair (ex. contact de paiement, chat Telegram).
//   - secrètes  : chiffrées AES-256-GCM (crypto.js) — clés Stripe, token bot.
// L'API ne renvoie JAMAIS un secret en clair : seulement un booléen "configuré".

const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');
const { encryptSecret, decryptSecret } = require('./crypto');
const log = require('./logger');

// Schéma des réglages connus : secret? + libellé. Toute clé hors de cette liste
// est refusée en écriture (anti-pollution / anti-injection de clés arbitraires).
const KNOWN = {
  // Notifications Telegram (bot d'alertes admin de la plateforme)
  telegram_bot_token: { secret: true },
  telegram_chat_id: { secret: false },
  // Contact de paiement affiché aux revendeurs quand Stripe n'est pas configuré
  payment_contact_whatsapp: { secret: false },
  payment_contact_telegram: { secret: false },
  payment_instructions: { secret: false },
  // Stripe (renouvellement automatique des licences)
  stripe_secret_key: { secret: true },
  stripe_webhook_secret: { secret: true },
  stripe_price_id: { secret: false },
  stripe_publishable_key: { secret: false },
};

function isSecret(key) {
  return Boolean(KNOWN[key] && KNOWN[key].secret);
}

// Lit une valeur (déchiffrée si secrète). Renvoie null si absente.
async function getSetting(key) {
  const [row] = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .limit(1);
  if (!row || row.value == null) return null;
  if (!row.secret) return row.value;
  try {
    return decryptSecret(JSON.parse(row.value));
  } catch (e) {
    log.error('settings', `Déchiffrement de ${key} échoué`, { err: e.message });
    return null;
  }
}

// Écrit une valeur (chiffrée si la clé est déclarée secrète). value='' ou null
// supprime le réglage.
async function setSetting(key, value) {
  if (!(key in KNOWN)) throw new Error(`Réglage inconnu : ${key}`);
  const secret = isSecret(key);

  if (value == null || value === '') {
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
    return;
  }

  const stored = secret ? JSON.stringify(encryptSecret(String(value))) : String(value);
  await db
    .insert(schema.appSettings)
    .values({ key, value: stored, secret, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: stored, secret, updatedAt: new Date() },
    });
}

// Vue publique de TOUS les réglages : les secrets deviennent { configured: bool },
// les valeurs publiques sont renvoyées telles quelles.
async function getPublicSettings() {
  const rows = await db.select().from(schema.appSettings);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const out = {};
  for (const [key, def] of Object.entries(KNOWN)) {
    const row = byKey[key];
    if (def.secret) {
      out[key] = { configured: Boolean(row && row.value) };
    } else {
      out[key] = row ? row.value : null;
    }
  }
  return out;
}

// Réglages exposables aux instances revendeurs (contact paiement + mode Stripe).
// Sert au heartbeat : l'instance affiche "comment payer" à son propriétaire.
async function getResellerFacing() {
  const [wa, tg, instr] = await Promise.all([
    getSetting('payment_contact_whatsapp'),
    getSetting('payment_contact_telegram'),
    getSetting('payment_instructions'),
  ]);
  const stripeConfigured = Boolean(await getSetting('stripe_secret_key'));
  return {
    stripeEnabled: stripeConfigured,
    contact: { whatsapp: wa || null, telegram: tg || null, instructions: instr || null },
  };
}

module.exports = {
  KNOWN,
  isSecret,
  getSetting,
  setSetting,
  getPublicSettings,
  getResellerFacing,
};
