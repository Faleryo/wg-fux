const { WebSocketServer } = require('ws');
const url = require('url');
const jwt = require('jsonwebtoken');
const { spawn } = require('child_process');
const { existsSync } = require('fs');
const log = require('./logger');
const { getWireGuardStats } = require('./system');

class WebSocketService {
  constructor() {
    this.wssLogs = new WebSocketServer({ noServer: true });
    this.wssStatus = new WebSocketServer({ noServer: true });
    this.wsInterval = null;
    this.broadcastInterval = null;
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
      const type = url.parse(req.url).pathname.split('/')?.[3];
      const WG_INTERFACE = process.env.WG_INTERFACE || 'wg0';

      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      if (type === 'api') {
        let lastSent = 0;
        const interval = setInterval(() => {
          if (ws.readyState !== ws.OPEN) { clearInterval(interval); return; }
          const entries = log.getBuffer(null, 50);
          const newEntries = entries.slice(lastSent);
          if (newEntries.length > 0) {
            lastSent = entries.length;
            newEntries.forEach(e => ws.send(JSON.stringify(e)));
          }
        }, 2000);
        ws.on('close', () => clearInterval(interval));
        ws.on('error', () => clearInterval(interval));
        return;
      }

      if (type === 'wireguard') {
        const logCandidates = ['/var/log/kern.log', '/var/log/syslog'];
        const logFile = logCandidates.find(f => existsSync(f));

        if (logFile) {
          const proc = spawn('tail', ['-f', '-n', '50', logFile]);
          proc.stdout.on('data', (data) => {
            if (ws.readyState === ws.OPEN) ws.send(data.toString());
          });
          const cleanup = () => { try { proc.kill('SIGTERM'); } catch(e) { } };
          ws.on('close', cleanup);
          ws.on('error', (err) => { cleanup(); });
        } else {
          if (ws.readyState === ws.OPEN) ws.send('[INFO] journalctl not available in container. Streaming wg show output...');
          const interval = setInterval(async () => {
            if (ws.readyState !== ws.OPEN) { clearInterval(interval); return; }
            const { success, output } = await new Promise(resolve => {
              const p = spawn('wg', ['show', WG_INTERFACE]);
              let out = '';
              p.stdout.on('data', d => { out += d.toString(); });
              p.on('close', code => resolve({ success: code === 0, output: out }));
              p.on('error', () => resolve({ success: false, output: '' }));
            });
            if (success && output) ws.send(output);
          }, 5000);
          ws.on('close', () => clearInterval(interval));
          ws.on('error', () => clearInterval(interval));
        }
        return;
      }
      ws.close();
    });

    this.wssLogs.on('error', (err) => log.error('ws', 'WSS Logs error', { err: err.message }));
    this.wssStatus.on('error', (err) => log.error('ws', 'WSS Status error', { err: err.message }));
  }

  setupUpgrade(server) {
    server.on('upgrade', (request, socket, head) => {
      const pathname = url.parse(request.url).pathname;
      const token = request.headers['x-api-token'] || new URL(request.url, 'http://localhost').searchParams.get('token');
      
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      try {
        jwt.verify(token, process.env.JWT_SECRET);
      } catch (e) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      if (pathname.startsWith('/api/logs-ws/')) {
        this.wssLogs.handleUpgrade(request, socket, head, ws => this.wssLogs.emit('connection', ws, request));
      } else if (pathname === '/api/status-ws') {
        this.wssStatus.handleUpgrade(request, socket, head, ws => this.wssStatus.emit('connection', ws, request));
      } else {
        socket.destroy();
      }
    });
  }

  startHeartbeat() {
    this.wsInterval = setInterval(() => {
      [this.wssLogs, this.wssStatus].forEach(wss => {
        wss.clients.forEach((ws) => {
          if (ws.isAlive === false) return ws.terminate();
          ws.isAlive = false;
          ws.ping();
        });
      });
    }, 30000);
  }

  startBroadcast() {
    this.broadcastInterval = setInterval(async () => {
      if (this.wssStatus.clients.size === 0) return;
      try {
        const peers = await getWireGuardStats();
        const onlinePeers = peers.filter(p => p.isOnline).map(p => p.publicKey);
        this.wssStatus.clients.forEach(c => c.readyState === 1 && c.send(JSON.stringify({ type: 'peer_status', onlinePeers })));
      } catch(e) {
        log.error('ws', 'WS status broadcast error', { err: e.message });
      }
    }, 5000);
  }

  shutdown() {
    clearInterval(this.wsInterval);
    clearInterval(this.broadcastInterval);
    this.wssLogs.close();
    this.wssStatus.close();
  }
}

module.exports = new WebSocketService();
