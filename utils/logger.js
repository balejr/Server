/**
 * Simple environment-aware logger utility
 * 
 * - debug(): Only logs when NODE_ENV !== 'production' (for development troubleshooting)
 * - info(): Always logs (for important operational events)
 * - warn(): Always logs (for warnings)
 * - error(): Always logs (for errors)
 * 
 * This prevents sensitive authentication data from appearing in production logs
 * while maintaining full debug visibility during development.
 */

const isDev = process.env.NODE_ENV !== 'production';

const logger = {
  /**
   * Debug logging - suppressed in production
   * Use for: authentication flow details, request debugging, development troubleshooting
   */
  debug: (...args) => {
    if (isDev) {
      console.log('[DEBUG]', ...args);
    }
  },

  /**
   * Info logging - always active
   * Use for: important operational events, server startup, etc.
   */
  info: (...args) => {
    console.log('[INFO]', ...args);
  },

  /**
   * Warning logging - always active
   * Use for: non-critical issues, deprecation warnings, etc.
   */
  warn: (...args) => {
    console.warn('[WARN]', ...args);
  },

  /**
   * Error logging - always active
   * Use for: errors, exceptions, failures
   */
  error: (...args) => {
    console.error('[ERROR]', ...args);
  },
};

module.exports = logger;

