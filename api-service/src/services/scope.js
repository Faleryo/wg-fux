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
  return stmtDescendants().all(rootId).map((r) => r.id);
}

// targetId appartient-il au sous-arbre de rootId ?
function isInScope(rootId, targetId) {
  return descendantIds(rootId).includes(Number(targetId));
}

module.exports = { descendantIds, isInScope };
