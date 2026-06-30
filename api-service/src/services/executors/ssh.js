// services/executors/ssh.js — Exécution DISTANTE via SSH (lib ssh2).
//
// Maintient UNE connexion SSH persistante par instance (lazy connect, réutilisée
// entre appels, reconnexion transparente si la connexion meurt).
//
// Protocole d'invocation (doit matcher core-vpn/scripts/wg-fux-dispatch.sh) :
//   commande SSH = `wg-fux <base64>` où
//   <base64> = Buffer.from(JSON.stringify([file, ...args])).toString('base64')
// Le dispatcher distant (forced command) décode le JSON et élève via sudo.
// On NE préfixe PAS par sudo et on NE construit PAS de ligne shell : aucune
// interprétation shell des arguments → zéro injection.

const path = require('path');
const ssh2 = require('ssh2');
const BaseExecutor = require('./base');
const { stripAnsi } = require('../shell-core');
const log = require('../logger');

const READY_TIMEOUT_MS = 15000; // connexion SSH
const COMMAND_TIMEOUT_MS = 90000; // exécution d'une commande (cohérent avec le local)

// Fabrique du Client ssh2. Indirection minimale : permet aux tests d'injecter
// un Client mocké (vi.mock n'intercepte pas require('ssh2') de façon fiable ici).
// En production, c'est toujours le vrai ssh2.Client.
let _ClientFactory = ssh2.Client;
function _setClientFactory(factory) {
  _ClientFactory = factory || ssh2.Client;
}

class SshExecutor extends BaseExecutor {
  constructor({ host, port = 22, username, privateKey, hostKey }) {
    super();
    this.host = host;
    this.port = port || 22;
    this.username = username;
    this.privateKey = privateKey;
    // host key attendue (anti-MITM). Forme : base64 de la clé publique brute du
    // serveur, OU ligne known_hosts "ssh-ed25519 AAAA...". On compare la partie base64.
    this.hostKey = hostKey || null;

    this.conn = null; // Client ssh2 courant (null = déconnecté)
    this.connPromise = null; // promesse de connexion en cours (dédoublonnage)
  }

  /**
   * Garantit une connexion vivante. Réutilise la connexion existante, sinon
   * (re)connecte. Dédoublonne les connexions concurrentes via connPromise.
   */
  async _ensureConnected() {
    if (this.conn) return this.conn;
    if (this.connPromise) return this.connPromise;
    this.connPromise = this._connect()
      .then((conn) => {
        this.conn = conn;
        this.connPromise = null;
        return conn;
      })
      .catch((err) => {
        this.connPromise = null;
        throw err;
      });
    return this.connPromise;
  }

