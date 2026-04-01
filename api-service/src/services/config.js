const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT_DIR = path.join(PROJECT_ROOT, 'core-vpn/scripts');

/**
 * Standardized Script Path Resolver
 */
const getScriptPath = (scriptName) => {
    return path.join(SCRIPT_DIR, scriptName);
};

module.exports = {
    PROJECT_ROOT,
    SCRIPT_DIR,
    getScriptPath
};
