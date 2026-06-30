// services/sshKeys.js — Helpers crypto pour le provisioning one-liner.
//
// Responsabilités :
//   - Génération de la paire de clés SSH ed25519 (la plateforme détient la privée,
//     la publique est installée — cantonnée — sur le VPS du revendeur).
//   - Génération / hachage / vérification constante-temps des tokens de provisioning.
//
// SÉCURITÉ : ce module ne logge JAMAIS de token ni de clé privée. Les appelants
// non plus.

const crypto = require('crypto');
const { utils: sshUtils } = require('ssh2');

/**
 * Génère une paire de clés SSH ed25519.
 * @returns {{ privateKey: string, publicKey: string }}
 *   privateKey : clé privée OpenSSH (`-----BEGIN OPENSSH PRIVATE KEY-----`).
 *   publicKey  : clé publique au format `ssh-ed25519 AAAA...`.
 */
function generateKeyPair() {
  // ssh2 renvoie { private, public } (PEM/OpenSSH privée + ligne authorized_keys).
  const { private: privateKey, public: publicKey } = sshUtils.generateKeyPairSync('ed25519');
  return {
    privateKey: String(privateKey),
    // On normalise : on ne garde que `ssh-ed25519 AAAA...` (sans commentaire éventuel).
    publicKey: String(publicKey).trim(),
  };
}

/**
 * Génère un token de provisioning (256 bits d'entropie), encodé base64url.
 * Le token EST le secret d'authentification du callback ; il n'est jamais stocké
 * en clair (seul son hash l'est, voir hashToken).
 * @returns {string}
 */
function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Hache un token (sha256 hex) pour stockage en base.
 * @param {string} token
 * @returns {string} hex
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Vérifie un token contre un hash stocké, en temps constant.
 * @param {string} token  token présenté
 * @param {string} hash   hash attendu (hex, issu de hashToken)
 * @returns {boolean}
 */
function verifyToken(token, hash) {
  if (!token || !hash) return false;
  const candidate = Buffer.from(hashToken(token), 'hex');
  let expected;
  try {
    expected = Buffer.from(String(hash), 'hex');
  } catch {
    return false;
  }
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

module.exports = {
  generateKeyPair,
  generateToken,
  hashToken,
  verifyToken,
};
