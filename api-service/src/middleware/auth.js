const jwt = require('jsonwebtoken');
const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');

const auth = async (req, res, next) => {
    // White-list: Installation status and Login
    if (req.originalUrl.endsWith('/install/status') || req.originalUrl.endsWith('/auth/login')) {
        return next();
    }

    const token = req.headers['x-api-token'];
    if (!token) {
        return res.status(401).json({ error: 'Auth required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Security logic: check if user exists
        const [user] = await db.select().from(schema.users).where(eq(schema.users.username, decoded.username)).limit(1);
        if (!user) {
            return res.status(401).json({ error: 'Revoked' });
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
    requireManager
};
