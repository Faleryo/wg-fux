const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
// BUG-FIX: En production (Docker), les scripts sont dans /usr/local/bin
// En développement, ils sont dans PROJECT_ROOT/core-vpn/scripts
const SCRIPT_DIR = process.env.NODE_ENV === 'production' 
    ? '/usr/local/bin' 
    : path.join(PROJECT_ROOT, 'core-vpn/scripts');

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
