const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
// BUG-FIX: En production (Docker), les scripts sont dans /usr/local/bin
// En développement, ils sont dans PROJECT_ROOT/core-vpn/scripts
// WAVE 4: Hybrid script path resolver
// If /app/core-vpn/scripts exists (mount), use it. Otherwise use /usr/local/bin (container build).
const { existsSync } = require('fs');
const MOUNT_SCRIPT_DIR = '/app/core-vpn/scripts';
const BUILD_SCRIPT_DIR = '/usr/local/bin';

const SCRIPT_DIR = (process.env.NODE_ENV === 'production' && !existsSync(MOUNT_SCRIPT_DIR)) 
  ? BUILD_SCRIPT_DIR 
  : (existsSync(MOUNT_SCRIPT_DIR) ? MOUNT_SCRIPT_DIR : path.join(PROJECT_ROOT, 'core-vpn/scripts'));

/**
 * Standardized Script Path Resolver
 */
const getScriptPath = (scriptName) => {
  // Si le script commence déjà par /usr/local/bin ou /app/, on ne le modifie pas
  if (scriptName.startsWith('/') || scriptName.startsWith('./')) return scriptName;
  return path.join(SCRIPT_DIR, scriptName);
};

module.exports = {
  PROJECT_ROOT,
  SCRIPT_DIR,
  getScriptPath
};
