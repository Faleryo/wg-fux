// services/licenseSign.js — Grants de licence SIGNÉS (Ed25519).
//
// Objectif : rendre la décision de licence INFALSIFIABLE côté instance revendeur.
// Aujourd'hui l'instance fait aveuglément confiance au JSON renvoyé par la mère
// (et à son propre license-state.json, éditable par un revendeur root). Avec les
// grants signés :
//   - la MÈRE signe { keyId, serverId, valid, expiresAt, maxClients, issuedAt }
//     avec sa clé privée (LICENSE_SIGNING_PRIVKEY, jamais distribuée) ;
//   - l'INSTANCE vérifie la signature avec la clé publique de la mère
//     (LICENSE_SIGNING_PUBKEY, injectée au provisioning) AVANT de croire `valid`.
//
// Ce qu'un revendeur root NE PEUT PLUS faire :
//   - éditer license-state.json pour se déclarer valide (la signature ne colle plus) ;
//   - monter une fausse mère qui répond valid:true (il n'a pas la clé privée) ;
//   - rejouer le grant d'une AUTRE instance (grant lié à keyId = hash de SA clé).
// Ce qui reste possible (limite honnête) : patcher le bytecode qui appelle verify()
// — mais avec bytenode c'est une tout autre difficulté qu'éditer un JSON.
//
// Rétro-compatible : sans clé (privée côté mère / publique côté instance), on
// retombe sur le comportement historique — la flotte déjà déployée n'est pas cassée.

const crypto = require('crypto');

// Clés lues dynamiquement (permet rotation à chaud + testabilité). Format env :
// base64 du DER (PKCS8 pour la privée, SPKI pour la publique) — pas de PEM
// multi-ligne dans le .env.
const privKeyB64 = () => (process.env.LICENSE_SIGNING_PRIVKEY || '').trim();
const pubKeyB64 = () => (process.env.LICENSE_SIGNING_PUBKEY || '').trim();

// La mère SIGNE si elle a une clé privée. L'instance VÉRIFIE si elle a une pubkey.
const signingEnabled = () => Boolean(privKeyB64());
const verificationEnabled = () => Boolean(pubKeyB64());

let _priv = null;
let _pub = null;
function privateKeyObject() {
  if (_priv) return _priv;
  _priv = crypto.createPrivateKey({
    key: Buffer.from(privKeyB64(), 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  return _priv;
}
function publicKeyObject() {
  if (_pub) return _pub;
  _pub = crypto.createPublicKey({
    key: Buffer.from(pubKeyB64(), 'base64'),
    format: 'der',
    type: 'spki',
  });
  return _pub;
}

// Sérialisation canonique (clés triées) → mêmes octets signés et vérifiés des
// deux côtés, indépendamment de l'ordre d'insertion.
function canonical(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

// keyId = empreinte stable de la clé de licence (jamais la clé en clair). Lie le
// grant à UNE instance : le grant d'une autre instance (autre clé) ne colle pas.
function keyIdFor(licenseKey) {
  return crypto
    .createHash('sha256')
    .update(String(licenseKey || ''))
    .digest('hex');
}

/**
 * Signe un grant (côté MÈRE). Renvoie { grant, sig } où sig = base64.
 * @throws si signingEnabled() est faux.
 */
function signGrant(grant) {
  if (!signingEnabled()) throw new Error('LICENSE_SIGNING_PRIVKEY absent');
  const sig = crypto.sign(null, Buffer.from(canonical(grant), 'utf8'), privateKeyObject());
  return { grant, sig: sig.toString('base64') };
}

/**
 * Vérifie la signature d'un grant (côté INSTANCE). Ne juge QUE la cryptographie
 * (pas l'expiration ni le keyId — la logique métier reste dans license.js).
 * @returns {boolean}
 */
function verifyGrant(grant, sigB64) {
  if (!verificationEnabled()) return false;
  if (!grant || typeof grant !== 'object' || typeof sigB64 !== 'string') return false;
  try {
    return crypto.verify(
      null,
      Buffer.from(canonical(grant), 'utf8'),
      publicKeyObject(),
      Buffer.from(sigB64, 'base64')
    );
  } catch {
    return false;
  }
}

// Génère une paire Ed25519 (base64 DER). Utilisé par setup.sh (via node -e) et
// les tests. La privée reste sur la mère ; la publique va aux instances.
function generateKeyPairB64() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

// Réinitialise le cache des KeyObject (tests : après changement d'env).
function _resetCache() {
  _priv = null;
  _pub = null;
}

module.exports = {
  signingEnabled,
  verificationEnabled,
  signGrant,
  verifyGrant,
  keyIdFor,
  generateKeyPairB64,
  _resetCache,
};
