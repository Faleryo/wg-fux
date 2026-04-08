/**
 * Standardized API Error JSON Factory
 */
const createError = (error, message, code = 'INTERNAL_ERROR', path = null) => ({
  error,
  message: message || error,
  code,
  path,
  timestamp: new Date().toISOString(),
});

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
