const crypto = require('crypto');
const util = require('util');
const { db, schema } = require('../../db');

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
        console.error('[AUTH-SERVICE] Error logging login attempt:', e);
    }
};

/**
 * Verify a password against a hash and salt
 */
const verifyPassword = async (password, hash, salt) => {
    try {
        const hashBuffer = await pbkdf2Async(password.trim(), salt.trim(), 600000, 64, 'sha512');
        const generatedHash = hashBuffer.toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hash.trim()), Buffer.from(generatedHash));
    } catch (e) {
        console.error('[AUTH-SERVICE] Password verification failed:', e);
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
