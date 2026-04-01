require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const url = require('url');
const { spawn } = require('child_process');

// Internal Imports
const { auth } = require('./src/middleware/auth');
const { startJobs } = require('./src/services/jobs');
const { SUDO, SUDO_ARGS } = require('./src/services/shell');
const { getWireGuardStats, parseWireGuardDump } = require('./src/services/system');

// Route Imports
const authRoutes = require('./src/routes/auth');
const clientRoutes = require('./src/routes/clients');
const systemRoutes = require('./src/routes/system');
const ticketRoutes = require('./src/routes/tickets');
const userRoutes = require('./src/routes/users');
const sentinelRoutes = require('./src/routes/sentinel');
const { initializeDatabase } = require('./src/services/init');

const app = express();
const server = http.createServer(app);

// --- Middleware ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dashboard-ui/dist')));

// --- Security & Custom Metadata Headers ---
app.use((req, res, next) => {
    res.setHeader('X-WG-Shield-Version', '3.1.0-Platinum');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});


// Rate Limiting
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', globalLimiter);

// --- Public Routes ---
app.get('/api/install/status', (req, res) => res.json({ installed: true, version: '3.0.1 (Modular)' }));

// --- Protected Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes); // auth is handled inside clientRoutes
app.use('/api/system', systemRoutes);  // auth is handled inside systemRoutes
app.use('/api/tickets', ticketRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sentinel', sentinelRoutes);

// Compatibility Aliases for Dashboard
app.get('/api/health', async (req, res, next) => {
    const { getSystemStats, getInterfacePath } = require('./src/services/system');
    const { runSystemCommand } = require('./src/services/shell');
    const { getJobStatus } = require('./src/services/jobs');
    const fs = require('fs');
    const iface = process.env.WG_INTERFACE || 'wg0';
    const interfaceExists = fs.existsSync(getInterfacePath(iface));
    const { success } = await runSystemCommand(process.env.WG_BIN || 'wg', ['show', iface]).catch(() => ({ success: false }));
    const system = await getSystemStats();
    res.json({
        status: (interfaceExists && success && parseFloat(system.disk) < 95) ? 'healthy' : 'unhealthy',
        service: interfaceExists ? 'active' : 'inactive',
        interface: success ? 'up' : 'down',
        stats: system,
        jobs: getJobStatus(),
        version: '3.1.0-Platinum'
    });
});

app.get('/api/stats', auth, async (req, res, next) => {
    const { getWireGuardStats, getSystemStats, formatBytes } = require('./src/services/system');
    try {
        const peers = await getWireGuardStats();
        let totalRx = 0, totalTx = 0, connectedCount = 0;
        peers.forEach(peer => {
            totalRx += peer.rx || 0;
            totalTx += peer.tx || 0;
            if (peer.isOnline) connectedCount++;
        });
        const system = await getSystemStats();
        res.json({
            network: { totalDownload: formatBytes(totalRx), totalUpload: formatBytes(totalTx), connectedClients: connectedCount },
            system
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// BUG-FIX: 404 handler for unknown /api/* routes (must be before SPA catch-all)
// Without this, a missing API route silently returns the frontend HTML → impossible to debug.
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found', path: req.originalUrl });
});

// Root fallback to Dashboard (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dashboard-ui/dist/index.html'));
});

// --- WebSockets ---
const wssLogs = new WebSocketServer({ noServer: true });
const wssStatus = new WebSocketServer({ noServer: true });

wssLogs.on('connection', (ws, req) => {
    const type = url.parse(req.url).pathname.split('/')[3];
    let args = [];
    const JOURNALCTL_BIN = process.env.JOURNALCTL_BIN || 'journalctl';
    const WG_INTERFACE = process.env.WG_INTERFACE || 'wg0';

    if (type === 'wireguard') args = ['-u', `wg-quick@${WG_INTERFACE}`, '-f', '-n', '50', '--no-pager', '-o', 'short-iso'];
    else if (type === 'api') args = ['-u', 'wireguard-api', '-f', '-n', '50', '--no-pager', '-o', 'short-iso'];
    else { ws.close(); return; }

    const cmd = SUDO || JOURNALCTL_BIN;
    const spawnArgs = SUDO ? [...SUDO_ARGS, JOURNALCTL_BIN, ...args] : args;
    const journalProcess = spawn(cmd, spawnArgs);
    
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    journalProcess.stdout.on('data', (data) => {
        if (ws.readyState === ws.OPEN) ws.send(data.toString());
    });

    const cleanup = () => {
        if (journalProcess) {
            journalProcess.kill('SIGTERM');
            // Force kill if not dead after 2s
            setTimeout(() => { if (journalProcess.exitCode === null) journalProcess.kill('SIGKILL'); }, 2000);
        }
    };

    ws.on('close', cleanup);
    ws.on('error', (err) => {
        console.error(`[WS-ERR] ${type}:`, err.message);
        cleanup();
    });
});

// WS Heartbeat to prevent orphan processes
const wsInterval = setInterval(() => {
    wssLogs.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
    wssStatus.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wssLogs.on('error', (err) => console.error('[WSS-ERROR] Logs:', err));
wssStatus.on('error', (err) => console.error('[WSS-ERROR] Status:', err));

// BUG-FIX: clearInterval lié au server HTTP et non wssLogs.
// Si wssLogs se fermait (0 clients), le heartbeat de wssStatus était aussi annulé.
server.on('close', () => clearInterval(wsInterval));
// BUG-FIX: Interval réduit de 2s à 5s — évite de surcharger "wg show dump" en continu
// (le frontend poll déjà toutes les 5s, pas besoin de broadcast plus rapide)
setInterval(async () => {
    if (wssStatus.clients.size === 0) return; // Skip si aucun client connecté
    try {
        const peers = await getWireGuardStats();
        const onlinePeers = peers.filter(p => p.isOnline).map(p => p.publicKey);
        wssStatus.clients.forEach(c => c.readyState === 1 && c.send(JSON.stringify({ type: 'peer_status', onlinePeers })));
    } catch(e) {
        console.error('[AUDIT] WS status broadcast error:', e.message);
    }
}, 5000);

server.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;
    
    // Auth JWT sur les WebSockets (empêche les connexions non authentifiées)
    const token = request.headers['x-api-token'] || new URL(request.url, 'http://localhost').searchParams.get('token');
    if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }
    try {
        const jwt = require('jsonwebtoken');
        jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }

    if (pathname.startsWith('/api/logs-ws/')) {
        wssLogs.handleUpgrade(request, socket, head, ws => wssLogs.emit('connection', ws, request));
    } else if (pathname === '/api/status-ws') {
        wssStatus.handleUpgrade(request, socket, head, ws => wssStatus.emit('connection', ws, request));
    } else {
        socket.destroy();
    }
});

// --- Security & Metadata Middleware (must be before routes, applied via header hook) ---
// NOTE: These headers are set early in the pipeline. helmet() above handles most of them;
// we add custom headers here for all non-upgrade requests.

// --- Global Error Handling ---
app.use((err, req, res, next) => {
    const isProd = process.env.NODE_ENV === 'production';
    console.error(`[SENTINEL-ERROR] ${err.stack}`);
    res.status(err.status || 500).json({ 
        error: 'Service Error', 
        message: isProd ? 'An internal error occurred. Please contact support.' : err.message,
        code: err.code || 'INTERNAL_ERROR'
    });
});

// --- Startup ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', async () => {
    console.log('----------------------------------------------------');
    console.log(`🚀 WG-FUX API Modular running on port ${PORT}`);
    console.log(`🛠️ Mode: ${process.env.NODE_ENV || 'production'}`);
    console.log('----------------------------------------------------');
    
    try {
        await initializeDatabase();
        startJobs(); // Start background tasks
    } catch (err) {
        console.error('❌ FATAL: API failed to initialize database:', err);
        process.exit(1);
    }
});
