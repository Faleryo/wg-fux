const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
// BUG-FIX: En production (Docker), les scripts sont dans /usr/local/bin
// En développement, ils sont dans PROJECT_ROOT/core-vpn/scripts
// WAVE 4: Hybrid script path resolver
// If /app/core-vpn/scripts exists (mount), use it. Otherwise use /usr/local/bin (container build).
const { existsSync } = require('fs');
const MOUNT_SCRIPT_DIR = '/app/core-vpn/scripts';
const BUILD_SCRIPT_DIR = '/usr/local/bin';

const SCRIPT_DIR = (() => {
  if (existsSync(MOUNT_SCRIPT_DIR)) return MOUNT_SCRIPT_DIR;
  if (process.env.NODE_ENV === 'production' && existsSync(BUILD_SCRIPT_DIR))
    return BUILD_SCRIPT_DIR;
  return path.join(PROJECT_ROOT, 'core-vpn/scripts');
})();

/**
 * Standardized Script Path Resolver
 */
const ALLOWED_SCRIPT_PREFIXES = ['/usr/local/bin', '/app/core-vpn/scripts'];

const getScriptPath = (scriptName) => {
  // Si le script commence déjà par un chemin absolu, valider qu'il pointe
  // vers un répertoire autorisé pour éviter l'injection de chemins arbitraires.
  if (scriptName.startsWith('/')) {
    const allowed = ALLOWED_SCRIPT_PREFIXES.some((prefix) => scriptName.startsWith(prefix + '/') || scriptName === prefix);
    if (!allowed) {
      throw new Error(`Forbidden script path: ${scriptName}. Must be under ${ALLOWED_SCRIPT_PREFIXES.join(' or ')}.`);
    }
    return scriptName;
  }
  if (scriptName.startsWith('./')) {
    const resolved = path.resolve(scriptName);
    const allowed = ALLOWED_SCRIPT_PREFIXES.some(
      (prefix) => resolved.startsWith(prefix + '/') || resolved === prefix
    );
    if (!allowed) {
      throw new Error(`Forbidden relative script path: ${scriptName}`);
    }
    return resolved;
  }
  // Nom de script "nu" (le cas de tous les appelants actuels) : doit rester un
  // simple basename. Sans ce garde-fou, un futur appelant passant un scriptName
  // avec "../" pourrait échapper à SCRIPT_DIR via path.join (traversal).
  if (scriptName !== path.basename(scriptName)) {
    throw new Error(`Invalid script name: ${scriptName}`);
  }
  return path.join(SCRIPT_DIR, scriptName);
};

module.exports = {
  PROJECT_ROOT,
  SCRIPT_DIR,
  getScriptPath,
};
