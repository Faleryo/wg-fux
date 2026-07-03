// routes/servers.js — Gestion des VPS revendeurs (registre des cibles d'exécution).
//
// Monté sous /api/servers (APRÈS le middleware d'auth, comme les autres routes /api).
// Un revendeur (ou admin) enregistre son VPS ici et reçoit le one-liner de
// provisioning à coller dessus. Voir spec 2026-06-30 section 6.1.

const express = require('express');
const { z } = require('zod');
const router = express.Router();

const { db, schema } = require('../../db');
const { eq, and } = require('drizzle-orm');
const { auth } = require('../middleware/auth');
const { encryptPrivateKey } = require('../services/crypto');
const { generateKeyPair, generateToken, hashToken } = require('../services/sshKeys');
const { renderBootstrap } = require('./provision');
const { auditLog } = require('../services/audit');
const log = require('../services/logger');
const { asyncWrap, createError } = require('../utils/errors');

// TTL du token de provisioning : 10 minutes (usage unique).
const PROVISION_TOKEN_TTL_MS = 10 * 60 * 1000;

// Période d'essai offerte à l'enregistrement d'un VPS : 30 jours.
// Ensuite l'admin prolonge licenseExpiry (abonnement payé) via PATCH.
const LICENSE_TRIAL_MS = 30 * 24 * 3600 * 1000;

// Validation de la création d'un serveur. `host` accepte IPv4/IPv6/hostname ;
// on reste permissif mais borné (anti-injection : pas d'espaces/quotes).
const createServerSchema = z
  .object({
    label: z.string().min(1, 'Label requis').max(64, 'Label trop long'),
    host: z
      .string()
      .min(1, 'Host requis')
      .max(255, 'Host trop long')
      .regex(/^[a-zA-Z0-9.:_-]+$/, 'Host invalide (IPv4/IPv6/hostname attendu)'),
    port: z
      .union([z.number(), z.string()])
      .transform((v) => parseInt(v, 10))
      .refine((n) => Number.isInteger(n) && n > 0 && n < 65536, 'Port invalide')
      .optional(),
  })
  .strict();

