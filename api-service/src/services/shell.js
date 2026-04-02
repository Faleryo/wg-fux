const { execFile, spawn } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const fs = require('fs').promises;
const log = require('./logger');


const isRoot = !process.getuid || process.getuid() === 0;
const SUDO = isRoot ? null : (process.env.SUDO_BIN || 'sudo');
const SUDO_ARGS = isRoot ? [] : ['-n'];

/**
 * Standardized Shell Command Wrapper
 * HARDENING: Binary existence check and structured logging
 */
const runCommand = async (cmd, args = [], stdinData = null, options = {}) => {
    const timeout = options.timeout || 10000;
    const commandStr = `${cmd} ${args.join(' ')}`;

    
    // Safety check: binary existence (only for absolute paths or specific scripts)
    if (cmd.startsWith('/') || cmd.startsWith('./')) {
        try {
            await fs.access(cmd);
        } catch (e) {
            log.error('shell', `Command binary not found: ${cmd}`);
            return { success: false, error: `Binary not found: ${cmd}`, code: 'ENOENT' };
        }
    }

    try {
        if (stdinData !== null) {
            return await new Promise((resolve) => {
                const proc = spawn(cmd, args, { timeout: options.timeout || 15000 });

                let stdout = '', stderr = '';
                proc.stdout.on('data', (d) => { stdout += d.toString(); });
                proc.stderr.on('data', (d) => { stderr += d.toString(); });
                proc.on('close', (code) => {
                    if (code === 0) {
                        if (stderr) log.warn('shell', `"${commandStr}" produced stderr: ${stderr.trim()}`);
                        resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
                    } else {
                        log.error('shell', `"${commandStr}" exited with code ${code}`, { stderr: stderr.trim() });
                        resolve({ success: false, error: stderr.trim() || `Exit code ${code}`, code });
                    }
                });
                proc.on('error', (err) => {
                    log.error('shell', `"${commandStr}" failed to spawn: ${err.message}`);
                    resolve({ success: false, error: err.message, code: err.code });
                });
                if (proc.stdin) {
                    proc.stdin.write(stdinData);
                    proc.stdin.end();
                }
            });
        }

        const { stdout, stderr } = await execFilePromise(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 });

        if (stderr) log.warn('shell', `"${commandStr}" produced stderr: ${stderr.trim()}`);
        return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
        const errorMessage = error.stderr ? error.stderr.trim() : error.message;
        log.error('shell', `"${commandStr}" failed`, { error: errorMessage, code: error.code });
        return { success: false, error: errorMessage, code: error.code };
    }
};

/**
 * Executes a command with sudo if necessary
 */
const runSystemCommand = async (file, args = [], stdinData = null, options = {}) => {
    if (SUDO) {
        return runCommand(SUDO, [...SUDO_ARGS, file, ...args], stdinData, options);
    }
    return runCommand(file, args, stdinData, options);
};


module.exports = {
    runCommand,
    runSystemCommand,
    SUDO,
    SUDO_ARGS
};

