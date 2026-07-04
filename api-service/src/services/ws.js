const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { existsSync } = require('fs');
const log = require('./logger');
const { getWireGuardStats } = require('./system');
const { runSystemCommand } = require('./shell');

class WebSocketService {
  constructor() {
    this.wssLogs = new WebSocketServer({ noServer: true });
    this.wssStatus = new WebSocketServer({ noServer: true });
    this.wsInterval = null;
    this.broadcastInterval = null;
    this.activeTailProcesses = 0;
    this.maxTailProcesses = 10;
  }

  init(server) {
    this.setupHandlers();
    this.setupUpgrade(server);
    this.startHeartbeat();
    this.startBroadcast();
    log.info('ws', 'WebSocket Service Initialized');
  }

  setupHandlers() {
    this.wssLogs.on('connection', (ws, req) => {
      const type = new URL(req.url, 'http://localhost').pathname.split('/')?.[3];
      const WG_INTERFACE = process.env.WG_INTERFACE || 'wg0';

      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      if (type === 'api') {
        let lastSentTs = 0;
        const interval = setInterval(() => {
          if (ws.readyState !== ws.OPEN) {
            clearInterval(interval);
            return;
          }
          const entries = log.getBuffer(null);
          const newEntries = entries.filter((e) => new Date(e.ts).getTime() > lastSentTs);
          if (newEntries.length > 0) {
            lastSentTs = Math.max(...newEntries.map((e) => new Date(e.ts).getTime()));
            newEntries.reverse().forEach((e) => ws.send(JSON.stringify(e)));
          }
        }, 2000);
        ws.on('close', () => clearInterval(interval));
        ws.on('error', () => clearInterval(interval));
        return;
      }

      if (type === 'wireguard') {
        const logCandidates = ['/var/log/kern.log', '/var/log/syslog'];
        const logFile = logCandidates.find((f) => existsSync(f));

        if (logFile) {
          if (this.activeTailProcesses >= this.maxTailProcesses) {
            ws.send('[WARN] Maximum concurrent log streams reached. Please try again later.');
            ws.close();
            return;
          }
          this.activeTailProcesses++;
          const proc = spawn('/usr/bin/tail', ['-f', '-n', '50', logFile]);
          let tailCleaned = false;
          const cleanup = () => {
            if (tailCleaned) return;
            tailCleaned = true;
            this.activeTailProcesses = Math.max(0, this.activeTailProcesses - 1);
            try {
              proc.kill('SIGTERM');
            } catch (ignore) {
              /* Process might already be dead */
            }
          };
          proc.on('error', (err) => {
            log.error('ws', 'Failed to spawn tail process', { error: err.message });
            cleanup();
          });
          proc.stdout.on('data', (data) => {
            if (ws.readyState === ws.OPEN) ws.send(data.toString());
          });
          proc.on('exit', cleanup);
          ws.on('close', cleanup);
          ws.on('error', cleanup);
        } else {
          if (ws.readyState === ws.OPEN)
            ws.send('[INFO] Log files not available in container. Streaming wg show output...');
          const interval = setInterval(async () => {
            if (ws.readyState !== ws.OPEN) {
              clearInterval(interval);
              return;
            }
            const result = await runSystemCommand('wg', ['show', WG_INTERFACE]).catch(() => ({
              success: false,
              stdout: '',
            }));
            if (result.success && result.stdout) ws.send(result.stdout);
          }, 5000);
          ws.on('close', () => clearInterval(interval));
          ws.on('error', () => clearInterval(interval));
        }
        return;
      }
      ws.close();
    });

    this.wssStatus.on('connection', (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
    });

    this.wssLogs.on('error', (err) => log.error('ws', 'WSS Logs error', { err: err.message }));
    this.wssStatus.on('error', (err) => log.error('ws', 'WSS Status error', { err: err.message }));
  }

