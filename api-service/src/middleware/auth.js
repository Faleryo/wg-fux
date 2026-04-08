const jwt = require('jsonwebtoken');
const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');
const log = require('../services/logger');

// ─── JWT User Cache (évite un hit DB par requête) ────────────────────────────
const userCache = new Map(); // Map<username, { user, expiresAt }>
const CACHE_TTL_MS = 60_000;

const getCachedUser = async (username) => {
  const now = Date.now();
  const cached = userCache.get(username);
  if (cached && cached.expiresAt > now) {
    return cached.user;
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
  if (user) {
    userCache.set(username, { user, expiresAt: now + CACHE_TTL_MS });
  } else {
    userCache.delete(username);
  }
  return user || null;
};

const invalidateUserCache = (username) => {
  userCache.delete(username);
};

// ─── Auth Middleware ──────────────────────────────────────────────────────────
const auth = async (req, res, next) => {
  const token = req.headers['x-api-token'];
  if (!token) {
    return res.status(401).json({ error: 'Auth required' });
  }

  const clientIp = req.socket?.remoteAddress || '';
  const isInternalNetwork = (
    clientIp === '127.0.0.1' ||
    clientIp === '::1' ||
    clientIp === '::ffff:127.0.0.1'
  );

  // 💠 SRE Sentinel Bypass: prioritisation absolue
  const sentinelToken = (process.env.SENTINEL_TOKEN || '').trim();
  const cleanToken = token.trim();
  
  if (sentinelToken && cleanToken === sentinelToken) {
    if (isInternalNetwork) {
      req.user = { username: 'sentinel', role: 'admin' };
      return next();
    } else {
      log.warn('auth', 'SENTINEL_TOKEN used from external IP — rejected', { ip: clientIp, path: req.originalUrl });
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  try {
    const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
    const user = await getCachedUser(decoded.username);
    if (!user) {
      log.warn('auth', 'JWT token for unknown/deleted user', { username: decoded.username, path: req.originalUrl });
      return res.status(401).json({ error: 'Revoked' });
    }

    if (user.expiry && new Date(user.expiry) < new Date()) {
      invalidateUserCache(decoded.username);
      return res.status(403).json({ error: 'Account expired' });
    }

    req.user = decoded;
    next();
  } catch (e) {
    log.warn('auth', 'Invalid JWT token rejected', { path: req.originalUrl, err: e.message });
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).json({ error: 'Permission denied: Admin role required' });
};

const requireManager = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'manager')) return next();
  res.status(403).json({ error: 'Permission denied: Manager role required' });
};

module.exports = {
  auth,
  requireAdmin,
  requireManager,
  invalidateUserCache
};
