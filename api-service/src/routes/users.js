const express = require('express');
const router = express.Router();
const { db, schema } = require('../../db');
const { eq, inArray, and, gt, desc } = require('drizzle-orm');
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
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
        expiry: schema.users.expiry,
        enabled: schema.users.enabled,
        email: schema.users.email,
        parentId: schema.users.parentId,
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

    const { username, password, role, expiry, email } = result.data;

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
      email: email || null,
    });
    res.status(201).json({ success: true });
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

    const { password, role, expiry, enabled, email } = result.data;

    const [existing] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);
    if (!existing) {
      return res.status(404).json(createError('User not found', null, 'NOT_FOUND'));
    }

    const updateData = {};
    if (password) {
      const { hash, salt } = await hashPassword(password);
      updateData.hash = hash;
      updateData.salt = salt;
    }
    if (role) updateData.role = role;
    if (expiry !== undefined) updateData.expiry = expiry;
    if (enabled !== undefined) updateData.enabled = enabled;
    if (email !== undefined) updateData.email = email;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json(createError('No fields to update', null, 'BAD_REQUEST'));
    }
    await db.update(schema.users).set(updateData).where(eq(schema.users.username, username));
    invalidateUserCache(username);
    res.json({ success: true });
  })
);

router.delete(
  '/:username',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const { username } = req.params;
    // BUG-FIX: process.env.ADMIN_USER can be undefined if the env var is not set.
    // `someString === undefined` is always false, which silently bypasses the protection.
    // We now only include the ADMIN_USER check when the variable is actually configured.
    if (username === req.user.username) {
      return res
        .status(400)
        .json(createError('Cannot delete your own account', null, 'SELF_DELETE_FORBIDDEN'));
    }
    const adminUser = process.env.ADMIN_USER;
    const isProtectedAdmin = username === 'admin' || (adminUser && username === adminUser);
    if (isProtectedAdmin) {
      return res
        .status(400)
        .json(createError('Cannot delete root administrator', null, 'FORBIDDEN_PROTECTED_USER'));
    }

    // Orphan containers owned by this user so they remain accessible to admins
    // rather than becoming stuck with a non-existent owner.
    const newOwner = process.env.ADMIN_USER || req.user.username;
    await db
      .update(schema.containers)
      .set({ owner: newOwner })
      .where(eq(schema.containers.owner, username));
    await db.delete(schema.users).where(eq(schema.users.username, username));
    invalidateUserCache(username);
    res.json({ success: true });
  })
);

router.get(
  '/:username/report',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const { username } = req.params;

    const [user] = await db
      .select({
        username: schema.users.username,
        role: schema.users.role,
        expiry: schema.users.expiry,
      })
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);
    if (!user) return res.status(404).json(createError('User not found', null, 'NOT_FOUND'));

    const userContainers = await db
      .select({ name: schema.containers.name })
      .from(schema.containers)
      .where(eq(schema.containers.owner, username));
    const containerNames = userContainers.map((c) => c.name);

    let allClients = [];
    if (containerNames.length > 0) {
      allClients = await db
        .select()
        .from(schema.clients)
        .where(inArray(schema.clients.container, containerNames));
    }

    // Validate period param — only 1, 7, or 30 days
    const daysParam = parseInt(req.query.days, 10);
    const days = [1, 7, 30].includes(daysParam) ? daysParam : 7;
    const sincePeriod = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Build breakdown: hourly for day view, daily for week/month
    const breakdown = [];
    if (days === 1) {
      for (let i = 23; i >= 0; i--) {
        const h = new Date(Date.now() - i * 3600 * 1000);
        breakdown.push({
          label: h.getHours().toString().padStart(2, '0') + 'h',
          date: h.toISOString().slice(0, 13),
          count: 0,
        });
      }
      allClients.forEach((c) => {
        if (!c.createdAt) return;
        const created = new Date(c.createdAt);
        if (created < sincePeriod) return;
        const hourKey = created.toISOString().slice(0, 13);
        const entry = breakdown.find((e) => e.date === hourKey);
        if (entry) entry.count++;
      });
    } else {
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        breakdown.push({ label: dateStr.slice(5), date: dateStr, count: 0 });
      }
      allClients.forEach((c) => {
        if (!c.createdAt) return;
        const created = new Date(c.createdAt);
        if (created < sincePeriod) return;
        const dayStr = created.toISOString().split('T')[0];
        const entry = breakdown.find((e) => e.date === dayStr);
        if (entry) entry.count++;
      });
    }

    const newClientsInPeriod = allClients.filter(
      (c) => c.createdAt && new Date(c.createdAt) > sincePeriod
    ).length;

    const activityLimit = days === 1 ? 15 : days === 7 ? 30 : 50;
    const recentActivity = await db
      .select({
        timestamp: schema.auditLogs.timestamp,
        action: schema.auditLogs.action,
        targetType: schema.auditLogs.targetType,
        targetName: schema.auditLogs.targetName,
        ip: schema.auditLogs.ip,
      })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.actor, username), gt(schema.auditLogs.timestamp, sincePeriod)))
      .orderBy(desc(schema.auditLogs.timestamp))
      .limit(activityLimit);

    // Peers groupés par conteneur : l'admin déplie un conteneur dans le rapport
    // pour VOIR ses peers (lecture seule), sans qu'ils polluent sa vue Conteneurs.
    const clientsByContainer = {};
    for (const name of containerNames) clientsByContainer[name] = [];
    for (const c of allClients) {
      (clientsByContainer[c.container] || (clientsByContainer[c.container] = [])).push({
        id: c.id,
        name: c.name,
        ip: c.ip,
        enabled: c.enabled !== false,
        expiry: c.expiry || null,
        createdAt: c.createdAt || null,
      });
    }

    res.json({
      user,
      containers: containerNames,
      clientsByContainer,
      stats: {
        totalContainers: containerNames.length,
        totalClients: allClients.length,
        activeClients: allClients.filter((c) => c.enabled !== false).length,
        newClientsInPeriod,
      },
      breakdown,
      days,
      recentActivity,
    });
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