  _connect() {
    return new Promise((resolve, reject) => {
      const conn = new _ClientFactory();
      let settled = false;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        fn(arg);
      };

      conn.on('ready', () => done(resolve, conn));
      conn.on('error', (err) => {
        // Connexion morte → on la jette pour forcer une reconnexion au prochain run.
        if (this.conn === conn) this.conn = null;
        done(reject, err);
      });
      conn.on('close', () => {
        if (this.conn === conn) this.conn = null;
      });
      conn.on('end', () => {
        if (this.conn === conn) this.conn = null;
      });

      const config = {
        host: this.host,
        port: this.port,
        username: this.username,
        privateKey: this.privateKey,
        readyTimeout: READY_TIMEOUT_MS,
      };

      // Vérification stricte de la host key (anti-MITM). hostVerifier reçoit la
      // clé publique brute du serveur (Buffer) puisqu'on ne fixe pas hostHash.
      if (this.hostKey) {
        config.hostVerifier = (key) => {
          const presented = Buffer.isBuffer(key) ? key.toString('base64') : String(key);
          if (!this._hostKeyMatches(presented)) {
            log.error('ssh', `Host key mismatch pour ${this.host} — connexion refusée (MITM ?)`);
            return false; // refuse le handshake
          }
          return true;
        };
      }

      try {
        conn.connect(config);
      } catch (err) {
        done(reject, err);
      }
    });
  }

  /**
   * Compare la host key présentée (base64 brut) à celle attendue. Tolère que
   * this.hostKey soit une ligne known_hosts ("ssh-ed25519 AAAA... commentaire")
   * ou directement la base64 de la clé.
   */
  _hostKeyMatches(presentedB64) {
    const expected = this.hostKey.trim();
    if (expected === presentedB64) return true;
    // Forme known_hosts : on extrait le champ base64 (2e token s'il y a un type).
    const parts = expected.split(/\s+/);
    for (const p of parts) {
      if (p === presentedB64) return true;
    }
    return false;
  }

  async run(file, args = [], stdinData = null) {
    // file peut être un chemin absolu (getScriptPath) — le dispatcher distant
    // exige un BASENAME pur. On extrait donc le basename.
    const scriptName = path.basename(file);
    const payload = Buffer.from(JSON.stringify([scriptName, ...args])).toString('base64');
    const command = `wg-fux ${payload}`;

    try {
      const conn = await this._ensureConnected();
      return await this._exec(conn, command, stdinData);
    } catch (err) {
      // Connexion morte (ECONNRESET / fin) → on tente UNE reconnexion transparente.
      if (this._isConnectionError(err)) {
        this._close();
        try {
          const conn = await this._ensureConnected();
          return await this._exec(conn, command, stdinData);
        } catch (err2) {
          log.error('ssh', `Échec SSH (après reconnexion) vers ${this.host}: ${err2.message}`);
          return { success: false, error: err2.message, code: err2.code || 'ESSH' };
        }
      }
      log.error('ssh', `Échec SSH vers ${this.host}: ${err.message}`);
      return { success: false, error: err.message, code: err.code || 'ESSH' };
    }
  }

  _isConnectionError(err) {
    const c = err && err.code;
    return (
      c === 'ECONNRESET' ||
      c === 'EPIPE' ||
      c === 'ETIMEDOUT' ||
      c === 'ECONNREFUSED' ||
      /not connected|closed|ended/i.test((err && err.message) || '')
    );
  }

  _exec(conn, command, stdinData) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        log.error(
          'ssh',
          `Commande SSH "${command}" expirée (${COMMAND_TIMEOUT_MS}ms) sur ${this.host}`
        );
        settle({ success: false, error: 'Command timed out', code: 'ETIMEDOUT' });
      }, COMMAND_TIMEOUT_MS);

      conn.exec(command, (err, stream) => {
        if (err) {
          settle({ success: false, error: err.message, code: err.code || 'ESSH' });
          return;
        }
        let stdout = '';
        let stderr = '';
        let exitCode = null;

        stream.on('data', (d) => {
          stdout += d.toString();
        });
        stream.stderr.on('data', (d) => {
          stderr += d.toString();
        });
        stream.on('exit', (code) => {
          exitCode = code;
        });
        stream.on('close', (code) => {
          const finalCode = code != null ? code : exitCode;
          const outClean = stripAnsi(stdout).trim();
          const errClean = stripAnsi(stderr).trim();
          if (finalCode === 0) {
            if (errClean) log.warn('ssh', `"${command}" stderr: ${errClean}`);
            settle({ success: true, stdout: outClean, stderr: errClean });
          } else {
            log.error('ssh', `"${command}" exit ${finalCode} sur ${this.host}`, {
              stderr: errClean,
            });
            settle({
              success: false,
              error: errClean || `Exit code ${finalCode}`,
              code: finalCode,
            });
          }
        });

        if (stdinData !== null && stdinData !== undefined) {
          stream.stdin.write(stdinData);
          stream.stdin.end();
        }
      });
    });
  }

  /**
   * Ferme la connexion (utilisé par le pool à l'éviction).
   */
  _close() {
    if (this.conn) {
      try {
        this.conn.end();
      } catch {
        /* ignore */
      }
      this.conn = null;
    }
    this.connPromise = null;
  }
}

module.exports = SshExecutor;
// Seam de test uniquement : injecter un Client mocké.
module.exports._setClientFactory = _setClientFactory;
