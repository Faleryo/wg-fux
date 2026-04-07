require('dotenv').config();
const express = require('express');
const http = require('http');

const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { spawn } = require('child_process');
const wsService = require('./src/services/ws');

// Internal Imports
const { auth, requireAdmin } = require('./src/middleware/auth');
const { startJobs } = require('./src/services/jobs');
const { getWireGuardStats, checkScripts } = require('./src/services/system');
const log = require('./src/services/logger');

// Vibe-OS v6.3: Global Headers
const vibeHeaders = (req, res, next) => {
  res.set('X-Powered-By', 'Vibe-OS v6.3 (Watcher)');
  next();
};

// Route Imports
const authRoutes = require('./src/routes/auth');
const clientRoutes = require('./src/routes/clients');
const systemRoutes = require('./src/routes/system');
const ticketRoutes = require('./src/routes/tickets');
const userRoutes = require('./src/routes/users');

const sentinelRoutes = require('./src/routes/sentinel');
const dnsRoutes = require('./src/routes/dns');
const { initializeDatabase } = require('./src/services/init');

const app = express();
app.set('trust proxy', 1); // Trust first-hop proxy (Nginx) for rate-limiting

const server = http.createServer(app);

// --- Middleware ---
app.use(helmet({ contentSecurityPolicy: false }));

// CRITICAL-1 : CORS strict — ALLOWED_ORIGINS obligatoire en production
const isProd = process.env.NODE_ENV === 'production';
const rawOrigins = process.env.ALLOWED_ORIGINS;
if (isProd && (!rawOrigins || rawOrigins.trim() === '*' || rawOrigins.trim() === '')) {
  console.error('❌ FATAL: ALLOWED_ORIGINS is not set or is wildcard in production mode.');
  console.error('❌ Set ALLOWED_ORIGINS=https://your-domain.com in your .env file.');
  process.exit(1);
}
const corsOrigin = rawOrigins ? rawOrigins.split(',').map(o => o.trim()) : '*';
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Token']
}));
app.use(vibeHeaders);
app.use(express.json());

// Structured HTTP Request Logger (remplace console.log manuel)
app.use(log.requestMiddleware);

// --- Security & Custom Metadata Headers (Cleaned Wave 3) ---
app.use((req, res, next) => {
  // Custom header for versioning only, standard security headers are handled by Nginx proxy
  res.setHeader('X-WG-Shield-Version', '3.1.0-Platinum');
  next();
});


// Rate Limiting : Global protection for all API endpoints
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // Sufficient for 1-second telemetry polling (500req/15min max per client)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.', code: 'RATE_LIMIT_EXCEEDED' }
});
app.use('/api/', globalLimiter);

// WARN-1 : Rate limiter strict sur /auth/login (anti-bruteforce credentials)
// 10 tentatives par 15 minutes par IP — conforme aux recommandations OWASP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Ne compte que les échecs
  message: { error: 'Too many login attempts. Try again in 15 minutes.', code: 'AUTH_RATE_LIMIT' }
});
app.use('/api/auth/login', authLimiter);

// --- Public Routes ---
app.get('/api/install/status', (req, res) => res.json({ installed: true, version: '3.0.1 (Modular)' }));
app.get('/api/health', async (req, res) => {
  const scriptsOk = await checkScripts();
  res.json({ 
    status: scriptsOk ? 'healthy' : 'degraded', 
    version: '3.1.0-Platinum',
    uptime: process.uptime(),
    sre: { watcher: 'v6.3', scripts: scriptsOk ? 'ok' : 'fail' }
  });
});

// --- Auth Routes (contains both public /login and protected /check) ---
app.use('/api/auth', authRoutes);

// --- Protected Routes (Global Auth applied at mount point) ---
app.use('/api/clients', auth, clientRoutes);
app.use('/api/system', auth, systemRoutes);
app.use('/api/tickets', auth, ticketRoutes);
app.use('/api/users', auth, requireAdmin, userRoutes);
app.use('/api/sentinel', auth, sentinelRoutes);
app.use('/api/dns', auth, requireAdmin, dnsRoutes);



// ─── Debug Route (admin only) ─────────────────────────────────────────────────
// GET /api/debug            → rapport de santé complet
// GET /api/debug/logs       → circular buffer des 200 derniers logs
// GET /api/debug/logs?level=ERROR&limit=50
app.get('/api/debug', auth, requireAdmin, (req, res) => {
  const os = require('os');
  const logCounters = log.getCounters();
  const osMem = os.totalmem();
  const freeMem = os.freemem();
  res.json({
    timestamp: new Date().toISOString(),
    uptime_s: Math.floor(process.uptime()),
    node_version: process.version,
    env: process.env.NODE_ENV || 'production',
    log_level: process.env.LOG_LEVEL || 'INFO',
    log_format: process.env.LOG_FORMAT || 'json',
    memory: {
      heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1048576),
      heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1048576),
      rss_mb: Math.round(process.memoryUsage().rss / 1048576),
      os_free_mb: Math.round(freeMem / 1048576),
      os_total_mb: Math.round(osMem / 1048576),
      os_used_pct: Math.round((1 - freeMem / osMem) * 100)
    },
    cpu_load: os.loadavg(),
    log_counters: logCounters,
    routes_registered: app._router?.stack?.filter(r => r.route).length || 'unknown',
  });
});

app.get('/api/debug/logs', auth, requireAdmin, (req, res) => {
  const level = req.query.level?.toUpperCase() || null;
  const limit = Math.min(200, parseInt(req.query.limit) || 100);
  const since = req.query.since ? new Date(req.query.since) : null;
  let entries = log.getBuffer(level, limit);
  if (since) entries = entries.filter(e => new Date(e.ts) >= since);
  res.json({ count: entries.length, level: level || 'ALL', entries });
});

// Root fallback (Redundant index serving removed in v6.3 stabilization)
app.get('/', (req, res) => {
  res.json({ message: 'WG-FUX API Modular is up (Standardized)', status: 'online' });
});

// --- Init WebSocket Service ---
wsService.init(server);

// BUG-FIX: 404 handler for all non-API and unknown /api/* routes
// Prevents ghost 404s in logs for /favicon.ico or / if wrongly routed to API.
app.use((req, res) => {
  log.warn('http', 'Route not found in API container', { path: req.originalUrl, method: req.method });
  res.status(404).json({ 
    error: 'Not Found', 
    message: 'This is the API container. Requested resource not found here.',
    path: req.originalUrl 
  });
});

// --- Security & Metadata Middleware (must be before routes, applied via header hook) ---
// NOTE: These headers are set early in the pipeline. helmet() above handles most of them;
// we add custom headers here for all non-upgrade requests.

// --- Global Error Handling ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production';
  const statusCode = err.status || err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_ERROR';

  // Specialized logging for 5XX errors
  if (statusCode >= 500) {
    log.error('server', `Unhandled Exception: ${err.message}`, { 
      stack: err.stack, 
      path: req.path, 
      method: req.method,
      code: errorCode
    });
  } else {
    log.warn('server', `Client Error: ${err.message}`, { path: req.path, method: req.method, status: statusCode });
  }

  res.status(statusCode).json({ 
    error: isProd && statusCode >= 500 ? 'Service Error' : err.message, 
    message: isProd && statusCode >= 500 ? 'An internal error occurred. Please contact support.' : err.message,
    code: errorCode,
    path: isProd ? undefined : req.path
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
