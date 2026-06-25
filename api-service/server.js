require('dotenv').config();
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

if (process.env.SENTRY_DSN && process.env.SENTRY_DSN.startsWith('http')) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [nodeProfilingIntegration()],
    // Performance Monitoring
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '0.1'),
    environment: process.env.NODE_ENV || 'production',
  });
}

const express = require('express');
const http = require('http');

const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const wsService = require('./src/services/ws');

// Internal Imports
const { auth, requireAdmin } = require('./src/middleware/auth');
const { startJobs } = require('./src/services/jobs');
const { checkScripts } = require('./src/services/system');
const log = require('./src/services/logger');
const { db } = require('./db');
const schema = require('./db/schema');

// : Global Security Headers (Hardened)
const vibeHeaders = (req, res, next) => {
  res.set('X-Powered-By', 'Vibe-Shield');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
};

// Route Imports
const authRoutes = require('./src/routes/auth');
const clientRoutes = require('./src/routes/clients');
const systemRoutes = require('./src/routes/system');
const userRoutes = require('./src/routes/users');

const sentinelRoutes = require('./src/routes/sentinel');
const dnsRoutes = require('./src/routes/dns');
const { initializeDatabase, initializeDNS } = require('./src/services/init');

const app = express();
app.set('trust proxy', 1); // Trust first-hop proxy (Nginx) for rate-limiting

const server = http.createServer(app);
server.timeout = 30000; // 30 second timeout for all requests
server.headersTimeout = 31000; // Slightly above timeout to allow proper response

// --- Swagger Documentation ---
const { swaggerUi, specs } = require('./src/utils/swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

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
const corsOrigin = rawOrigins
  ? rawOrigins.split(',').map((o) => o.trim())
  : isProd
    ? false
    : ['http://localhost:5173', 'http://localhost:3000'];
app.use(
  cors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Token'],
  })
);
app.use(vibeHeaders);
app.use(express.json());

// Structured HTTP Request Logger (remplace console.log manuel)
app.use(log.requestMiddleware);

// --- Security & Custom Metadata Headers (Cleaned Wave 3) ---
app.use((req, res, next) => {
  // Custom header for versioning only, standard security headers are handled by Nginx proxy
  res.setHeader('X-WG-Shield-Status', 'active');
  next();
});

// Rate Limiting : Global protection for all API endpoints
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // Sufficient for 1-second telemetry polling (500req/15min max per client)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.', code: 'RATE_LIMIT_EXCEEDED' },
});
app.use('/api/', globalLimiter);

// --- Public Routes ---
app.get('/api/install/status', (req, res) => res.json({ installed: true }));
app.get('/api/health', async (req, res) => {
  const scriptsOk = await checkScripts();
  res.json({
    status: scriptsOk ? 'healthy' : 'degraded',
    version: '3.1.0',
    uptime: process.uptime(),
    sre: { watcher: 'v6.3', scripts: scriptsOk ? 'ok' : 'fail' },
  });
});

app.get('/api/ready', async (req, res) => {
  try {
    const scriptsOk = await checkScripts();
    if (!scriptsOk) return res.status(503).json({ status: 'not ready', reason: 'scripts missing' });
    // Check DB
    await db.select().from(schema.users).limit(1);
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', error: err.message });
  }
});

// --- Auth Routes (contains both public /login and protected /check) ---
app.use('/api/auth', authRoutes);

// --- Protected Routes (Global Auth applied at mount point) ---
app.use('/api/clients', auth, clientRoutes);
app.use('/api/system', auth, systemRoutes);
app.use('/api/users', auth, requireAdmin, userRoutes);
app.use('/api/sentinel', auth, sentinelRoutes);
app.use('/api/dns', auth, requireAdmin, dnsRoutes);

// ─── Debug Route (admin only) ─────────────────────────────────────────────────
// GET /api/debug → rapport de santé complet
// GET /api/debug/logs → circular buffer des 200 derniers logs
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
      os_used_pct: Math.round((1 - freeMem / osMem) * 100),
    },
    cpu_load: os.loadavg(),
    log_counters: logCounters,
    routes_registered: app._router?.stack?.filter((r) => r.route).length || 'unknown',
  });
});

app.get('/api/debug/logs', auth, requireAdmin, (req, res) => {
  const level = req.query.level?.toUpperCase() || null;
  const limit = Math.min(200, parseInt(req.query.limit) || 100);
  const since = req.query.since ? new Date(req.query.since) : null;
  let entries = log.getBuffer(level, limit);
  if (since) entries = entries.filter((e) => new Date(e.ts) >= since);
  res.json({ count: entries.length, level: level || 'ALL', entries });
});

