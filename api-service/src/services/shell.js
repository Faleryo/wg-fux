// services/shell.js — Façade rétrocompatible d'exécution.
//
// Le cœur (runCommand, SAFE_ARG, stripAnsi, SUDO, check binaire) vit désormais
// dans shell-core.js. Ce module expose runSystemCommand + les helpers fs en
// leur ajoutant un 4ᵉ argument optionnel { executor } (défaut = LocalExecutor),
// ce qui permet de router l'exécution en LOCAL (sudo, historique) ou à DISTANCE
// (SSH) sans changer aucun appelant existant.

const fs = require('fs').promises;
const { getScriptPath } = require('./config');
const log = require('./logger');

// Cœur partagé : runCommand + ré-exports rétrocompatibles.
const { runCommand, SUDO, SUDO_ARGS } = require('./shell-core');

// Exécuteur local singleton (sudo). Importé paresseusement n'est pas nécessaire :
// local.js ne dépend que de shell-core, pas de cycle.
const localExecutor = require('./executors/local');

/**
 * Exécute un script/binaire via l'exécuteur résolu.
 * Signature historique conservée : runSystemCommand(file, args, stdinData).
 * 4ᵉ arg optionnel { executor } pour cibler un serveur distant.
 * Sans opts.executor → comportement LOCAL strictement identique à avant.
 */
const runSystemCommand = async (file, args = [], stdinData = null, opts = {}) => {
  const executor = opts.executor || localExecutor;
  return executor.run(file, args, stdinData);
};

/**
 * Write a file with sudo if necessary (via tee). opts.executor propagé.
 */
const writeFileAsRoot = async (filePath, content, opts = {}) => {
  const { success, error, code } = await runSystemCommand(
    getScriptPath('wg-file-proxy.sh'),
    ['write', filePath],
    content,
    opts
  );
  return { success, error, code };
};

const appendFileAsRoot = async (filePath, content, opts = {}) => {
  const { success, error, code } = await runSystemCommand(
    getScriptPath('wg-file-proxy.sh'),
    ['append', filePath],
    content,
    opts
  );
  return { success, error, code };
};

const unlinkAsRoot = async (filePath, opts = {}) => {
  const { success, error, code } = await runSystemCommand(
    getScriptPath('wg-file-proxy.sh'),
    ['delete', filePath],
    null,
    opts
  );
  return { success, error, code };
};

const readdirAsRoot = async (dirPath, opts = {}) => {
  const { success, stdout, error, code } = await runSystemCommand(
    getScriptPath('wg-file-proxy.sh'),
    ['list', dirPath],
    null,
    opts
  );
  return { success, stdout, error, code };
};

const readFile = async (filePath) => {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return { success: true, content: data };
  } catch (e) {
    log.error('shell', `Native readFile failed for ${filePath}: ${e.message}`);
    return { success: false, error: e.message };
  }
};

const writeFile = async (filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf8');
    return { success: true };
  } catch (e) {
    log.error('shell', `Native writeFile failed for ${filePath}: ${e.message}`);
    return { success: false, error: e.message };
  }
};

const listDir = async (dirPath) => {
  try {
    const files = await fs.readdir(dirPath);
    return { success: true, files };
  } catch (e) {
    log.error('shell', `Native readdir failed for ${dirPath}: ${e.message}`);
    return { success: false, error: e.message };
  }
};

const unlink = async (filePath) => {
  try {
    await fs.unlink(filePath);
    return { success: true };
  } catch (e) {
    log.error('shell', `Native unlink failed for ${filePath}: ${e.message}`);
    return { success: false, error: e.message };
  }
};

module.exports = {
  runCommand,
  runSystemCommand,
  writeFileAsRoot,
  appendFileAsRoot,
  unlinkAsRoot,
  readdirAsRoot,
  readFile,
  writeFile,
  listDir,
  unlink,
  SUDO,
  SUDO_ARGS,
};
