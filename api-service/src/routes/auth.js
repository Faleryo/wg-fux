const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { rateLimit } = require('express-rate-limit');
const { db, schema } = require('../../db');
const { eq, desc, and } = require('drizzle-orm');
const { loginSchema } = require('../../db/validation');
const { auth, requireAdmin, requireManager } = require('../middleware/auth');
const { verifyPassword, logLoginAttempt } = require('../services/auth');
const { runSystemCommand } = require('../services/shell');
const { getScriptPath } = require('../services/config');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Trop de tentatives. Veuillez réessayer dans 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        const ip = req.ip;
        runSystemCommand(getScriptPath('wg-send-msg.sh'), [`⚠️ ALERTE SÉCURITÉ: 5 tentatives de connexion échouées depuis l'IP ${ip}`]);
        res.status(options.statusCode).send(options.message);
    }
});

router.post('/login', loginLimiter, async (req, res, next) => {
    try {
        const result = loginSchema.safeParse(req.body);
        if (!result.success) return res.status(400).json({ error: result.error.errors[0].message });
        
        const { username, password, token: totpToken } = result.data;
        const [user] = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);

        let isValid = false;
        if (user && user.hash && user.salt) {
            isValid = await verifyPassword(password, user.hash, user.salt);
        }

        const clientIp = req.ip;
        const userAgent = req.headers['user-agent'] || 'Unknown';

        if (isValid) {
            // Check account expiry
            if (user.expiry && new Date(user.expiry) < new Date()) {
                await logLoginAttempt(username, clientIp, userAgent, false);
                return res.status(403).json({ valid: false, error: 'Compte expiré. Contactez un administrateur.' });
            }

            if (user.twoFactorSecret) {
                if (!totpToken) return res.status(403).json({ valid: false, error: '2FA_REQUIRED' });
                if (!authenticator.check(totpToken, user.twoFactorSecret)) {
                    return res.status(401).json({ valid: false, error: 'Code 2FA invalide' });
                }
            }

            await logLoginAttempt(username, clientIp, userAgent, true);
            const token = jwt.sign({ username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
            res.json({ valid: true, token, role: user.role });
        } else {
            await logLoginAttempt(username, clientIp, userAgent, false);
            setTimeout(() => res.status(401).json({ valid: false, error: 'Invalid credentials' }), Math.random() * 500 + 200);
        }
    } catch (e) {
        next(e);
    }
});

router.get('/check', auth, async (req, res) => {
    try {
        const [user] = await db.select().from(schema.users).where(eq(schema.users.username, req.user.username)).limit(1);
        if (!user) return res.status(401).json({ error: 'User not found' });
        res.json({ valid: true, username: user.username, role: user.role });
    } catch (e) {
        res.status(500).json({ error: 'Internal process error' });
    }
});

router.get('/history', auth, requireAdmin, async (req, res) => {
    try {
        const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 100), 5000);
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        const history = await db.select()
            .from(schema.logs)
            .where(and(eq(schema.logs.type, 'auth')))
            .orderBy(desc(schema.logs.timestamp))
            .limit(limit).offset(offset);
        res.json(history.map(h => ({
            timestamp: h.timestamp,
            username: h.name,
            ip: h.realIp,
            description: h.virtualIp, // Using virtualIp for UA/Description
            status: h.status
        })));
    } catch (e) {
        res.json([]);
    }
});

router.post('/2fa/generate', auth, requireManager, async (req, res) => {
    try {
        const [user] = await db.select().from(schema.users).where(eq(schema.users.username, req.user.username)).limit(1);
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        const secret = authenticator.generateSecret();
        const otpauth = authenticator.keyuri(user.username, 'WG-Shield', secret);
        const qrCodeUrl = await QRCode.toDataURL(otpauth);
        res.json({ secret, qrCodeUrl });
    } catch (e) {
        res.status(500).json({ error: 'QR Gen failed' });
    }
});

router.post('/2fa/enable', auth, requireManager, async (req, res) => {
    const { token, secret } = req.body;
    if (!authenticator.check(token, secret)) return res.status(400).json({ error: 'Invalid token' });
    
    try {
        await db.update(schema.users).set({ twoFactorSecret: secret }).where(eq(schema.users.username, req.user.username));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to enable 2FA' });
    }
});

router.post('/2fa/disable', auth, requireManager, async (req, res) => {
    try {
        await db.update(schema.users).set({ twoFactorSecret: null }).where(eq(schema.users.username, req.user.username));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to disable 2FA' });
    }
});

module.exports = router;
