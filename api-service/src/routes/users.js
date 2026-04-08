const express = require('express');
const router = express.Router();
const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');
const { userSchema, userUpdateSchema } = require('../../db/validation');
const { auth, requireAdmin, invalidateUserCache } = require('../middleware/auth');
const { hashPassword } = require('../services/auth');
const { asyncWrap, createError } = require('../utils/errors');
const identifierRegex = /^[a-zA-Z0-9_-]+$/;

// 🛡️ OBSIDIAN-HARDENING: Global parameter validation
router.param('username', (req, res, next, val) => {
  if (!identifierRegex.test(val))
    return res.status(400).json(createError('Invalid username identifier'));
  next();
});

router.get(
  '/',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const users = await db
      .select({
        username: schema.users.username,
        role: schema.users.role,
        expiry: schema.users.expiry,
      })
      .from(schema.users);
    res.json(users);
  })
);

router.post(
  '/',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const result = userSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(createError(result.error, 'Validation failed'));
    }

    const { username, password, role, expiry } = result.data;
    if (!password) {
      return res.status(400).json(createError('Password required', null, 'INVALID_INPUT'));
    }

    const [existing] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);
    if (existing) {
      return res.status(400).json(createError('User already exists', null, 'USER_EXISTS'));
    }

    const { hash, salt } = await hashPassword(password);

    await db.insert(schema.users).values({
      username,
      hash,
      salt,
      role: role || 'viewer',
      expiry: expiry || null,
    });
    res.json({ success: true });
  })
);

router.patch(
  '/:username',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const { username } = req.params;
    const result = userUpdateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(createError(result.error, 'Validation failed'));
    }

    const { password, role, expiry } = result.data;
    const updateData = {};
    if (password) {
      const { hash, salt } = await hashPassword(password);
      updateData.hash = hash;
      updateData.salt = salt;
    }
    if (role) updateData.role = role;
    if (expiry !== undefined) updateData.expiry = expiry;

    if (Object.keys(updateData).length > 0) {
      await db.update(schema.users).set(updateData).where(eq(schema.users.username, username));
      invalidateUserCache(username);
    }
    res.json({ success: true });
  })
);

router.delete(
  '/:username',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const { username } = req.params;
    if (username === 'admin' || username === process.env.ADMIN_USER) {
      return res
        .status(400)
        .json(createError('Cannot delete root administrator', null, 'FORBIDDEN_PROTECTED_USER'));
    }

    await db.delete(schema.users).where(eq(schema.users.username, username));
    invalidateUserCache(username);
    res.json({ success: true });
  })
);

router.post(
  '/:username/reset-2fa',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    await db
      .update(schema.users)
      .set({ twoFactorSecret: null })
      .where(eq(schema.users.username, req.params.username));
    invalidateUserCache(req.params.username);
    res.json({ success: true });
  })
);

module.exports = router;
