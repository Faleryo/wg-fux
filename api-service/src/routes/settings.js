// routes/settings.js — Réglages plateforme (ADMIN). Monté sous /api/settings.
//
// GET  → vue publique (secrets masqués en { configured }).
// PUT  → écrit un lot de réglages. Les secrets vides sont ignorés (on n'efface
//        pas un secret configuré juste parce que le formulaire l'affiche vide) ;
//        pour effacer un secret, envoyer explicitement la valeur "__CLEAR__".

const express = require('express');
const router = express.Router();

const { requireAdmin } = require('../middleware/auth');
const settings = require('../services/settings');
const { auditLog } = require('../services/audit');
const { asyncWrap, createError } = require('../utils/errors');

const CLEAR_SENTINEL = '__CLEAR__';

router.get(
  '/',
  requireAdmin,
  asyncWrap(async (req, res) => {
    res.json(await settings.getPublicSettings());
  })
);

router.put(
  '/',
  requireAdmin,
  asyncWrap(async (req, res) => {
    const body = req.body || {};
    const applied = [];
    for (const [key, rawVal] of Object.entries(body)) {
      if (!(key in settings.KNOWN)) continue; // ignore les clés inconnues
      const secret = settings.isSecret(key);
      let value = rawVal;

      if (secret) {
        if (value === CLEAR_SENTINEL) {
          value = ''; // effacement explicite
        } else if (value == null || value === '') {
          continue; // champ secret laissé vide → on garde l'existant
        }
      }
      await settings.setSetting(key, value);
      applied.push(key);
    }
    if (applied.length === 0) {
      return res.status(400).json(createError('Aucun réglage valide fourni'));
    }
    await auditLog({
      actor: req.user.username,
      action: 'update_settings',
      targetType: 'system',
      targetName: 'app_settings',
      details: { keys: applied },
      ip: req.ip,
    });
    res.json({ success: true, updated: applied });
  })
);

module.exports = router;
