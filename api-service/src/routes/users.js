const express = require('express');
const router = express.Router();
const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');
const { userSchema } = require('../../db/validation');
const { auth, requireAdmin } = require('../middleware/auth');
const { invalidateUserCache } = require('../middleware/auth');
const { hashPassword } = require('../services/auth');

router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const users = await db
      .select({
        username: schema.users.username,
        role: schema.users.role,
        expiry: schema.users.expiry,
      })
      .from(schema.users);
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', auth, requireAdmin, async (req, res, next) => {
  try {
    const result = userSchema.safeParse(req.body);
    if (!result.success) {
      return res
        .status(400)
        .json({ error: result.error.issues?.[0]?.message || 'Validation failed' });
    }

    const { username, password, role, expiry } = result.data;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const [existing] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);
    if (existing) return res.status(400).json({ error: 'User exists' });

    const { hash, salt } = await hashPassword(password);

    await db.insert(schema.users).values({
      username,
      hash,
      salt,
      role: role || 'viewer',
      expiry: expiry || null,
    });
    res.json({ success: true });
  } catch (e) {
    console.error('[API-ERR] POST /api/users failed:', e.stack);
    next(e);
  }
});

router.patch('/:username', auth, requireAdmin, async (req, res) => {
  const { username } = req.params;
  const { password, role, expiry } = req.body;
  try {
    const updateData = {};
    if (password) {
      const { hash, salt } = await hashPassword(password);
      updateData.hash = hash;
      updateData.salt = salt;
    }
    if (role) updateData.role = role;
    if (expiry !== undefined) updateData.expiry = expiry;

    await db.update(schema.users).set(updateData).where(eq(schema.users.username, username));
    invalidateUserCache(username); // Purge cache JWT
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:username', auth, requireAdmin, async (req, res) => {
  const { username } = req.params;
  if (username === 'admin' || username === process.env.ADMIN_USER)
    return res.status(400).json({ error: 'Cannot delete root' });
  try {
    await db.delete(schema.users).where(eq(schema.users.username, username));
    invalidateUserCache(username); // Purge cache JWT
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:username/reset-2fa', auth, requireAdmin, async (req, res) => {
  try {
    await db
      .update(schema.users)
      .set({ twoFactorSecret: null })
      .where(eq(schema.users.username, req.params.username));
    invalidateUserCache(req.params.username); // Purge cache JWT
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
