// services/executors/base.js — Interface commune des exécuteurs.
//
// Stateless. Méthode unique run(). La forme du retour est figée pour garantir
// la rétrocompatibilité des consommateurs (identique à runCommand de shell-core) :
//   succès → { success: true, stdout, stderr }
//   échec  → { success: false, error, code }

class BaseExecutor {
  // eslint-disable-next-line no-unused-vars
  async run(file, args = [], stdinData = null) {
    throw new Error('Not implemented');
  }
}

module.exports = BaseExecutor;
