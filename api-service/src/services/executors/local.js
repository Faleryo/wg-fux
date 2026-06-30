// services/executors/local.js — Exécution LOCALE (comportement historique).
//
// Reproduit exactement la logique sudo de l'ancien runSystemCommand :
// si SUDO est défini (process non-root) on préfixe par `sudo -E -n`, sinon
// on exécute le binaire directement. Aucune réécriture, juste un wrapper.

const BaseExecutor = require('./base');
// On garde la référence au MODULE (et non une destructuration) pour que
// runCommand reste un point d'observation/mock unique côté tests.
const core = require('../shell-core');
const { SUDO, SUDO_ARGS } = core;

class LocalExecutor extends BaseExecutor {
  async run(file, args = [], stdinData = null) {
    if (SUDO) {
      return core.runCommand(SUDO, [...SUDO_ARGS, file, ...args], stdinData);
    }
    return core.runCommand(file, args, stdinData);
  }
}

// Singleton : un seul exécuteur local pour tout le processus (cf. spec §3.6).
module.exports = new LocalExecutor();
// Expose aussi la classe pour les tests / instanciations explicites.
module.exports.LocalExecutor = LocalExecutor;
