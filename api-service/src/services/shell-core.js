// services/shell-core.js — Cœur d'exécution de commandes système, partagé.
//
// Extraction PURE depuis shell.js (aucune modification de logique) :
//   runCommand, la regex SAFE_ARG, stripAnsi, ANSI_RE, SUDO, SUDO_ARGS,
//   le check d'existence de binaire et execFilePromise.
//
// Ce module est consommé par :
//   - services/shell.js          (façade rétrocompatible)
//   - services/executors/local.js (exécution locale sudo)
//   - services/executors/ssh.js  (réutilise stripAnsi)
//
// Carte complète de la chaîne (routes → executors → ici/SSH) :
// voir le commentaire en tête de services/executors/index.js.

const childProcess = require('child_process');
const fs = require('fs').promises;
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
  // \p{So} covers emoji (Symbol, Other) — safe since no shell metachar lives in that Unicode category.
  // * and ? are shell glob chars — they have no legitimate place in execFile args
  const SAFE_ARG = /^[\p{L}\p{N}\p{So}\s\-_.,:@+/=~!'()%&#[\]]*$/u;
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
  // Function form lets an individual test simulate a failure (e.g. a disk
  // write that must fail so a refund-on-failure invariant can be exercised)
  // without touching real sudo/wg-*.sh — see tests/reseller-workspace.test.js.
  if (global.TEST_MOCK_SHELL) {
    if (typeof global.TEST_MOCK_SHELL === 'function') {
      return global.TEST_MOCK_SHELL(cmd, sanitizedArgs, stdinData);
    }
    return { success: true, stdout: 'MOCKED_OUTPUT', stderr: '', code: 0 };
  }

  try {
    if (stdinData !== null) {
      return await new Promise((resolve) => {
        // Note: spawn() ignores the 'timeout' option — implement manually
        const proc = childProcess.spawn(cmd, sanitizedArgs, { env });
        let stdout = '',
          stderr = '',
          settled = false;
        const settle = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(killTimer);
          resolve(result);
        };
        const killTimer = setTimeout(() => {
          if (!settled) {
            proc.kill('SIGTERM');
            if (log && typeof log.error === 'function') {
              log.error('shell', `"${commandStr}" killed after 90s timeout`);
            }
            settle({ success: false, error: 'Command timed out', code: 'ETIMEDOUT' });
          }
        }, 90000);
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
            settle({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
          } else {
            if (log && typeof log.error === 'function') {
              log.error('shell', `"${commandStr}" exited with code ${code}`, {
                stderr: stderr.trim(),
              });
            }
            settle({ success: false, error: stderr.trim() || `Exit code ${code}`, code });
          }
        });
        proc.on('error', (err) => {
          if (log && typeof log.error === 'function') {
            log.error('shell', `"${commandStr}" failed to spawn: ${err.message}`);
          }
          settle({ success: false, error: err.message, code: err.code });
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

module.exports = {
  runCommand,
  execFilePromise,
  stripAnsi,
  ANSI_RE,
  SUDO,
  SUDO_ARGS,
};
