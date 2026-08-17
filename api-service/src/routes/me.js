// routes/me.js — « Mon compte » : ce que l'utilisateur CONNECTÉ voit de lui-même.
// Monté sous /api/me, derrière `auth` uniquement : accessible à TOUS les rôles,
// y compris un simple viewer, qui n'avait jusqu'ici aucun moyen de connaître sa
// propre date d'expiration (/auth/check ne la renvoyait pas).
//
// SÉCURITÉ : la liste des peers passe obligatoirement par
// services/scope.filterVisibleClients — la table `clients` n'ayant pas de
// colonne propriétaire, une requête sans ce filtre renverrait les peers de TOUTE
// la plateforme à n'importe quel utilisateur connecté.

const express = require('express');
const router = express.Router();

const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');
const { filterVisibleClients } = require('../services/scope');
const { asyncWrap, createError } = require('../utils/errors');

// Seuil d'alerte : en deçà, on considère l'échéance « imminente » (bandeau UI).
const SOON_DAYS = 7;

// Jours restants avant une échéance. null si pas de date (illimité).
function daysUntil(value) {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

router.get(
  '/',
  asyncWrap(async (req, res) => {
    const [user] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
        expiry: schema.users.expiry,
        enabled: schema.users.enabled,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(eq(schema.users.username, req.user.username))
      .limit(1);
    if (!user) return res.status(401).json(createError('User not found', null, 'NOT_FOUND'));

    const allClients = await db
      .select({
        id: schema.clients.id,
        name: schema.clients.name,
        container: schema.clients.container,
        expiry: schema.clients.expiry,
        enabled: schema.clients.enabled,
      })
      .from(schema.clients);

    const mine = filterVisibleClients(req.user, allClients);

    const peers = mine
      .map((c) => ({
        id: c.id,
        name: c.name,
        container: c.container,
        expiry: c.expiry || null,
        daysLeft: daysUntil(c.expiry),
        enabled: c.enabled !== false,
      }))
      // Les plus urgents d'abord ; les illimités (daysLeft null) en dernier.
      .sort((a, b) => {
        if (a.daysLeft === null) return 1;
        if (b.daysLeft === null) return -1;
        return a.daysLeft - b.daysLeft;
      });

    const accountDaysLeft = daysUntil(user.expiry);
    res.json({
      account: {
        username: user.username,
        role: user.role,
        email: user.email || null,
        enabled: user.enabled !== false,
        expiry: user.expiry || null,
        daysLeft: accountDaysLeft,
        // `expiringSoon` pilote le bandeau : vrai seulement si une échéance
        // existe ET qu'elle approche (un compte illimité ne doit rien afficher).
        expiringSoon:
          accountDaysLeft !== null && accountDaysLeft >= 0 && accountDaysLeft <= SOON_DAYS,
        expired: accountDaysLeft !== null && accountDaysLeft < 0,
      },
      peers,
      totals: {
        total: peers.length,
        active: peers.filter((p) => p.enabled).length,
        expiringSoon: peers.filter(
          (p) => p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= SOON_DAYS
        ).length,
        expired: peers.filter((p) => p.daysLeft !== null && p.daysLeft < 0).length,
        unlimited: peers.filter((p) => p.daysLeft === null).length,
      },
      soonDays: SOON_DAYS,
    });
  })
);

module.exports = router;
module.exports.daysUntil = daysUntil;
