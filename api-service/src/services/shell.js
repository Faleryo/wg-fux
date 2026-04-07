const { execFile, spawn } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const fs = require('fs').promises;
const { getScriptPath } = require('./config');
const log = require('./logger');


const isRoot = !process.getuid || process.getuid() === 0;
const SUDO = isRoot ? null : (process.env.SUDO_BIN || 'sudo');
const SUDO_ARGS = isRoot ? [] : ['-n'];

/**
 * Standardized Shell Command Wrapper
 * HARDENING: Binary existence check and structured logging
 */
const runCommand = async (cmd, args = [], stdinData = null) => {
  const commandStr = `${cmd} ${args.join(' ')}`;
    
  // Safety check: binary existence and executability (only for absolute paths or specific scripts)
  if (cmd.startsWith('/') || cmd.startsWith('./')) {
    try {
      const fsConst = require('fs').constants;
      await fs.access(cmd, fsConst.F_OK | fsConst.X_OK);
    } catch (e) {
      log.error('shell', `Command binary not found or not executable: ${cmd}`);
      return { success: false, error: `Binary not accessible: ${cmd}`, code: 'EACCES_OR_ENOENT' };
    }
  }

  try {
    if (stdinData !== null) {
      return await new Promise((resolve) => {
        const proc = spawn(cmd, args, { timeout: 15000 });
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

    const { stdout, stderr } = await execFilePromise(cmd, args, { timeout: 10000, maxBuffer: 10 * 1024 * 1024 });
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
const runSystemCommand = async (file, args = [], stdinData = null) => {
  if (SUDO) {
    return runCommand(SUDO, [...SUDO_ARGS, file, ...args], stdinData);
  }
  return runCommand(file, args, stdinData);
};

/**
 * Write a file with sudo if necessary (via tee)
 * HARDENING: Using tee avoids shell redirection issues with sudo
 */
const writeFileAsRoot = async (filePath, content) => {
  const { success, error, code } = await runSystemCommand(getScriptPath('wg-file-proxy.sh'), ['write', filePath, content]);
  return { success, error, code };
};

/**
 * Append to a file with sudo if necessary (via tee -a)
 */
const appendFileAsRoot = async (filePath, content) => {
  const { success, error, code } = await runSystemCommand(getScriptPath('wg-file-proxy.sh'), ['append', filePath, content]);
  return { success, error, code };
};

/**
 * Delete a file with sudo if necessary
 */
const unlinkAsRoot = async (filePath) => {
  const { success, error, code } = await runSystemCommand(getScriptPath('wg-file-proxy.sh'), ['delete', filePath]);
  return { success, error, code };
};

/**
 * Read a directory with sudo if necessary (using ls)
 */
const readdirAsRoot = async (dirPath) => {
  const { success, stdout, error, code } = await runSystemCommand(getScriptPath('wg-file-proxy.sh'), ['list', dirPath]);
  return { success, stdout, error, code };
};

/**
 * Native FS Helpers (Performance & Security over Shell)
 */
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
  SUDO_ARGS
};


