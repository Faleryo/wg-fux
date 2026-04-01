const jwt = require('jsonwebtoken');
const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');

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
    // White-list stricte : Installation status et Login uniquement
    const url = req.originalUrl.split('?')[0]; // ignorer query string
    if (url.endsWith('/api/install/status') || url.endsWith('/api/auth/login')) {
        return next();
    }

    const token = req.headers['x-api-token'];
    if (!token) {
        return res.status(401).json({ error: 'Auth required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Vérification via cache (évite hit DB systématique)
        const user = await getCachedUser(decoded.username);
        if (!user) {
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
