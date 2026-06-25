const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const log = require('../services/logger');
const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');

const userCache = new Map();
const USER_CACHE_TTL = 60 * 1000; // 1 minute TTL (reduced from 5min for faster privilege revocation)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of userCache) {
    if (now - val.ts > USER_CACHE_TTL) userCache.delete(key);
  }
}, 30000);

const auth = async (req, res, next) => {
  const token = req.headers['x-api-token'];
  if (!token) return res.status(401).json({ error: 'Auth required' });

  // Test bypass — ONLY for automated test suites, never production
  if (
    process.env.NODE_ENV === 'test' &&
    process.env.VITEST === 'true' &&
    process.env.TEST_BYPASS_AUTH === 'true'
  ) {
    log.warn('auth', 'TEST BYPASS AUTH used — insecure, do not use in production');
    req.user = { id: 1, role: 'admin', username: 'admin' };
    return next();
  }

  const sentinelToken = process.env.SENTINEL_TOKEN || '';
  const tokenStr = typeof token === 'string' ? token : '';

  if (sentinelToken && tokenStr) {
    const sentinelBuf = Buffer.from(sentinelToken);
    const tokenBuf = Buffer.from(tokenStr);
    // Always call timingSafeEqual with same-length buffers to prevent timing side-channel
    const maxLen = Math.max(sentinelBuf.length, tokenBuf.length);
    const paddedSentinel = Buffer.alloc(maxLen, sentinelBuf);
    const paddedToken = Buffer.alloc(maxLen, tokenBuf);
    if (crypto.timingSafeEqual(paddedSentinel, paddedToken)) {
      log.info('auth', 'Sentinel auth', { username: 'sentinel-watchdog', ip: req.ip });
      req.user = { id: 0, role: 'admin', username: 'sentinel-watchdog', internal: true };
      return next();
    }
  }

  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      log.error('auth', 'JWT_SECRET NOT SET. Authentication unavailable.');
      return res.status(500).json({ error: 'Server authentication misconfigured' });
    }
    const decoded = jwt.verify(tokenStr, jwtSecret);

    const cached = userCache.get(decoded.username);
    if (cached && Date.now() - cached.ts < USER_CACHE_TTL) {
      req.user = { ...decoded, role: cached.role };
      return next();
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, decoded.username))
      .limit(1);
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    userCache.set(decoded.username, { role: user.role, ts: Date.now() });
    req.user = { ...decoded, role: user.role };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Forbidden' });
};

const requireManager = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'manager')) return next();
  return res.status(403).json({ error: 'Forbidden' });
};

const requireViewer = (req, res, next) => {
  if (req.user) return next();
  return res.status(403).json({ error: 'Forbidden' });
};

const invalidateUserCache = (username) => {
  if (username) {
    userCache.delete(username);
  } else {
    userCache.clear();
  }
};

module.exports = {
  auth,
  requireAdmin,
  requireManager,
  requireViewer,
  invalidateUserCache,
};
