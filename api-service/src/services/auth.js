const crypto = require('crypto');
const util = require('util');
const { db, schema } = require('../../db');
const log = require('./logger');

const pbkdf2Async = util.promisify(crypto.pbkdf2);

/**
 * Log a login attempt to the database
 */
const logLoginAttempt = async (username, clientIp, userAgent, success) => {
  try {
    await db.insert(schema.logs).values({
      timestamp: new Date(),
      type: 'auth',
      status: success ? 'success' : 'failure',
      name: username,
      realIp: clientIp,
      // FIX: ne plus stocker userAgent dans virtualIp (champ sémantiquement incorrect)
      // On stocke l'IP réelle dans realIp et l'agent dans container pour le log
      virtualIp: '',
      container: userAgent ? userAgent.substring(0, 100) : 'unknown'
    });
  } catch (e) {
    log.error('auth', 'Error logging login attempt', { err: e.message });
  }
};

/**
 * Verify a password against a hash and salt
 */
const verifyPassword = async (password, hash, salt) => {
  try {
    // SECURITY: We dont trim passwords as spaces might be intentional parts of the secret.
    // However, we trim the retrieved hash and salt from DB in case of migration whitespace issues.
    const trimmedHash = hash.trim();
    const trimmedSalt = salt.trim();

    const hashBuffer = await pbkdf2Async(password, trimmedSalt, 600000, 64, 'sha512');
    const generatedHash = hashBuffer.toString('hex');
    
    const bHash = Buffer.from(trimmedHash);
    const bGen = Buffer.from(generatedHash);
    
    if (bHash.length !== bGen.length) {
      return false; // Longueur différente -> échec immédiat (sécurisé car hash hex est de longueur fixe)
    }

    return crypto.timingSafeEqual(bHash, bGen);

  } catch (e) {
    log.error('auth', 'Password verification failed', { err: e.message });
    return false;
  }
};

/**
 * Hash a password with a new salt
 */
const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hashBuffer = await pbkdf2Async(password, salt, 600000, 64, 'sha512');
  return {
    hash: hashBuffer.toString('hex'),
    salt
  };
};

module.exports = {
  logLoginAttempt,
  verifyPassword,
  hashPassword
};
