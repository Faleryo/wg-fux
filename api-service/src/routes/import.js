// Import sécurisé d'une config WireGuard par URL.
//
// GET /api/import/:token — PUBLIC (pas d'auth) : le porteur du jeton EST
// l'autorisation. Le jeton (256 bits, base64url) n'est jamais stocké : la DB ne
// contient que son SHA-256 (clients.importTokenHash) + une expiration. Usage
// unique : les champs sont invalidés atomiquement AVANT de servir le fichier —
// deux requêtes concurrentes ne peuvent pas télécharger deux fois.
const express = require('express');
const router = express.Router();
const nodeCrypto = require('crypto');
const path = require('path');
const { rateLimit } = require('express-rate-limit');
const { db, schema } = require('../../db');
const { eq, and } = require('drizzle-orm');
const { readFileAsRoot } = require('../services/shell');
const { resolveExecutor } = require('../services/executors');
const { getClientDir } = require('../services/system');
const { auditLog } = require('../services/audit');
const { asyncWrap } = require('../utils/errors');

// Le jeton est infalsifiable par force brute (2^256), le rate-limit protège
// surtout contre le scan bruyant et les abus de bande passante.
const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/; // base64url de 32 octets = 43 chars

router.get(
  '/:token',
  importLimiter,
  asyncWrap(async (req, res) => {
    const { token } = req.params;
    // Réponse indistincte (404 texte brut) pour jeton malformé, inconnu ou
    // expiré : ne pas donner d'oracle sur l'existence d'un lien.
    const notFound = () => res.status(404).type('text/plain').send('Lien invalide ou expiré.');
    if (!TOKEN_RE.test(token)) return notFound();

    const tokenHash = nodeCrypto.createHash('sha256').update(token).digest('hex');
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.importTokenHash, tokenHash))
      .limit(1);
    if (!client) return notFound();
    if (!client.importTokenExpiry || new Date(client.importTokenExpiry) < new Date()) {
      // Lien périmé : on nettoie pour ne pas laisser traîner un hash mort.
      await db
        .update(schema.clients)
        .set({ importTokenHash: null, importTokenExpiry: null })
        .where(eq(schema.clients.id, client.id));
      return notFound();
    }

    // Usage unique — invalidation conditionnée au hash encore présent : la
    // requête qui gagne la course consomme le jeton, l'autre voit 0 ligne.
    const consumed = await db
      .update(schema.clients)
      .set({ importTokenHash: null, importTokenExpiry: null })
      .where(
        and(eq(schema.clients.id, client.id), eq(schema.clients.importTokenHash, tokenHash))
      );
    if (!consumed || consumed.changes === 0) return notFound();

    // Exécuteur local ou SSH selon le serveur du conteneur (VPS revendeur).
    const [containerRow] = await db
      .select({ serverId: schema.containers.serverId })
      .from(schema.containers)
      .where(eq(schema.containers.name, client.container))
      .limit(1);
    const executor = await resolveExecutor({ serverId: containerRow?.serverId || null });

    const configPath = path.join(getClientDir(client.container, client.name), `${client.name}.conf`);
    const { success, content } = await readFileAsRoot(configPath, { executor });
    if (!success || !content) return notFound();

    await auditLog({
      actor: 'import-link',
      action: 'download_config_via_link',
      targetType: 'client',
      targetName: `${client.container}/${client.name}`,
      ip: req.ip,
    });

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${client.name}.conf"`);
    res.send(content);
  })
);

module.exports = router;
