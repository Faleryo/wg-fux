/* eslint-disable no-empty */
/**
 * WG-FUX — Couche d'exécution (mode revendeur) : tests unitaires.
 *
 * Couvre :
 *   (a) resolveExecutor : local pour admin, ssh-via-pool pour reseller+serverId,
 *       throw NO_SERVER_SELECTED sans serverId, SERVER_NOT_FOUND si absent.
 *   (b) LocalExecutor.run : construit bien la commande sudo.
 *   (c) SshExecutor (Client ssh2 MOCKÉ) : propage stdin, capture exit code
 *       non-zero, encode le payload `wg-fux <base64>`, pose hostVerifier.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// Faux Client ssh2 injecté dans SshExecutor via son seam _setClientFactory
// (vi.mock n'intercepte pas require('ssh2') de façon fiable dans cette config).
// On garde la liste des instances créées pour les piloter depuis les tests.
// ---------------------------------------------------------------------------
const sshClients = [];

class FakeStream extends EventEmitter {
  constructor() {
    super();
    this.stderr = new EventEmitter();
    const self = this;
    this.stdin = {
      written: null,
      ended: false,
      write(d) {
        self.stdin.written = d;
      },
      end() {
        self.stdin.ended = true;
      },
    };
  }
}

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.connectConfig = null;
    this.ended = false;
    this.execImpl = null;
    this.lastCommand = null;
    sshClients.push(this);
  }
  connect(config) {
    this.connectConfig = config;
    setImmediate(() => this.emit('ready'));
  }
  exec(command, cb) {
    this.lastCommand = command;
    if (this.execImpl) return this.execImpl(command, cb, FakeStream);
    const stream = new FakeStream();
    cb(null, stream);
    setImmediate(() => {
      stream.emit('exit', 0);
      stream.emit('close', 0);
    });
    return stream;
  }
  end() {
    this.ended = true;
    this.emit('close');
  }
}

function lastClient() {
  return sshClients[sshClients.length - 1];
}

beforeEach(() => {
  sshClients.length = 0;
  vi.clearAllMocks();
});

// ===========================================================================
// (b) LocalExecutor
// ===========================================================================
describe('LocalExecutor', () => {
  // On espionne core.runCommand (LocalExecutor l'appelle via la référence module)
  // pour valider la construction exacte de la commande sudo, sans réellement spawn.
  const core = require('../src/services/shell-core');
  const localExecutor = require('../src/services/executors/local');

  it('construit la commande sudo (préfixe SUDO + SUDO_ARGS) et passe stdin', async () => {
    const spy = vi
      .spyOn(core, 'runCommand')
      .mockResolvedValue({ success: true, stdout: 'ok', stderr: '' });

    const res = await localExecutor.run('/usr/local/bin/wg-stats.sh', ['wg0'], 'STDIN');
    expect(res.success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    const [cmd, args, stdin] = spy.mock.calls[0];
    if (core.SUDO) {
      expect(cmd).toBe(core.SUDO);
      expect(args).toEqual([...core.SUDO_ARGS, '/usr/local/bin/wg-stats.sh', 'wg0']);
    } else {
      // process root : pas de préfixe sudo
      expect(cmd).toBe('/usr/local/bin/wg-stats.sh');
      expect(args).toEqual(['wg0']);
    }
    expect(stdin).toBe('STDIN');
    spy.mockRestore();
  });
});

// ===========================================================================
// (c) SshExecutor (ssh2 mocké)
// ===========================================================================
describe('SshExecutor', () => {
  const SshExecutor = require('../src/services/executors/ssh');

  beforeEach(() => {
    SshExecutor._setClientFactory(FakeClient);
  });

  function newExec() {
    return new SshExecutor({ host: '10.0.0.9', port: 22, username: 'wg-fux', privateKey: 'KEY' });
  }

  it('encode le payload `wg-fux <base64>` (basename + JSON) et réussit', async () => {
    const exec = newExec();
    const res = await exec.run('/usr/local/bin/wg-create-client.sh', ['acme', 'iphone']);

    expect(res).toEqual({ success: true, stdout: '', stderr: '' });

    const expectedPayload = Buffer.from(
      JSON.stringify(['wg-create-client.sh', 'acme', 'iphone'])
    ).toString('base64');
    expect(lastClient().lastCommand).toBe(`wg-fux ${expectedPayload}`);
    exec._close();
  });

  it('propage stdin sur le canal exec', async () => {
    const exec = newExec();
    let capturedStream = null;
    // Connexion préalable pour pouvoir injecter execImpl AVANT le run (pas de race).
    await exec._ensureConnected();
    lastClient().execImpl = (command, cb, FakeStream) => {
      const stream = new FakeStream();
      capturedStream = stream;
      cb(null, stream);
      setImmediate(() => {
        stream.emit('exit', 0);
        stream.emit('close', 0);
      });
    };
    const res = await exec.run('wg-file-proxy.sh', ['write', '/etc/x'], 'FILE_CONTENT');
    expect(res.success).toBe(true);
    expect(capturedStream).not.toBeNull();
    expect(capturedStream.stdin.written).toBe('FILE_CONTENT');
    expect(capturedStream.stdin.ended).toBe(true);
    exec._close();
  });

  it('capture un exit code non-zero → success:false', async () => {
    const exec = newExec();
    await exec._ensureConnected();
    lastClient().execImpl = (command, cb, FakeStream) => {
      const stream = new FakeStream();
      cb(null, stream);
      setImmediate(() => {
        stream.stderr.emit('data', Buffer.from('boom'));
        stream.emit('exit', 2);
        stream.emit('close', 2);
      });
    };
    const res = await exec.run('wg-stats.sh', []);
    expect(res.success).toBe(false);
    expect(res.code).toBe(2);
    expect(res.error).toBe('boom');
    exec._close();
  });

  it('pose un hostVerifier qui accepte une host key correspondante', async () => {
    const exec = new SshExecutor({
      host: '10.0.0.9',
      username: 'wg-fux',
      privateKey: 'KEY',
      hostKey: 'AAAAC3NzaC1lZDI1NTE5AAAAIabc',
    });
    await exec.run('wg-health.sh', []);
    const cfg = lastClient().connectConfig;
    expect(typeof cfg.hostVerifier).toBe('function');
    expect(cfg.hostVerifier(Buffer.from('AAAAC3NzaC1lZDI1NTE5AAAAIabc', 'base64'))).toBe(true);
    // une clé différente est refusée
    expect(cfg.hostVerifier(Buffer.from('autrecle', 'utf8'))).toBe(false);
    exec._close();
  });
});

// ===========================================================================
// (a) resolveExecutor + pool
// ===========================================================================
describe('resolveExecutor', () => {
  it('retourne le LocalExecutor singleton pour admin', async () => {
    const { resolveExecutor } = require('../src/services/executors');
    const localExecutor = require('../src/services/executors/local');
    const res = await resolveExecutor({ user: { role: 'admin', id: 1 } });
    expect(res).toBe(localExecutor);
  });

  it('retourne le LocalExecutor pour manager et sans user', async () => {
    const { resolveExecutor } = require('../src/services/executors');
    const localExecutor = require('../src/services/executors/local');
    expect(await resolveExecutor({ user: { role: 'manager', id: 2 } })).toBe(localExecutor);
    expect(await resolveExecutor({})).toBe(localExecutor);
  });

  it('retourne le LocalExecutor pour un revendeur sans serverId (pivot instance complète)', async () => {
    const { resolveExecutor } = require('../src/services/executors');
    const localExecutor = require('../src/services/executors/local');
    expect(await resolveExecutor({ user: { role: 'reseller', id: 42 } })).toBe(localExecutor);
  });

  it('retourne un SshExecutor (via pool) pour un revendeur avec serverId + cache hit', async () => {
    const executorsMod = require('../src/services/executors');
    const SshExecutor = require('../src/services/executors/ssh');
    const dbMod = require('../db');
    const cryptoMod = require('../src/services/crypto');

    vi.spyOn(cryptoMod, 'decryptPrivateKey').mockReturnValue('PRIVATE_KEY_PEM');

    const fakeServer = {
      id: 17,
      host: '203.0.113.5',
      port: 22,
      sshUsername: 'wg-fux',
      hostKey: 'AAAA',
    };
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve([fakeServer]),
    };
    vi.spyOn(dbMod.db, 'select').mockReturnValue(chain);

    const res = await executorsMod.resolveExecutor({
      user: { role: 'reseller', id: 42 },
      serverId: 17,
    });
    expect(res).toBeInstanceOf(SshExecutor);
    expect(res.host).toBe('203.0.113.5');
    expect(res.privateKey).toBe('PRIVATE_KEY_PEM');

    // 2e appel = cache hit (même instance, pas de nouveau select)
    dbMod.db.select.mockClear();
    const res2 = await executorsMod.resolveExecutor({
      user: { role: 'reseller', id: 42 },
      serverId: 17,
    });
    expect(res2).toBe(res);
    expect(dbMod.db.select).not.toHaveBeenCalled();

    executorsMod._sshPool.clear();
    vi.restoreAllMocks();
  });

  it('throw SERVER_NOT_FOUND si le serveur est absent', async () => {
    const executorsMod = require('../src/services/executors');
    const dbMod = require('../db');
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve([]),
    };
    vi.spyOn(dbMod.db, 'select').mockReturnValue(chain);

    await expect(
      executorsMod.resolveExecutor({ user: { role: 'reseller', id: 42 }, serverId: 999 })
    ).rejects.toMatchObject({ code: 'SERVER_NOT_FOUND' });

    executorsMod._sshPool.clear();
    vi.restoreAllMocks();
  });
});
