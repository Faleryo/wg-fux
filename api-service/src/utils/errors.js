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
  };

  const statusCode = statusMap[code] || 500;

  return {
    success: false,
    status: statusCode, // 🛡️ OBSIDIAN-HARDENING: Explicit status for Express
    error: typeof error === 'string' ? error : error?.message || 'Unknown Error',
    message:
      message || (typeof error === 'string' ? error : error?.message) || 'Unknown internal error',
    code: error?.code || code,
    path: path || null,
    details,
    timestamp: new Date().toISOString(),
  };
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
