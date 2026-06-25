const childProcess = require('child_process');
const fs = require('fs').promises;
const { getScriptPath } = require('./config');
const log = require('./logger');

// 🛡️ OBSIDIAN-HARDENING: Use direct module references for reliable mocking in tests.
// Promisify the module method directly so spies on the module are honored.
const execFilePromise = (cmd, args, opts) => {
  return new Promise((resolve, reject) => {
    childProcess.execFile(cmd, args, opts, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
};

const isRoot = !process.getuid || process.getuid() === 0;
const SUDO = isRoot ? null : process.env.SUDO_BIN || 'sudo';
const SUDO_ARGS = isRoot ? [] : ['-E', '-n'];

/* eslint-disable no-control-regex */
const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
/* eslint-enable no-control-regex */
const stripAnsi = (str) => (typeof str === 'string' ? str.replace(ANSI_RE, '') : str);

/**
 * Standardized Shell Command Wrapper
 * HARDENING: Binary existence check and structured logging
 */
const runCommand = async (cmd, args = [], stdinData = null) => {
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };

  // 🛡️ SRE-HARDENING: Strip ANSI colors from arguments to avoid SAFE_ARG violations
  const sanitizedArgs = args.map((arg) => stripAnsi(arg));
  const commandStr = `${cmd} ${sanitizedArgs.join(' ')}`;

  // Safe because spawn() never invokes a shell (args go directly to execvp).
  const SAFE_ARG = /^[\p{L}\p{N}\s\-_.,:@+/=~!'()%&#[\]=*?]*$/u;
  for (const arg of sanitizedArgs) {
    if (arg && !SAFE_ARG.test(arg)) {
      if (log && typeof log.error === 'function') {
        log.error('shell', `Unsafe character detected in command argument: "${arg}"`, {
          command: cmd,
        });
      }
      return { success: false, error: 'Unsafe command argument detected', code: 'EPERM_SAFE_EXEC' };
    }
  }

  // Safety check: binary existence and executability (only for absolute paths)
  if ((cmd.startsWith('/') || cmd.startsWith('./')) && process.env.NODE_ENV !== 'test') {
    try {
      const fsConst = require('fs').constants;
      await fs.access(cmd, fsConst.F_OK | fsConst.X_OK);
    } catch (e) {
      if (log && typeof log.error === 'function') {
        log.error('shell', `Command binary not found or not executable: ${cmd}`);
      }
      return { success: false, error: `Binary not accessible: ${cmd}`, code: 'EACCES_OR_ENOENT' };
    }
  }

  // 🧪 TEST BYPASS (Moved after hardening/binary checks to maximize coverage)
  if (global.TEST_MOCK_SHELL) {
    return { success: true, stdout: 'MOCKED_OUTPUT', stderr: '', code: 0 };
  }

  try {
    if (stdinData !== null) {
      return await new Promise((resolve) => {
        const proc = childProcess.spawn(cmd, sanitizedArgs, { timeout: 90000, env });
        let stdout = '',
          stderr = '';
        proc.stdout.on('data', (d) => {
          stdout += d.toString();
        });
        proc.stderr.on('data', (d) => {
          stderr += d.toString();
        });
        proc.on('close', (code) => {
          if (code === 0) {
            if (stderr && log && typeof log.warn === 'function')
              log.warn('shell', `"${commandStr}" produced stderr: ${stderr.trim()}`);
            resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
          } else {
            if (log && typeof log.error === 'function') {
              log.error('shell', `"${commandStr}" exited with code ${code}`, {
                stderr: stderr.trim(),
              });
            }
            resolve({ success: false, error: stderr.trim() || `Exit code ${code}`, code });
          }
        });
        proc.on('error', (err) => {
          if (log && typeof log.error === 'function') {
            log.error('shell', `"${commandStr}" failed to spawn: ${err.message}`);
          }
          resolve({ success: false, error: err.message, code: err.code });
        });
        if (proc.stdin) {
          proc.stdin.write(stdinData);
          proc.stdin.end();
        }
      });
    }

    const { stdout, stderr } = await execFilePromise(cmd, sanitizedArgs, {
      timeout: 90000,
      maxBuffer: 10 * 1024 * 1024,
      env,
    });
    if (stderr) log.warn('shell', `"${commandStr}" produced stderr: ${stderr.trim()}`);
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const errorMessage = error.stderr
      ? error.stderr.trim()
      : error.message || 'Unknown shell error';
    log.error('shell', `"${commandStr}" failed`, { error: errorMessage, code: error.code });
    return { success: false, error: errorMessage, code: error.code, stdout: error.stdout };
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
 */
const writeFileAsRoot = async (filePath, content) => {
  const { success, error, code } = await runSystemCommand(
    getScriptPath('wg-file-proxy.sh'),
    ['write', filePath],
    content
  );
  return { success, error, code };
};

const appendFileAsRoot = async (filePath, content) => {
  const { success, error, code } = await runSystemCommand(
    getScriptPath('wg-file-proxy.sh'),
    ['append', filePath],
    content
  );
  return { success, error, code };
};

const unlinkAsRoot = async (filePath) => {
  const { success, error, code } = await runSystemCommand(getScriptPath('wg-file-proxy.sh'), [
    'delete',
    filePath,
  ]);
  return { success, error, code };
};

const readdirAsRoot = async (dirPath) => {
  const { success, stdout, error, code } = await runSystemCommand(
    getScriptPath('wg-file-proxy.sh'),
    ['list', dirPath]
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
