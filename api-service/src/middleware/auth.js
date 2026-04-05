const jwt = require('jsonwebtoken');
const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');
const log = require('../services/logger');

// ─── JWT User Cache (évite un hit DB par requête) ────────────────────────────
// TTL de 60s : acceptable pour la révocation (max 60s de délai après suppression d'un user)
const userCache = new Map(); // Map<username, { user, expiresAt }>
const CACHE_TTL_MS = 60_000;

const getCachedUser = async (username) => {
  const now = Date.now();
  const cached = userCache.get(username);
  if (cached && cached.expiresAt > now) {
    return cached.user;
  }
  // Cache miss ou expiré → hit DB
  const [user] = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
  if (user) {
    userCache.set(username, { user, expiresAt: now + CACHE_TTL_MS });
  } else {
    userCache.delete(username); // Utilisateur supprimé → purger le cache
  }
  return user || null;
};

// Purge de l'entrée cache lors d'une mise à jour/suppression
const invalidateUserCache = (username) => {
  userCache.delete(username);
};

// ─── Auth Middleware ──────────────────────────────────────────────────────────
const auth = async (req, res, next) => {
  // Note: Public routes like /auth/login are handled via selective middleware
  // application in server.js to maintain a clear security-by-default architecture.

  const token = req.headers['x-api-token'];
  if (!token) {
    return res.status(401).json({ error: 'Auth required' });
  }

  // 💠 SRE Sentinel Bypass: Allow trusted watchdog heartbeat
  // HARDENING: Restricted to internal network only (localhost + Docker vpn-internal 172.20.0.0/16)
  // Rejets les IPs publiques externes pour prévenir l'exploitation d'un token fuité.
  const sentinelToken = process.env.SENTINEL_TOKEN || 'vibe-sentinel-trust-99';
  const clientIp = req.ip || req.socket?.remoteAddress || '';
  const isInternalNetwork = (
    clientIp === '127.0.0.1' ||
    clientIp === '::1' ||
    clientIp === '::ffff:127.0.0.1' ||
    clientIp.startsWith('172.20.') ||
    clientIp.startsWith('::ffff:172.20.')
  );
  if (sentinelToken && token === sentinelToken && req.originalUrl === '/api/sentinel/heartbeat' && isInternalNetwork) {
    req.user = { username: 'sentinel', role: 'admin' };
    return next();
  }
  // Reject external sentinel token attempts with a warning (avoid leaking that sentinel exists)
  if (sentinelToken && token === sentinelToken && !isInternalNetwork) {
    log.warn('auth', 'SENTINEL_TOKEN used from external IP — rejected', { ip: clientIp, path: req.originalUrl });
    return res.status(401).json({ error: 'Invalid token' });
  }


  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Vérification via cache (évite hit DB systématique)
    const user = await getCachedUser(decoded.username);
    if (!user) {
      log.warn('auth', 'JWT token for unknown/deleted user', { username: decoded.username, path: req.originalUrl });
      return res.status(401).json({ error: 'Revoked' });
    }

    // Check expiry du compte
    if (user.expiry && new Date(user.expiry) < new Date()) {
      invalidateUserCache(decoded.username); // Forcer re-fetch au prochain check
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