// Projection publique d'un serveur : JAMAIS de clé privée / hash de token / IV.
// licenseKey n'est PAS exposée ici (credential de l'instance) — seulement à la création.
function publicServer(s) {
  return {
    id: s.id,
    label: s.label,
    host: s.host,
    port: s.port,
    status: s.status,
    lastChecked: s.lastChecked,
    lastError: s.lastError,
    licenseExpiry: s.licenseExpiry,
    lastHeartbeat: s.lastHeartbeat,
    clientCount: s.clientCount,
    scriptsVersion: s.scriptsVersion,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/servers — enregistre un VPS et renvoie le one-liner de provisioning.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/',
  auth,
  asyncWrap(async (req, res) => {
    const parsed = createServerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation échouée'));
    }
    const { label, host } = parsed.data;
    const port = parsed.data.port || 22;

    // 1. Génère la paire SSH ; chiffre la privée (AES-256-GCM via crypto.js).
    const { privateKey, publicKey } = generateKeyPair();
    const enc = encryptPrivateKey(privateKey);

    // 2. Mint le token de provisioning (256 bits) ; on ne stocke que son hash.
    const token = generateToken();
    const provisionTokenHash = hashToken(token);
    const provisionTokenExpiry = new Date(Date.now() + PROVISION_TOKEN_TTL_MS);

    // 2bis. Clé de licence de l'instance (256 bits) + essai de 30 jours.
    const licenseKey = generateToken();
    const licenseExpiry = new Date(Date.now() + LICENSE_TRIAL_MS);

    // 3. INSERT (status 'pending' jusqu'à la vérification SSH).
    let inserted;
    try {
      [inserted] = await db
        .insert(schema.servers)
        .values({
          ownerId: req.user.id,
          label,
          host,
          port,
          sshUsername: 'wg-fux',
          encPrivateKey: enc.encPrivateKey,
          encKeyIv: enc.encKeyIv,
          encKeyAuth: enc.encKeyAuth,
          publicKey,
          status: 'pending',
          provisionTokenHash,
          provisionTokenExpiry,
          licenseKey,
          licenseExpiry,
        })
        .returning();
    } catch (dbErr) {
      if (
        dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        dbErr.message?.includes('UNIQUE constraint')
      ) {
        return res
          .status(409)
          .json(createError(`Le serveur ${host}:${port} est déjà enregistré`, null, 'CONFLICT'));
      }
      throw dbErr;
    }

    // 4. Calcule le one-liner + le sha256 du SCRIPT RENDU (réutilise le templating).
    const { sha256: scriptSha256 } = await renderBootstrap(inserted, { req });

    const base =
      (process.env.PLATFORM_BASE_URL || '').trim().replace(/\/+$/, '') ||
      `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;
    const tlsPin = (process.env.TLS_PINNED_PUBKEY || '').trim();
    const pinFlag = tlsPin ? `--pinnedpubkey '${tlsPin}' ` : '';

    // Le token passe en variable d'env (WG_T), jamais dans argv (anti ps aux).
    const oneLiner =
      `WG_T=${token}; WG_H=${scriptSha256}; ` +
      `S=$(curl --proto '=https' --tlsv1.3 ${pinFlag}-fsSL "${base}/provision/$WG_T/script") && ` +
      'printf \'%s\' "$S" | sha256sum -c <(echo "$WG_H  -") && WG_T=$WG_T bash -c "$S"';

    await auditLog({
      actor: req.user.username,
      action: 'create_server',
      targetType: 'server',
      targetName: label,
      details: { serverId: inserted.id, host, port },
      ip: req.ip,
    });

    log.info('servers', 'Serveur enregistré (pending)', { serverId: inserted.id });

    res.json({
      serverId: inserted.id,
      oneLiner,
      scriptSha256,
      expiresAt: provisionTokenExpiry.toISOString(),
      licenseExpiry: licenseExpiry.toISOString(), // fin d'essai (30 jours)
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/servers — liste les serveurs du revendeur (admin voit tout).
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/',
  auth,
  asyncWrap(async (req, res) => {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'manager';
    const rows = isAdmin
      ? await db.select().from(schema.servers)
      : await db.select().from(schema.servers).where(eq(schema.servers.ownerId, req.user.id));
    res.json(rows.map(publicServer));
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/servers/:id — supprime si ownership OK.
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  '/:id',
  auth,
  asyncWrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json(createError('Identifiant de serveur invalide'));
    }

    const isAdmin = req.user.role === 'admin' || req.user.role === 'manager';
    const where = isAdmin
      ? eq(schema.servers.id, id)
      : and(eq(schema.servers.id, id), eq(schema.servers.ownerId, req.user.id));

    const [server] = await db.select().from(schema.servers).where(where).limit(1);
    if (!server) {
      return res
        .status(404)
        .json(createError('Serveur introuvable ou non autorisé', null, 'NOT_FOUND'));
    }

    await db.delete(schema.servers).where(eq(schema.servers.id, server.id));

    await auditLog({
      actor: req.user.username,
      action: 'delete_server',
      targetType: 'server',
      targetName: server.label,
      details: { serverId: server.id },
      ip: req.ip,
    });

    res.json({ success: true });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/servers/:id/license — renouvelle la licence (ADMIN uniquement :
// c'est l'acte de facturation — le revendeur paie, l'admin prolonge).
// Body : { extendDays: 30 }  OU  { expiry: "2026-08-01T00:00:00Z" }
//        { revoke: true } coupe immédiatement (impayé).
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  '/:id/license',
  auth,
  asyncWrap(async (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json(createError('Réservé à l’admin', null, 'FORBIDDEN'));
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json(createError('Identifiant de serveur invalide'));
    }
    const [server] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, id))
      .limit(1);
    if (!server) {
      return res.status(404).json(createError('Serveur introuvable', null, 'NOT_FOUND'));
    }

    const { extendDays, expiry, revoke } = req.body || {};
    let newExpiry;
    if (revoke === true) {
      newExpiry = new Date(0); // licence coupée immédiatement
    } else if (Number.isInteger(extendDays) && extendDays > 0 && extendDays <= 3650) {
      // Prolonge depuis l'expiry courante si encore valide, sinon depuis maintenant
      // (un renouvellement tardif ne "perd" pas de jours, un anticipé les cumule).
      const base = Math.max(Date.now(), server.licenseExpiry ? new Date(server.licenseExpiry).getTime() : 0);
      newExpiry = new Date(base + extendDays * 24 * 3600 * 1000);
    } else if (expiry && !Number.isNaN(Date.parse(expiry))) {
      newExpiry = new Date(expiry);
    } else {
      return res
        .status(400)
        .json(createError('extendDays (1-3650), expiry (ISO) ou revoke:true requis'));
    }

    await db
      .update(schema.servers)
      .set({ licenseExpiry: newExpiry })
      .where(eq(schema.servers.id, id));

    await auditLog({
      actor: req.user.username,
      action: revoke ? 'revoke_license' : 'renew_license',
      targetType: 'server',
      targetName: server.label,
      details: { serverId: id, licenseExpiry: newExpiry.toISOString() },
      ip: req.ip,
    });

    res.json({ success: true, licenseExpiry: newExpiry.toISOString() });
  })
);

module.exports = router;
