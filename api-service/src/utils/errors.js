/**
 * Standardized API Error JSON Factory
 * Handles both plain strings and Zod Error objects for consistent reporting.
 */
const createError = (error, message, code = 'INTERNAL_ERROR', path = null) => {
  let details = null;

  // Handle Zod Error objects
  if (error && typeof error === 'object' && error.name === 'ZodError') {
    code = 'VALIDATION_ERROR';
    const issues = Array.isArray(error.errors)
      ? error.errors
      : Array.isArray(error.issues)
        ? error.issues
        : [];

    details = issues.map((e) => ({
      path: Array.isArray(e.path) ? e.path.join('.') : '',
      message: e.message || 'Validation error',
    }));
    message = message || 'Validation failed';
  }

  const statusMap = {
    NOT_FOUND: 404,
    FORBIDDEN: 403,
    UNAUTHORIZED: 401,
    INVALID_AUTH: 401,
    VALIDATION_ERROR: 400,
    BAD_REQUEST: 400,
    EPERM_SAFE_EXEC: 403,
    SYSTEM_ERROR: 503,
    CONFIG_ERROR: 503,
    EXTERNAL_SERVICE_ERROR: 502,
    CONCURRENCY_ERROR: 429,
    CONFLICT: 409,
    ACCOUNT_EXPIRED: 403,
    '2FA_REQUIRED': 403,
    INVALID_2FA: 401,
    AUTH_RATE_LIMIT: 429,
  };

  const statusCode = statusMap[code] || 500;

  // SRE FIX: Return an Error instance so Express global handler can read .status and .message
  const errMsg =
    message || (typeof error === 'string' ? error : error?.message) || 'Unknown internal error';
  const errObj = new Error(errMsg);
  errObj.success = false;
  errObj.status = statusCode;
  errObj.statusCode = statusCode; // Express compat
  // Error.prototype.message is non-enumerable — redefine so JSON.stringify
  // exposes it to clients consuming `res.json(createError(...))`.
  Object.defineProperty(errObj, 'message', { value: errMsg, enumerable: true, writable: true });
  errObj.error = typeof error === 'string' ? error : 'An error occurred';
  errObj.code = code;
  errObj.path = path || null;
  errObj.details = details;
  errObj.timestamp = new Date().toISOString();

  return errObj;
};

/**
 * Construit le corps JSON servi par le gestionnaire d'erreurs global Express.
 *
 * HARDENING (information disclosure) : en production, une erreur SERVEUR (5xx)
 * ne doit JAMAIS fuiter de stack trace ni de chemin de fichier interne dans la
 * réponse HTTP. Le message brut de l'exception peut contenir un chemin absolu,
 * un fragment de requête SQL ou un secret → on le remplace par un message
 * générique + un code stable. Les erreurs CLIENT (4xx) restent explicites (les
 * messages de validation sont attendus par l'appelant). En dev, on garde tout le
 * détail pour déboguer. La stack, elle, n'apparaît JAMAIS dans la réponse : elle
 * n'est journalisée que côté serveur (voir server.js).
 *
 * @param {Error & {status?, statusCode?, code?, error?, details?}} err
 * @param {{ path?: string, isProd?: boolean }} opts
 * @returns {{ statusCode: number, body: object }}
 */
const buildErrorBody = (err = {}, { path = null, isProd = false } = {}) => {
  const statusCode = err.status || err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_ERROR';
  const isServerError = statusCode >= 500;
  const exposeDetail = !isProd || !isServerError;

  const body = {
    success: false,
    status: statusCode,
    code: errorCode,
    timestamp: new Date().toISOString(),
  };

  if (exposeDetail) {
    body.error = err.error || err.message;
    body.message = err.message;
    body.path = path;
    body.details = err.details || null;
  } else {
    body.error = 'Internal Server Error';
    body.message = 'An internal error occurred. Please try again later.';
  }

  return { statusCode, body };
};

/**
 * Express Middleware Wrapper for Catching Async Errors
 * Prevents UnhandledPromiseRejection and ensures 'next(e)' is called.
 */
const asyncWrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  createError,
  buildErrorBody,
  asyncWrap,
};
