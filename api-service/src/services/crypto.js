// services/crypto.js — Chiffrement AES-256-GCM des creds serveur (clés privées SSH).
//
// La clé maître vient de l'env WG_FUX_MASTER_KEY (hex 64 chars = 32 bytes).
// Elle ne vit JAMAIS en base. Le clair ne vit qu'en mémoire processus,
// déchiffré juste-à-temps par l'exécuteur SSH.
//
// Forme stockée en base (table servers) : { encPrivateKey, encKeyIv, encKeyAuth }
// tous en base64.

const crypto = require('crypto');

let _masterKey = null;

function getMasterKey() {
  if (_masterKey) return _masterKey;
  const hex = process.env.WG_FUX_MASTER_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'WG_FUX_MASTER_KEY manquant ou invalide (attendu : 64 caractères hex = 32 bytes). ' +
        'Générer avec: openssl rand -hex 32'
    );
  }
  _masterKey = Buffer.from(hex, 'hex');
  return _masterKey;
}

/**
 * Chiffre une chaîne (ex: clé privée PEM) → { encPrivateKey, encKeyIv, encKeyAuth }.
 */
function encryptSecret(plaintext) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encPrivateKey: enc.toString('base64'),
    encKeyIv: iv.toString('base64'),
    encKeyAuth: tag.toString('base64'),
  };
}

/**
 * Déchiffre depuis une ligne `servers` (ou tout objet { encPrivateKey, encKeyIv, encKeyAuth }).
 * Lève si le tag GCM ne valide pas (intégrité compromise).
 */
function decryptSecret({ encPrivateKey, encKeyIv, encKeyAuth }) {
  if (!encPrivateKey || !encKeyIv || !encKeyAuth) {
    throw new Error('Creds chiffrés incomplets (encPrivateKey/encKeyIv/encKeyAuth requis).');
  }
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encKeyIv, 'base64'));
  decipher.setAuthTag(Buffer.from(encKeyAuth, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encPrivateKey, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// Alias rétro-compatibles avec la nomenclature de la spec socle.
const encryptPrivateKey = encryptSecret;
const decryptPrivateKey = decryptSecret;

module.exports = {
  encryptSecret,
  decryptSecret,
  encryptPrivateKey,
  decryptPrivateKey,
  getMasterKey,
};
