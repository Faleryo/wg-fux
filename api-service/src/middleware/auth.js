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

// In-memory JWT blacklist keyed by "username:iat". Entries expire after the
// longest possible token TTL (24h for viewers) so the Set stays bounded.
const tokenBlacklist = new Set();
const TOKEN_MAX_TTL_MS = 24 * 60 * 60 * 1000;
// Pairs stored as "username:iat:expireAt" — we embed expiry to allow cleanup
const blacklistExpiry = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, expireAt] of blacklistExpiry) {
    if (now > expireAt) {
      tokenBlacklist.delete(key);
      blacklistExpiry.delete(key);
    }
  }
}, 60 * 60 * 1000); // sweep every hour

const blacklistToken = (decoded) => {
  if (!decoded?.username || decoded.iat == null) return;
  const key = `${decoded.username}:${decoded.iat}`;
  tokenBlacklist.add(key);
  const expireAt = Date.now() + TOKEN_MAX_TTL_MS;
  blacklistExpiry.set(key, expireAt);
};

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

  if (sentinelToken && sentinelToken.length >= 32 && tokenStr) {
    const sentinelBuf = Buffer.from(sentinelToken);
    const tokenBuf = Buffer.from(tokenStr);
    if (
      sentinelBuf.length === tokenBuf.length &&
      crypto.timingSafeEqual(sentinelBuf, tokenBuf)
    ) {
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
    const decoded = jwt.verify(tokenStr, jwtSecret, { algorithms: ['HS256'] });

    if (!decoded.username || typeof decoded.username !== 'string') {
      return res.status(401).json({ error: 'Invalid token payload' });
    }

    const cached = userCache.get(decoded.username);
    if (cached && Date.now() - cached.ts < USER_CACHE_TTL) {
      if (cached.enabled === false) {
        userCache.delete(decoded.username);
        return res.status(401).json({ error: 'Account disabled' });
      }
      if (cached.expiry && new Date(cached.expiry) < new Date()) {
        userCache.delete(decoded.username);
        return res.status(401).json({ error: 'Account expired' });
      }
      if (tokenBlacklist.has(`${decoded.username}:${decoded.iat}`)) {
        return res.status(401).json({ error: 'Token revoked' });
      }
      req.user = { ...decoded, role: cached.role, id: cached.id, parentId: cached.parentId ?? null };
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
    if (user.enabled === false) {
      return res.status(401).json({ error: 'Account disabled' });
    }
    if (user.expiry && new Date(user.expiry) < new Date()) {
      return res.status(401).json({ error: 'Account expired' });
    }
    if (tokenBlacklist.has(`${decoded.username}:${decoded.iat}`)) {
      return res.status(401).json({ error: 'Token revoked' });
    }

    userCache.set(decoded.username, { id: user.id, role: user.role, parentId: user.parentId ?? null, expiry: user.expiry || null, enabled: user.enabled !== false, ts: Date.now() });
    req.user = { ...decoded, role: user.role, id: user.id, parentId: user.parentId ?? null };
    next();
  } catch (error) {
    if (
      error.name === 'JsonWebTokenError' ||
      error.name === 'TokenExpiredError' ||
      error.name === 'NotBeforeError'
    ) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    log.error('auth', 'Unexpected error during auth', { err: error.message });
    return res.status(500).json({ error: 'Internal server error' });
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

// Réseau de distribution : admin OU revendeur. Un revendeur niveau 1 a
// parentId == NULL (peut créer des sous-revendeurs) ; niveau 2 sinon.
const requireReseller = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'reseller')) return next();
  return res.status(403).json({ error: 'Forbidden' });
};

// Un revendeur enrôlé via lien d'invitation n'a de sens fonctionnel que pour
// enregistrer SON VPS : tant qu'il n'en a aucun, on refuse le reste de l'API
// (conteneurs, logs, réseau, portefeuille…) — pas seulement masqué côté UI,
// sinon un appel direct à l'API contournerait la restriction.
// N'affecte ni l'admin ni le manager (fondateurs de la plateforme).
// GET /system/license reste accessible : le shell du dashboard l'appelle au
// montage pour TOUT rôle (bandeau de licence de l'instance mère elle-même,
// rien à voir avec le VPS du revendeur) — le bloquer casserait l'UI avant même
// d'afficher l'onglet Serveurs.
const ONBOARDING_EXEMPT_PATHS = ['/license'];

const requireOnboardedReseller = async (req, res, next) => {
  if (!req.user || req.user.role !== 'reseller') return next();
  if (ONBOARDING_EXEMPT_PATHS.some((p) => req.path.startsWith(p))) return next();
  try {
    const [row] = await db
      .select({ id: schema.servers.id })
      .from(schema.servers)
      .where(eq(schema.servers.ownerId, req.user.id))
      .limit(1);
    if (row) return next();
  } catch (e) {
    log.error('auth', 'requireOnboardedReseller check failed', { err: e.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
  return res
    .status(403)
    .json({ error: 'Enregistrez votre VPS avant d’accéder à cette section', code: 'ONBOARDING_REQUIRED' });
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
  requireReseller,
  requireOnboardedReseller,
  invalidateUserCache,
  blacklistToken,
};