  setupUpgrade(server) {
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const wsProtocol = request.headers['sec-websocket-protocol'];
      const token =
        request.headers['x-api-token'] || (Array.isArray(wsProtocol) ? wsProtocol[0] : wsProtocol);

      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // 🛡️ Sentinel Watchdog bypass (internal agent) — timing-safe comparison
      const sentinelToken = (process.env.SENTINEL_TOKEN || '').replace(/['"]/g, '').trim();
      const receivedToken = String(token || '')
        .replace(/['"]/g, '')
        .trim();
      let isSentinel = false;
      if (sentinelToken && receivedToken) {
        const sBuf = Buffer.from(sentinelToken);
        const rBuf = Buffer.from(receivedToken);
        isSentinel = sBuf.length === rBuf.length && crypto.timingSafeEqual(sBuf, rBuf);
      }
      if (isSentinel) {
        request.user = { id: 0, role: 'admin', username: 'sentinel-watchdog', internal: true };
      } else {
        try {
          const decoded = jwt.verify(String(token), process.env.JWT_SECRET, { algorithms: ['HS256'] });
          request.user = decoded;
        } catch (e) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      if (pathname.startsWith('/api/logs-ws/')) {
        this.wssLogs.handleUpgrade(request, socket, head, (ws) => {
          ws.username = request.user?.username;
          this.wssLogs.emit('connection', ws, request);
        });
      } else if (pathname === '/api/status-ws') {
        this.wssStatus.handleUpgrade(request, socket, head, (ws) => {
          ws.username = request.user?.username; // Store identity
          this.wssStatus.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });
  }

  startHeartbeat() {
    this.wsInterval = setInterval(() => {
      try {
        [this.wssLogs, this.wssStatus].forEach((wss) => {
          wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
              try {
                ws.terminate();
              } catch (e) {
                /* ignore */
              }
              return;
            }
            ws.isAlive = false;
            try {
              ws.ping();
            } catch (e) {
              /* ignore */
            }
          });
        });
      } catch (e) {
        log.error('ws', 'Heartbeat error', { err: e.message });
      }
    }, 30000);
  }

  startBroadcast() {
    // Détection de déconnexion QUASI-INSTANTANÉE : le seuil handshake de
    // wg-stats.sh (180 s) est trop lent pour l'UI. Les clients ont
    // PersistentKeepalive=15 → un peer connecté fait bouger ses compteurs rx
    // au moins toutes les 15 s. On suit donc l'ACTIVITÉ réelle : un peer sans
    // aucun octet reçu depuis ACTIVITY_WINDOW_MS est affiché hors-ligne
    // (≤ ~40 s après la coupure, au lieu de 3 min).
    const ACTIVITY_WINDOW_MS = 40 * 1000;
    this._peerActivity = new Map(); // publicKey → { rx, lastChange }
    this.broadcastInterval = setInterval(async () => {
      if (this.wssStatus.clients.size === 0) return;
      try {
        const peers = await getWireGuardStats();
        const now = Date.now();
        const seen = new Set();
        const onlinePeers = [];
        for (const p of peers) {
          seen.add(p.publicKey);
          const prev = this._peerActivity.get(p.publicKey);
          const rx = Number(p.rx) || 0;
          if (!prev || rx !== prev.rx) {
            this._peerActivity.set(p.publicKey, { rx, lastChange: now });
          }
          const { lastChange } = this._peerActivity.get(p.publicKey);
          // Online = seuil handshake classique ET activité récente.
          // (1er passage après boot : lastChange=now → on suit le handshake.)
          if (p.isOnline && now - lastChange < ACTIVITY_WINDOW_MS) {
            onlinePeers.push(p.publicKey);
          }
        }
        // Purge des peers disparus (clients supprimés) pour borner la Map.
        for (const key of this._peerActivity.keys()) {
          if (!seen.has(key)) this._peerActivity.delete(key);
        }
        this.wssStatus.clients.forEach(
          (c) => c.readyState === 1 && c.send(JSON.stringify({ type: 'peer_status', onlinePeers }))
        );
      } catch (e) {
        log.error('ws', 'WS status broadcast error', { err: e.message });
      }
    }, 5000);
  }

  sendToUser(username, type, payload) {
    const message = JSON.stringify({ type, data: payload });
    if (!username) return;
    [this.wssLogs, this.wssStatus].forEach((wss) => {
      wss.clients.forEach((client) => {
        if (client.readyState === 1 && client.username === username) {
          try {
            client.send(message);
          } catch (e) {
            /* ignore */
          }
        }
      });
    });
  }

  shutdown() {
    clearInterval(this.wsInterval);
    clearInterval(this.broadcastInterval);
    // wss.close() only stops accepting new connections — it does NOT terminate
    // already-open client sockets, so their per-connection intervals and any
    // spawned `tail` child processes would otherwise survive as orphans past
    // process exit. Terminate every client first so their 'close' handlers
    // (which clearInterval/kill the tail process) run before shutdown.
    [this.wssLogs, this.wssStatus].forEach((wss) => {
      wss.clients.forEach((ws) => {
        try {
          ws.terminate();
        } catch (e) {
          /* ignore */
        }
      });
    });
    this.wssLogs.close();
    this.wssStatus.close();
  }
}

module.exports = new WebSocketService();
