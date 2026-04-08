/**
 * WG-FUX Structured Logger — Vibe-OS SRE Protocol
 * 
 * Version 3.1.2 - Rugged Edition (Anti-DoS)
 */

'use strict';

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, AUDIT: 4 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] ?? LEVELS.INFO;
const FORMAT = process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'pretty');

const _counters = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, AUDIT: 0 };
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

  _buffer.push(entry);
  if (_buffer.length > BUFFER_SIZE) _buffer.shift();

  if (FORMAT === 'json') {
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    const COLORS = {
      DEBUG: '\x1b[36m', INFO: '\x1b[32m', WARN: '\x1b[33m',
      ERROR: '\x1b[31m', AUDIT: '\x1b[35m', RESET: '\x1b[0m'
    };
    const color = COLORS[level] || '';
    const reset = COLORS.RESET;
    const metaStr = Object.keys(meta).length
      ? ' ' + Object.entries(meta).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
      : '';
    const timestamp = entry.ts.slice(11, 23);
    process.stdout.write(
      `${color}[${level.padEnd(5)}]${reset} ${timestamp} [${service.padEnd(10)}] ${message}${metaStr}\n`
    );
  }
};

const getSafeIp = (req) => {
  try {
    const xff = req.headers['x-forwarded-for'];
    let ip = '';
    if (typeof xff === 'string') {
      ip = xff.split(',')?.[0];
    } else if (Array.isArray(xff) && xff.length > 0) {
      ip = String(xff?.[0]).split(',')?.[0];
    }
    return (ip || req.socket?.remoteAddress || '-').trim();
  } catch {
    return req.socket?.remoteAddress || '-';
  }
};

const requestMiddleware = (req, res, next) => {
  const startTime = Date.now();
  const route = `${req.method} ${(req.originalUrl || '').split('?')?.[0]}`;

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'ERROR'
      : res.statusCode >= 400 ? 'WARN'
        : 'DEBUG';

    _write(level, 'http', route, {
      status: res.statusCode,
      ms: duration,
      ip: getSafeIp(req),
      user: req.user?.username || '-',
      ua: (req.headers['user-agent'] || '-').substring(0, 60),
      bytes: parseInt(res.getHeader('content-length') || '0') || 0,
    });
  });

  next();
};

process.on('uncaughtException', (err) => {
  _write('ERROR', 'process', 'UncaughtException', { err: err.message, stack: (err.stack || '').split('\n')?.[1]?.trim() });
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRASH-DEBUG] Unhandled Rejection:', reason);
  _write('WARN', 'process', 'UnhandledRejection', {
    reason: reason instanceof Error ? reason.message : String(reason)
  });
});

const logger = {
  debug: (svc, msg, meta = {}) => _write('DEBUG', svc, msg, meta),
  info:  (svc, msg, meta = {}) => _write('INFO',  svc, msg, meta),
  warn:  (svc, msg, meta = {}) => _write('WARN',  svc, msg, meta),
  error: (svc, msg, meta = {}) => _write('ERROR', svc, msg, meta),
  audit: (svc, msg, meta = {}) => _write('AUDIT', svc, msg, meta),
  requestMiddleware,
  getBuffer: (level = null, limit = 100) => {
    let entries = [..._buffer].reverse();
    if (level) entries = entries.filter(e => e.level === level.toUpperCase());
    return entries.slice(0, limit);
  },
  getCounters: () => ({ ..._counters }),
  resetCounters: () => {
    Object.keys(_counters).forEach(k => { _counters[k] = 0; });
  }
};

module.exports = logger;
