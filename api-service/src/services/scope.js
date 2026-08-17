// services/scope.js — Tenance du réseau de distribution (arbre revendeurs).
//
// Profondeur bornée à 2 (admin → N1 → N2), mais on utilise un CTE récursif pour
// rester correct si le cap évoluait. descendantIds(root) inclut root.

const { sqlite } = require('../../db');

// Préparation PARESSEUSE : ce module est requis avant que initializeDatabase()
// n'ait créé/migré les tables (colonne users.parentId ajoutée en v13).
let _stmtDescendants = null;
function stmtDescendants() {
  if (!_stmtDescendants) {
    _stmtDescendants = sqlite.prepare(`
      WITH RECURSIVE sub(id) AS (
        SELECT ?
        UNION
        SELECT u.id FROM users u JOIN sub ON u.parentId = sub.id
      )
      SELECT id FROM sub
    `);
  }
  return _stmtDescendants;
}

// Renvoie la liste des ids du sous-arbre (root compris).
function descendantIds(rootId) {
  return stmtDescendants()
    .all(rootId)
    .map((r) => r.id);
}

// targetId appartient-il au sous-arbre de rootId ?
function isInScope(rootId, targetId) {
  return descendantIds(rootId).includes(Number(targetId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloisonnement des PEERS par utilisateur.
//
// Un peer n'appartient à personne en propre : la table `clients` n'a AUCUNE
// colonne de propriétaire. Le lien est indirect — `clients.container` pointe une
// ligne `containers`, et c'est elle qui porte `owner`. Autrement dit, la
// frontière entre deux utilisateurs n'existe ni dans le schéma ni dans une
// contrainte : elle est reconstruite à la main dans chaque route.
//
// Ce filtre était déjà recopié en plusieurs endroits de routes/clients.js. Une
// requête écrite sans lui renvoie la TOTALITÉ des peers de la plateforme — d'où
// ce helper unique, à utiliser par toute nouvelle lecture de peers.
// ─────────────────────────────────────────────────────────────────────────────

// Un admin/manager voit tout ; les autres rôles ne voient que ce qu'ils possèdent.
function seesEverything(user) {
  return user?.role === 'admin' || user?.role === 'manager';
}

let _stmtOwnedContainers = null;
let _stmtAllContainers = null;

/**
 * Noms des conteneurs VISIBLES par cet utilisateur.
 * @param {{role:string, username:string}} user
 * @returns {Set<string>}
 */
function visibleContainerNames(user) {
  if (seesEverything(user)) {
    if (!_stmtAllContainers) _stmtAllContainers = sqlite.prepare('SELECT name FROM containers');
    return new Set(_stmtAllContainers.all().map((r) => r.name));
  }
  if (!_stmtOwnedContainers) {
    _stmtOwnedContainers = sqlite.prepare('SELECT name FROM containers WHERE owner = ?');
  }
  return new Set(_stmtOwnedContainers.all(user?.username ?? '').map((r) => r.name));
}

/**
 * Filtre une liste de peers pour ne garder que ceux visibles par l'utilisateur.
 * @param {Array<{container:string}>} clients
 */
function filterVisibleClients(user, clients) {
  const allowed = visibleContainerNames(user);
  return (clients || []).filter((c) => allowed.has(c.container));
}

module.exports = {
  descendantIds,
  isInScope,
  visibleContainerNames,
  filterVisibleClients,
};