// --- P12 : Observability Metrics (Prometheus Style) ---
app.get('/api/metrics', auth, requireAdmin, async (req, res) => {
  const os = require('os');
  const counters = log.getCounters();
  const p95 = log.getP95Latency ? log.getP95Latency() : 0;

  let output = '# HELP wg_fux_log_events_total Total number of log events by level\n';
  output += '# TYPE wg_fux_log_events_total counter\n';
  Object.entries(counters).forEach(([level, count]) => {
    output += `wg_fux_log_events_total{level="${level.toLowerCase()}"} ${count}\n`;
  });

  output += `wg_fux_http_request_p95_latency_ms ${p95}\n`;

  const routeCounters = log.getRouteCounters();
  output += '\n# HELP wg_fux_http_requests_total Total number of HTTP requests by route\n';
  output += '# TYPE wg_fux_http_requests_total counter\n';
  output += '# HELP wg_fux_http_errors_total Total number of HTTP errors (4xx/5xx) by route\n';
  output += '# TYPE wg_fux_http_errors_total counter\n';

  Object.entries(routeCounters).forEach(([route, counts]) => {
    const [method, path] = route.split(' ');
    output += `wg_fux_http_requests_total{method="${method}",path="${path}"} ${counts.total}\n`;
    output += `wg_fux_http_errors_total{method="${method}",path="${path}"} ${counts.errors}\n`;
  });

  output += '\n# HELP wg_fux_uptime_seconds Process uptime\n';
  output += '# TYPE wg_fux_uptime_seconds counter\n';
  output += `wg_fux_uptime_seconds ${Math.floor(process.uptime())}\n`;

  output += '\n# HELP wg_fux_system_load_avg System load average (1m)\n';
  output += '# TYPE wg_fux_system_load_avg gauge\n';
  output += `wg_fux_system_load_avg ${os.loadavg()[0]}\n`;

  output += '\n# HELP wg_fux_system_cpu_count Total system CPU cores\n';
  output += '# TYPE wg_fux_system_cpu_count gauge\n';
  output += `wg_fux_system_cpu_count ${os.cpus().length}\n`;

  try {
    const clients = await db.select().from(schema.clients);
    output += '\n# HELP wg_fux_clients_total Total number of registered VPN clients\n';
    output += '# TYPE wg_fux_clients_total gauge\n';
    output += `wg_fux_clients_total ${clients.length}\n`;

    const enabledCount = clients.filter((c) => c.enabled).length;
    output += '\n# HELP wg_fux_clients_enabled_total Total number of enabled VPN clients\n';
    output += '# TYPE wg_fux_clients_enabled_total gauge\n';
    output += `wg_fux_clients_enabled_total ${enabledCount}\n`;
  } catch (e) {
    log.error('metrics', 'Failed to fetch client metrics', { error: e.message });
  }

  output += '\n# HELP wg_fux_memory_usage_bytes Process memory usage\n';
  output += '# TYPE wg_fux_memory_usage_bytes gauge\n';
  const mem = process.memoryUsage();
  output += `wg_fux_memory_usage_bytes{type="rss"} ${mem.rss}\n`;
  output += `wg_fux_memory_usage_bytes{type="heap_total"} ${mem.heapTotal}\n`;
  output += `wg_fux_memory_usage_bytes{type="heap_used"} ${mem.heapUsed}\n`;

  res.set('Content-Type', 'text/plain');
  res.send(output);
});

// Root fallback (Redundant index serving removed in v6.3 stabilization)
app.get('/', (req, res) => {
  res.json({ message: 'WG-FUX API Modular is up (Standardized)', status: 'online' });
});

// --- Init WebSocket Service ---
wsService.init(server);

// Sentry Error Handler (must be BEFORE 404 handler to catch route errors)
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

// BUG-FIX: 404 handler
app.use((req, res) => {
  log.warn('http', 'Route not found in API container', {
    path: req.originalUrl,
    method: req.method,
  });
  res.status(404).json({
    error: 'Not Found',
    message: 'This is the API container. Requested resource not found here.',
    path: req.originalUrl,
  });
});

app.use((err, req, res, _next) => {
  const isProd = process.env.NODE_ENV === 'production';
  const statusCode = err.status || err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_ERROR';

  if (statusCode >= 500) {
    log.error('server', `Unhandled Exception: ${err.message}`, {
      stack: isProd ? undefined : err.stack,
      path: req.path,
      method: req.method,
      code: errorCode,
    });
  } else {
    log.warn('server', `Client Error: ${err.message}`, {
      path: req.path,
      method: req.method,
      status: statusCode,
    });
  }

  // SRE FIX: Build a plain JSON response instead of re-calling createError
  // (createError now returns Error instances which don't serialize cleanly to JSON)
  res.status(statusCode).json({
    success: false,
    status: statusCode,
    error: err.error || err.message,
    message: err.message,
    code: errorCode,
    path: req.path,
    details: err.details || null,
    timestamp: new Date().toISOString(),
  });
});

// --- Startup ---
// --- Startup Validation ---
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET not set. Authentication is required.');
  process.exit(1);
}
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 16) {
  console.error('FATAL: JWT_SECRET is too short (minimum 16 characters).');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  (async () => {
    try {
      console.log('----------------------------------------------------');
      console.log('Initializing WG-FUX API Services...');

      await initializeDatabase();
      await initializeDNS();

      startJobs(); // Start background tasks

      server.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 WG-FUX API Modular running on port ${PORT}`);
        console.log(`🛠️ Mode: ${process.env.NODE_ENV || 'production'}`);
        console.log('----------------------------------------------------');
      });
    } catch (err) {
      console.error('❌ FATAL: API failed to initialize:', err);
      process.exit(1);
    }
  })();
}

// Graceful shutdown — clean up WebSocket, intervals, and DB
const gracefulShutdown = async (signal) => {
  console.log(`\n⚠️ Received ${signal}. Shutting down gracefully...`);
  wsService.shutdown();
  server.close(() => {
    console.log('✅ HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('❌ Forced exit after timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, server };
