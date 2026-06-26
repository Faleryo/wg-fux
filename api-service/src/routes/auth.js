const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { rateLimit } = require('express-rate-limit');
const { db, schema } = require('../../db');
const { eq, desc, and, gt, count } = require('drizzle-orm');
const { loginSchema } = require('../../db/validation');
const { auth, requireAdmin, requireManager } = require('../middleware/auth');
const { verifyPassword, logLoginAttempt } = require('../services/auth');
const { runSystemCommand } = require('../services/shell');
const { getScriptPath } = require('../services/config');
const { asyncWrap, createError } = require('../utils/errors');

let lastLoginAlertTime = 0;
const LOGIN_ALERT_COOLDOWN = 300000; // 5 minutes

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives. Veuillez réessayer dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    const now = Date.now();
    if (now - lastLoginAlertTime > LOGIN_ALERT_COOLDOWN) {
      lastLoginAlertTime = now;
      const ip = req.ip;
      runSystemCommand(getScriptPath('wg-send-msg.sh'), [
        `⚠️ ALERTE SÉCURITÉ: Trop de tentatives de connexion échouées depuis l'IP ${ip}`,
      ]);
    }
    res
      .status(options.statusCode)
      .json(createError(options.message.error, 'Rate limit exceeded', 'AUTH_RATE_LIMIT', req.path));
  },
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Authentifie un utilisateur (JWT + 2FA optionnel)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               token:
 *                 type: string
 *                 description: TOTP 6 chiffres (si 2FA activé)
 *     responses:
 *       200:
 *         description: Authentification réussie
 *       401:
 *         description: Identifiants invalides
 *       403:
 *         description: 2FA requis ou compte expiré
 */
router.post(
  '/login',
  loginLimiter,
  asyncWrap(async (req, res, _next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation failed'));
    }

    const { username, password, token: totpToken } = parsed.data;
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);

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
        return res
          .status(403)
          .json(
            createError('Compte expiré. Contactez un administrateur.', null, 'ACCOUNT_EXPIRED')
          );
      }

      if (user.twoFactorSecret) {
        if (!totpToken) {
          return res
            .status(403)
            .json(createError('2FA Required', 'MFA secondary factor missing', '2FA_REQUIRED'));
        }
        if (!authenticator.check(totpToken, user.twoFactorSecret)) {
          return res.status(401).json(createError('Code 2FA invalide', null, 'INVALID_2FA'));
        }
      }

      await logLoginAttempt(username, clientIp, userAgent, true);

      // SECURITY-ALERT: Notify admin of successful login
      if (user.role === 'admin') {
        const message = `🔐 CONNEXION RÉUSSIE: Administrateur '${username}' connecté depuis ${clientIp}`;
        runSystemCommand(getScriptPath('wg-send-msg.sh'), [message]).catch(() => {});
      }

      const token = jwt.sign({ username: user.username, role: user.role }, process.env.JWT_SECRET, {
        expiresIn: '24h',
      });
      res.json({ valid: true, token, role: user.role });
    } else {
      await logLoginAttempt(username, clientIp, userAgent, false);

      // SRE-HARDENING: Progressive delay to combat distributed brute-force
      const [result] = await db
        .select({ value: count() })
        .from(schema.logs)
        .where(
          and(
            eq(schema.logs.name, username),
            eq(schema.logs.status, 'failure'),
            gt(schema.logs.timestamp, new Date(Date.now() - 15 * 60 * 1000))
          )
        );
      const attempts = result.value;

      const delay = Math.min(10000, 500 * Math.pow(2, Math.min(attempts, 4)));
      setTimeout(
        () => {
          // Client may have disconnected during the throttle delay — guard so
          // `res.json` on a closed socket doesn't crash the process.
          if (res.headersSent || res.writableEnded) return;
          try {
            res.status(401).json(createError('Invalid credentials', null, 'INVALID_AUTH'));
          } catch (_err) {
            /* socket closed during throttled response */
          }
        },
        delay + Math.random() * 500
      );
    }
  })
);

/**
 * @openapi
 * /auth/check:
 *   get:
 *     summary: Vérifie la validité du token JWT
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token valide
 *       401:
 *         description: Token invalide ou expiré
 */
router.get(
  '/check',
  auth,
  asyncWrap(async (req, res) => {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, req.user.username))
      .limit(1);
    if (!user) return res.status(401).json(createError('User not found', null, 'NOT_FOUND'));
    res.json({ valid: true, username: user.username, role: user.role });
  })
);

router.get(
  '/history',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 100), 5000);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const history = await db
      .select()
      .from(schema.logs)
      .where(and(eq(schema.logs.type, 'auth')))
      .orderBy(desc(schema.logs.timestamp))
      .limit(limit)
      .offset(offset);
    res.json(
      history.map((h) => ({
        timestamp: h.timestamp,
        username: h.name,
        ip: h.realIp,
        description: h.virtualIp, // Using virtualIp for UA/Description
        status: h.status,
      }))
    );
  })
);

const twoFaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de requêtes 2FA. Veuillez patienter.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/2fa/generate',
  auth,
  requireManager,
  twoFaLimiter,
  asyncWrap(async (req, res) => {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, req.user.username))
      .limit(1);
    if (!user) return res.status(404).json(createError('User not found', null, 'NOT_FOUND'));

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.username, 'WG-Shield', secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauth);
    res.json({ secret, qrCodeUrl });
  })
);

router.post(
  '/2fa/enable',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    const { token, secret } = req.body;

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, req.user.username))
      .limit(1);
    if (!user) return res.status(404).json(createError('User not found', null, 'NOT_FOUND'));

    if (user.twoFactorSecret) {
      return res
        .status(400)
        .json(
          createError(
            '2FA already enabled. Disable it first to change secret.',
            null,
            '2FA_ALREADY_ENABLED'
          )
        );
    }

    if (!authenticator.check(token, secret)) {
      return res.status(400).json(createError('Invalid token', null, 'INVALID_TOKEN'));
    }

    await db
      .update(schema.users)
      .set({ twoFactorSecret: secret })
      .where(eq(schema.users.username, req.user.username));
    res.json({ success: true });
  })
);

router.post(
  '/2fa/disable',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    const { password, token: totpToken } = req.body || {};
    if (!password) {
      return res.status(400).json(createError('Password required', null, 'REAUTH_REQUIRED'));
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, req.user.username))
      .limit(1);
    if (!user) return res.status(404).json(createError('User not found', null, 'NOT_FOUND'));

    const passwordOk = await verifyPassword(password, user.hash, user.salt);
    if (!passwordOk) {
      return res.status(401).json(createError('Invalid credentials', null, 'INVALID_AUTH'));
    }

    if (user.twoFactorSecret) {
      if (!totpToken || !authenticator.check(totpToken, user.twoFactorSecret)) {
        return res.status(401).json(createError('Invalid 2FA token', null, 'INVALID_2FA'));
      }
    }

    await db
      .update(schema.users)
      .set({ twoFactorSecret: null })
      .where(eq(schema.users.username, req.user.username));
    res.json({ success: true });
  })
);

module.exports = router;
