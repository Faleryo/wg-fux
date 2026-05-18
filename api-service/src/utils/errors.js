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
  };

  const statusCode = statusMap[code] || 500;

  // SRE FIX: Return an Error instance so Express global handler can read .status and .message
  const errObj = new Error(
    message || (typeof error === 'string' ? error : error?.message) || 'Unknown internal error'
  );
  errObj.success = false;
  errObj.status = statusCode;
  errObj.statusCode = statusCode; // Express compat
  errObj.error = typeof error === 'string' ? error : error?.message || 'Unknown Error';
  errObj.code = error?.code || code;
  errObj.path = path || null;
  errObj.details = details;
  errObj.timestamp = new Date().toISOString();

  return errObj;
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
  asyncWrap,
};
