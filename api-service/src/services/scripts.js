const { runSystemCommand } = require('./shell');
const { getScriptPath } = require('./config');

/**
 * Executes a shell script with optional JSON parsing
 */
const executeScript = async (scriptName, args = [], options = { json: false }) => {
  const scriptPath = getScriptPath(scriptName);
  const finalArgs = options.json ? [...args, '--json'] : args;
    
  const result = await runSystemCommand(scriptPath, finalArgs);
    
  if (!result.success) {
    return { 
      success: false, 
      error: result.error, 
      code: result.code || 'SHELL_ERROR' 
    };
  }

  if (options.json) {
    try {
      return { 
        success: true, 
        data: JSON.parse(result.stdout) 
      };
    } catch (e) {
      console.error(`[BRIDGE-CRITICAL] Malformed JSON from ${scriptName}. Error: ${e.message}`);
      console.error(`[BRIDGE-STDOUT-DUMP]: ${result.stdout.substring(0, 500)}`);
      return { 
        success: false, 
        error: `Protocol Error: ${scriptName} produced invalid data`, 
        code: 'ERR_MALFORMED_JSON',
        raw: result.stdout 
      };
    }
  }

  return result;
};

module.exports = {
  executeScript
};
