/**
 * Structured Logger Utility
 * 
 * Environment-aware logging with context support:
 * - debug(): Only logs when NODE_ENV !== 'production' (for development troubleshooting)
 * - info(): Always logs (for important operational events)
 * - warn(): Always logs (for warnings)
 * - error(): Always logs (for errors)
 * 
 * This prevents sensitive authentication data from appearing in production logs
 * while maintaining full debug visibility during development.
 * 
 * Usage:
 *   logger.info('User logged in', { userId: 123, method: 'email' });
 *   logger.error('Database error', { error: err.message, code: err.code });
 */

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Format context object as JSON string for logging
 * @param {Object} context - Context object to format
 * @returns {string} Formatted context string or empty string
 */
const formatContext = (context) => {
  if (!context || typeof context !== 'object' || Object.keys(context).length === 0) {
    return '';
  }
  try {
    return JSON.stringify(context);
  } catch {
    return '[Unable to stringify context]';
  }
};

/**
 * Get timestamp for log entry
 * @returns {string} ISO timestamp
 */
const getTimestamp = () => new Date().toISOString();

const logger = {
  /**
   * Debug logging - suppressed in production
   * Use for: authentication flow details, request debugging, development troubleshooting
   * @param {string} message - Log message
   * @param {Object} context - Optional context object
   */
  debug: (message, context = {}) => {
    if (isDev) {
      const formattedContext = formatContext(context);
      if (formattedContext) {
        console.log(`[DEBUG] ${message}`, formattedContext);
      } else {
        console.log(`[DEBUG] ${message}`);
      }
    }
  },

  /**
   * Info logging - always active
   * Use for: important operational events, server startup, etc.
   * @param {string} message - Log message
   * @param {Object} context - Optional context object
   */
  info: (message, context = {}) => {
    const formattedContext = formatContext(context);
    if (formattedContext) {
      console.log(`[INFO] ${message}`, formattedContext);
    } else {
      console.log(`[INFO] ${message}`);
    }
  },

  /**
   * Warning logging - always active
   * Use for: non-critical issues, deprecation warnings, etc.
   * @param {string} message - Log message
   * @param {Object} context - Optional context object
   */
  warn: (message, context = {}) => {
    const formattedContext = formatContext(context);
    if (formattedContext) {
      console.warn(`[WARN] ${message}`, formattedContext);
    } else {
      console.warn(`[WARN] ${message}`);
    }
  },

  /**
   * Error logging - always active
   * Use for: errors, exceptions, failures
   * @param {string} message - Log message
   * @param {Object} context - Optional context object (include error.message, error.code, etc.)
   */
  error: (message, context = {}) => {
    const formattedContext = formatContext(context);
    if (formattedContext) {
      console.error(`[ERROR] ${message}`, formattedContext);
    } else {
      console.error(`[ERROR] ${message}`);
    }
  },

  /**
   * Request logging - for HTTP request tracking
   * @param {string} method - HTTP method
   * @param {string} path - Request path
   * @param {Object} context - Optional additional context
   */
  request: (method, path, context = {}) => {
    const timestamp = getTimestamp();
    const formattedContext = formatContext(context);
    if (formattedContext) {
      console.log(`[${timestamp}] 📥 ${method} ${path}`, formattedContext);
    } else {
      console.log(`[${timestamp}] 📥 ${method} ${path}`);
    }
  },

  /**
   * Response logging - for HTTP response tracking
   * @param {string} method - HTTP method
   * @param {string} path - Request path
   * @param {number} statusCode - Response status code
   * @param {number} duration - Request duration in ms
   */
  response: (method, path, statusCode, duration) => {
    const timestamp = getTimestamp();
    const emoji = statusCode < 400 ? '✅' : statusCode < 500 ? '⚠️' : '❌';
    console.log(`[${timestamp}] ${emoji} ${method} ${path} ${statusCode} (${duration}ms)`);
  },

  /**
   * Database operation logging
   * @param {string} operation - Operation type (SELECT, INSERT, UPDATE, DELETE)
   * @param {string} table - Table name
   * @param {Object} context - Additional context
   */
  db: (operation, table, context = {}) => {
    if (isDev) {
      const formattedContext = formatContext(context);
      if (formattedContext) {
        console.log(`[DB] ${operation} ${table}`, formattedContext);
      } else {
        console.log(`[DB] ${operation} ${table}`);
      }
    }
  },
};

module.exports = logger;
