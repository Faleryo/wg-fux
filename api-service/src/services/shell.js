const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);

const isRoot = !process.getuid || process.getuid() === 0;
const SUDO = isRoot ? null : (process.env.SUDO_BIN || 'sudo');
const SUDO_ARGS = isRoot ? [] : ['-n'];

/**
 * Standardized Shell Command Wrapper
 */
const runCommand = async (cmd, args = []) => {
    const commandStr = `${cmd} ${args.join(' ')}`;
    try {
        const { stdout, stderr } = await execFilePromise(cmd, args, { timeout: 10000, maxBuffer: 1024 * 1024 });
        if (stderr) console.warn(`[SHELL-WARN] "${commandStr}": ${stderr}`);
        return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
        const errorMessage = error.stderr ? error.stderr.trim() : error.message;
        console.error(`[SHELL-ERROR] "${commandStr}": ${errorMessage}`);
        return { success: false, error: errorMessage, code: error.code };
    }
};

/**
 * Executes a command with sudo if necessary
 */
const runSystemCommand = async (file, args = []) => {
    if (SUDO) {
        return runCommand(SUDO, [...SUDO_ARGS, file, ...args]);
    }
    return runCommand(file, args);
};

module.exports = {
    runCommand,
    runSystemCommand,
    SUDO,
    SUDO_ARGS
};
