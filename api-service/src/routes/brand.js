// routes/brand.js — White-label du compte courant. Monté /api/brand.
//   GET /          : marque propre + marque résolue (héritée si vide).
//   PUT /          : définit sa marque (revendeur/admin).

const express = require('express');
const { z } = require('zod');
const router = express.Router();

const { requireReseller } = require('../middleware/auth');
const brand = require('../services/brand');
const { auditLog } = require('../services/audit');
const { asyncWrap, createError } = require('../utils/errors');

const brandSchema = z.object({
  name: z.string().max(64).nullish(),
  logoUrl: z.string().url().max(512).nullish().or(z.literal('')),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hex #RRGGBB attendue')
    .nullish()
    .or(z.literal('')),
  customDomain: z
    .string()
    .max(255)
    .regex(/^[a-zA-Z0-9.-]+$/, 'Domaine invalide')
    .nullish()
    .or(z.literal('')),
});

router.get(
  '/',
  requireReseller,
  asyncWrap(async (req, res) => {
    const [own, resolved] = await Promise.all([
      brand.getOwnBrand(req.user.id),
      brand.resolveBrand(req.user.id),
    ]);
    res.json({ own: own || null, resolved });
  })
);

router.put(
  '/',
  requireReseller,
  asyncWrap(async (req, res) => {
    const parsed = brandSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(createError(parsed.error, 'Validation échouée'));
    // Normalise les chaînes vides en null.
    const norm = (v) => (v === '' ? null : v ?? null);
    const saved = await brand.setBrand(req.user.id, {
      name: norm(parsed.data.name),
      logoUrl: norm(parsed.data.logoUrl),
      primaryColor: norm(parsed.data.primaryColor),
      customDomain: norm(parsed.data.customDomain),
    });
    await auditLog({
      actor: req.user.username,
      action: 'update_brand',
      targetType: 'brand',
      targetName: req.user.username,
      details: { name: saved.name },
      ip: req.ip,
    });
    res.json({ success: true, brand: saved });
  })
);

module.exports = router;
