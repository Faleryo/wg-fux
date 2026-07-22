const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { rateLimit } = require('express-rate-limit');
const { db, schema } = require('../../db');
const { eq, desc, and, gt, count } = require('drizzle-orm');
const { loginSchema } = require('../../db/validation');
const { auth, requireAdmin, requireManager, blacklistToken } = require('../middleware/auth');
const { verifyPassword, logLoginAttempt } = require('../services/auth');
const { runSystemCommand } = require('../services/shell');
const { getScriptPath } = require('../services/config');
const { asyncWrap, createError } = require('../utils/errors');

let lastLoginAlertTime = 0;
const LOGIN_ALERT_COOLDOWN = 300000; // 5 minutes

// Shorter TTL = smaller exposure window if a token leaks.
// Viewers get a long TTL for convenience (monitoring dashboards stay open).
const TOKEN_TTL = { admin: '4h', manager: '8h', viewer: '24h' };

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Trop de tentatives de refresh. Veuillez réessayer dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

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
      ]).catch(() => {});
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
      // Check account suspension
      if (user.enabled === false) {
        await logLoginAttempt(username, clientIp, userAgent, false);
        return res
          .status(403)
          .json(
            createError('Compte suspendu. Contactez un administrateur.', null, 'ACCOUNT_DISABLED')
          );
      }
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
          await logLoginAttempt(username, clientIp, userAgent, false);
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
        expiresIn: TOKEN_TTL[user.role] || '24h',
      });
      // `twoFactorEnabled` est renvoyé ici comme dans /auth/check : sans lui, le
      // client ne peut pas distinguer « 2FA absente » de « pas encore connue »
      // et la bannière d'incitation 2FA (MainLayout, test `=== false`) restait
      // invisible jusqu'au prochain rechargement de page.
      res.json({ valid: true, token, role: user.role, twoFactorEnabled: !!user.twoFactorSecret });
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

      // Respond immediately to avoid holding connections open under brute-force.
      // Signal the suggested wait via Retry-After so legitimate clients can back off.
      const delayMs = Math.min(10000, 500 * Math.pow(2, Math.min(attempts, 4)));
      res
        .status(401)
        .set('Retry-After', Math.ceil(delayMs / 1000))
        .json(createError('Invalid credentials', null, 'INVALID_AUTH'));
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
    res.json({
      valid: true,
      username: user.username,
      role: user.role,
      twoFactorEnabled: !!user.twoFactorSecret,
    });
  })
);

router.post(
  '/logout',
  auth,
  asyncWrap(async (req, res) => {
    blacklistToken(req.user);
    res.json({ success: true });
  })
);

