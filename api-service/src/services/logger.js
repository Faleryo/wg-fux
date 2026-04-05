/**
 * WG-FUX Structured Logger — Vibe-OS SRE Protocol
 * 
 * Chaque log est un objet JSON sur une seule ligne (logfmt-compatible).
 * Compatible avec: grep, jq, Loki, Datadog, CloudWatch, etc.
 * 
 * Usage:
 *   const log = require('./logger');
 *   log.info('clients', 'Client created', { name: 'foo', container: 'bar' });
 *   log.error('system', 'WireGuard down', { interface: 'wg0', err: e.message });
 * 
 * Niveaux: DEBUG < INFO < WARN < ERROR < AUDIT
 * Contrôlé par: LOG_LEVEL (défaut: INFO) et LOG_FORMAT (json|pretty)
 */

'use strict';

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, AUDIT: 4 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] ?? LEVELS.INFO;
const FORMAT = process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'pretty');

// Compteurs pour le rapport de diagnostic
const _counters = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, AUDIT: 0 };

// Circular buffer: conserve les 200 dernières entrées en mémoire
const _buffer = [];
const BUFFER_SIZE = 200;

const _write = (level, service, message, meta = {}) => {
  if (LEVELS[level] < MIN_LEVEL) return;
  _counters[level]++;

  const entry = {
    ts: new Date().toISOString(),
    level,
    svc: service,
    msg: message,
    pid: process.pid,
    ...meta
  };

  // Circular buffer (pour /api/debug/logs)
  _buffer.push(entry);
  if (_buffer.length > BUFFER_SIZE) _buffer.splice(0, 1);

  if (FORMAT === 'json') {
    // Production: JSON strict sur une ligne (ingestible par Loki/Datadog)
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    // Développement: format coloré lisible
    const COLORS = {
      DEBUG: '\x1b[36m', INFO: '\x1b[32m', WARN: '\x1b[33m',
      ERROR: '\x1b[31m', AUDIT: '\x1b[35m', RESET: '\x1b[0m'
    };
    const color = COLORS[level] || '';
    const reset = COLORS.RESET;
    const metaStr = Object.keys(meta).length
      ? ' ' + Object.entries(meta).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
      : '';
    const timestamp = entry.ts.slice(11, 23); // HH:MM:SS.mmm
    process.stdout.write(
      `${color}[${level.padEnd(5)}]${reset} ${timestamp} [${service.padEnd(10)}] ${message}${metaStr}\n`
    );
  }
};

// ─── HTTP Request Logger Middleware (Morgan-style, mais structuré) ────────────
const requestMiddleware = (req, res, next) => {
  const startTime = Date.now();
  const route = `${req.method} ${req.originalUrl.split('?')[0]}`;

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'ERROR'
      : res.statusCode >= 400 ? 'WARN'
        : 'DEBUG';

    _write(level, 'http', route, {
      status: res.statusCode,
      ms: duration,
      ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '-',
      user: req.user?.username || '-',
      ua: (req.headers['user-agent'] || '-').substring(0, 60),
      bytes: parseInt(res.getHeader('content-length') || '0') || 0,
    });
  });

  next();
};

// ─── Capturer les uncaughtException/unhandledRejection ───────────────────────
process.on('uncaughtException', (err) => {
  _write('ERROR', 'process', 'UncaughtException', { err: err.message, stack: err.stack?.split('\n')[1]?.trim() });
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason) => {
  _write('WARN', 'process', 'UnhandledRejection', {
    reason: reason instanceof Error ? reason.message : String(reason)
  });
});

// ─── API publique ─────────────────────────────────────────────────────────────
const logger = {
  debug: (svc, msg, meta = {}) => _write('DEBUG', svc, msg, meta),
  info:  (svc, msg, meta = {}) => _write('INFO',  svc, msg, meta),
  warn:  (svc, msg, meta = {}) => _write('WARN',  svc, msg, meta),
  error: (svc, msg, meta = {}) => _write('ERROR', svc, msg, meta),
  audit: (svc, msg, meta = {}) => _write('AUDIT', svc, msg, meta),

  // Middleware Express
  requestMiddleware,

  // Accès au buffer in-memory (pour /api/debug/logs)
  getBuffer: (level = null, limit = 100) => {
    let entries = [..._buffer].reverse();
    if (level) entries = entries.filter(e => e.level === level.toUpperCase());
    return entries.slice(0, limit);
  },

  // Compteurs pour le rapport de santé
  getCounters: () => ({ ..._counters }),

  // Reset des compteurs (après un rapport)
  resetCounters: () => {
    Object.keys(_counters).forEach(k => { _counters[k] = 0; });
  }
};

module.exports = logger;
