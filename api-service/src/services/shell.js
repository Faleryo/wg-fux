const { execFile, spawn } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);

const isRoot = !process.getuid || process.getuid() === 0;
const SUDO = isRoot ? null : (process.env.SUDO_BIN || 'sudo');
const SUDO_ARGS = isRoot ? [] : ['-n'];

/**
 * Standardized Shell Command Wrapper
 * BUG-FIX: Ajout du support stdin optionnel pour des commandes comme "wg syncconf <iface> /dev/stdin"
 */
const runCommand = async (cmd, args = [], stdinData = null) => {
    const commandStr = `${cmd} ${args.join(' ')}`;
    try {
        if (stdinData !== null) {
            // Mode stdin: utiliser spawn pour pouvoir écrire sur stdin
            return await new Promise((resolve) => {
                const proc = spawn(cmd, args, { timeout: 15000 });
                let stdout = '', stderr = '';
                proc.stdout.on('data', (d) => { stdout += d.toString(); });
                proc.stderr.on('data', (d) => { stderr += d.toString(); });
                proc.on('close', (code) => {
                    if (stderr) console.warn(`[SHELL-WARN] "${commandStr}": ${stderr}`);
                    if (code === 0) {
                        resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
                    } else {
                        console.error(`[SHELL-ERROR] "${commandStr}" exited with code ${code}: ${stderr}`);
                        resolve({ success: false, error: stderr.trim() || `Exit code ${code}`, code });
                    }
                });
                proc.on('error', (err) => {
                    console.error(`[SHELL-ERROR] "${commandStr}": ${err.message}`);
                    resolve({ success: false, error: err.message, code: err.code });
                });
                if (proc.stdin) {
                    proc.stdin.write(stdinData);
                    proc.stdin.end();
                }
            });
        }

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
const runSystemCommand = async (file, args = [], stdinData = null) => {
    if (SUDO) {
        return runCommand(SUDO, [...SUDO_ARGS, file, ...args], stdinData);
    }
    return runCommand(file, args, stdinData);
};

module.exports = {
    runCommand,
    runSystemCommand,
    SUDO,
    SUDO_ARGS
};