router.post(
  '/refresh',
  refreshLimiter,
  auth,
  asyncWrap(async (req, res) => {
    const [user] = await db
      .select({
        username: schema.users.username,
        role: schema.users.role,
        enabled: schema.users.enabled,
        expiry: schema.users.expiry,
      })
      .from(schema.users)
      .where(eq(schema.users.username, req.user.username))
      .limit(1);
    if (!user) return res.status(401).json(createError('User not found', null, 'NOT_FOUND'));
    if (user.enabled === false)
      return res.status(401).json(createError('Compte suspendu', null, 'ACCOUNT_DISABLED'));
    if (user.expiry && new Date(user.expiry) < new Date())
      return res.status(403).json(createError('Compte expiré', null, 'ACCOUNT_EXPIRED'));
    const token = jwt.sign({ username: user.username, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: TOKEN_TTL[user.role] || '24h',
    });
    res.json({ token, role: user.role });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Inscription PAR INVITATION (croissance du réseau revendeurs). Publique mais
// gardée par un token d'invitation usage-unique TTL 7 j (généré par un compte
// top-level via POST /api/resellers/invites). L'invité devient : admin inviteur
// → revendeur N1 top-level ; revendeur N1 inviteur → sous-revendeur N2.
// ─────────────────────────────────────────────────────────────────────────────
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives. Veuillez réessayer dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Résout un token d'invitation → { invite, inviter } ou null (inconnu/expiré/utilisé).
async function resolveInvite(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null;
  const { hashToken } = require('../services/sshKeys');
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.tokenHash, hashToken(token)))
    .limit(1);
  if (!invite || invite.usedAt) return null;
  if (new Date(invite.expiresAt).getTime() < Date.now()) return null;
  const [inviter] = await db
    .select({ id: schema.users.id, username: schema.users.username, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, invite.inviterId))
    .limit(1);
  if (!inviter) return null;
  return { invite, inviter };
}

// Infos publiques d'une invitation (pour afficher la page d'inscription).
router.get(
  '/invite/:token',
  registerLimiter,
  asyncWrap(async (req, res) => {
    const resolved = await resolveInvite(req.params.token);
    if (!resolved) {
      return res
        .status(404)
        .json(createError('Invitation invalide ou expirée', null, 'INVALID_INVITE'));
    }
    const termsUrl = await require('../services/settings')
      .getSetting('terms_url')
      .catch(() => null);
    // Marque de l'inviteur : la page d'inscription s'affiche à ses couleurs.
    let brand = null;
    try {
      brand = await require('../services/brand').resolveBrand(resolved.inviter.id);
    } catch {
      /* non bloquant */
    }
    res.json({
      valid: true,
      inviter: resolved.inviter.username,
      expiresAt: new Date(resolved.invite.expiresAt).toISOString(),
      termsUrl: termsUrl || null,
      brand,
    });
  })
);

router.post(
  '/register',
  registerLimiter,
  asyncWrap(async (req, res) => {
    const { z } = require('zod');
    const registerSchema = z.object({
      token: z.string().min(16).max(256),
      username: z
        .string()
        .min(2)
        .max(32)
        .regex(/^[a-zA-Z0-9_-]+$/, 'Nom invalide'),
      password: z.string().min(8, 'Mot de passe trop court (min 8)'),
      email: z.string().email('Email invalide').max(255).optional(),
      acceptTerms: z.boolean().optional(),
    });
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation échouée'));
    }
    const { token, username, password, email, acceptTerms } = parsed.data;

    const resolved = await resolveInvite(token);
    if (!resolved) {
      return res
        .status(403)
        .json(createError('Invitation invalide ou expirée', null, 'INVALID_INVITE'));
    }

    // CGU : si la plateforme en a configuré, l'acceptation est obligatoire.
    const termsUrl = await require('../services/settings')
      .getSetting('terms_url')
      .catch(() => null);
    if (termsUrl && acceptTerms !== true) {
      return res
        .status(400)
        .json(createError('Vous devez accepter les CGU', null, 'TERMS_REQUIRED'));
    }

    const { hashPassword } = require('../services/auth');
    const { hash, salt } = await hashPassword(password);
    // Hiérarchie : invité par l'admin → top-level (parentId NULL, peut revendre) ;
    // invité par un revendeur → sous-revendeur (parentId = inviteur).
    const parentId = resolved.inviter.role === 'admin' ? null : resolved.inviter.id;

    let created;
    try {
      [created] = await db
        .insert(schema.users)
        .values({
          username,
          hash,
          salt,
          role: 'reseller',
          parentId,
          email: email ?? null,
          acceptedTermsAt: acceptTerms === true ? new Date() : null,
          enabled: true,
        })
        .returning({ id: schema.users.id, username: schema.users.username });
    } catch (dbErr) {
      if (
        dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        dbErr.message?.includes('UNIQUE constraint')
      ) {
        return res.status(409).json(createError('Nom déjà pris', null, 'CONFLICT'));
      }
      throw dbErr;
    }

    // Consomme l'invitation (usage unique) + ouvre le wallet.
    await db
      .update(schema.invites)
      .set({ usedAt: new Date(), usedByUserId: created.id })
      .where(eq(schema.invites.id, resolved.invite.id));
    require('../services/wallet').ensureWallet(created.id);

    const { auditLog } = require('../services/audit');
    await auditLog({
      actor: username,
      action: 'register',
      targetType: 'user',
      targetName: username,
      details: { inviterId: resolved.inviter.id, parentId },
      ip: req.ip,
    });

    res.status(201).json({ success: true, username: created.username });
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
      .where(eq(schema.logs.type, 'auth'))
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
  twoFaLimiter,
  asyncWrap(async (req, res) => {
    const { token, secret } = req.body;

    if (!token || typeof token !== 'string' || token.length < 6) {
      return res.status(400).json(createError('Token TOTP invalide', null, 'BAD_REQUEST'));
    }
    if (!secret || typeof secret !== 'string' || secret.length < 16) {
      return res.status(400).json(createError('Secret 2FA invalide', null, 'BAD_REQUEST'));
    }

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
  twoFaLimiter,
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
