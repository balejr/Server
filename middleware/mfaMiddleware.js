// middleware/mfaMiddleware.js
// Middleware to check if MFA is required for sensitive operations

const { getPool } = require('../config/db');

/**
 * Operations that require MFA verification
 */
const MFA_REQUIRED_OPERATIONS = [
  'update_email',
  'update_password',
  'update_phone',
  'delete_account',
  'disable_mfa',
  'payment_update',
  'subscription_change'
];

/**
 * Get MFA status for a user
 * @param {number} userId - User ID
 * @returns {Promise<{mfaEnabled: boolean, mfaMethod: string|null}>}
 */
const getUserMFAStatus = async (userId) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input('userId', userId)
      .query(`
        SELECT MFAEnabled, MFAMethod
        FROM dbo.UserLogin
        WHERE UserID = @userId
      `);

    if (result.recordset.length === 0) {
      return { mfaEnabled: false, mfaMethod: null };
    }

    return {
      mfaEnabled: result.recordset[0].MFAEnabled === true || result.recordset[0].MFAEnabled === 1,
      mfaMethod: result.recordset[0].MFAMethod
    };
  } catch (error) {
    console.error('Get MFA status error:', error);
    return { mfaEnabled: false, mfaMethod: null };
  }
};

/**
 * Validate MFA session token
 * @param {string} mfaSessionToken - MFA session token from request
 * @param {number} userId - User ID
 * @param {string} operation - Operation being performed
 * @returns {Promise<boolean>} - Whether MFA session is valid
 */
const validateMFASession = async (mfaSessionToken, userId, operation) => {
  if (!mfaSessionToken) {
    return false;
  }

  try {
    const pool = getPool();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    // Check for valid MFA verification in OTPVerifications table
    const result = await pool.request()
      .input('userId', userId)
      .input('purpose', 'mfa')
      .input('fiveMinutesAgo', fiveMinutesAgo)
      .query(`
        SELECT TOP 1 VerificationID, Status, CreatedAt
        FROM dbo.OTPVerifications
        WHERE UserID = @userId
          AND Purpose = @purpose
          AND Status = 'approved'
          AND CreatedAt > @fiveMinutesAgo
        ORDER BY CreatedAt DESC
      `);

    return result.recordset.length > 0;
  } catch (error) {
    console.error('Validate MFA session error:', error);
    return false;
  }
};

/**
 * Middleware to require MFA for sensitive operations
 * Use this middleware for routes that modify sensitive user data
 * 
 * @param {string} operation - The sensitive operation being performed
 * @returns {Function} Express middleware function
 * 
 * Usage:
 *   router.patch('/update-email', authenticateToken, requireMFA('update_email'), updateEmailHandler);
 */
const requireMFA = (operation) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          errorCode: 'AUTH_REQUIRED'
        });
      }

      // Check if operation requires MFA
      if (!MFA_REQUIRED_OPERATIONS.includes(operation)) {
        return next();
      }

      // Get user's MFA status
      const { mfaEnabled, mfaMethod } = await getUserMFAStatus(userId);
      
      // If MFA is not enabled, allow the operation
      if (!mfaEnabled) {
        return next();
      }

      // Check for MFA session token in headers
      const mfaSessionToken = req.headers['x-mfa-session'];
      
      // Validate MFA session
      const isMFAValid = await validateMFASession(mfaSessionToken, userId, operation);
      
      if (!isMFAValid) {
        // MFA required but not verified
        return res.status(403).json({
          success: false,
          message: 'MFA verification required for this operation',
          errorCode: 'MFA_REQUIRED',
          mfaMethod: mfaMethod,
          operation: operation
        });
      }

      // MFA verified, proceed with the operation
      req.mfaVerified = true;
      next();
    } catch (error) {
      console.error('MFA middleware error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error verifying MFA status',
        errorCode: 'MFA_ERROR'
      });
    }
  };
};

/**
 * Optional MFA middleware - warns but doesn't block if MFA is not verified
 * Useful for logging or analytics on sensitive operations
 */
const suggestMFA = (operation) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      
      if (!userId) {
        return next();
      }

      const { mfaEnabled } = await getUserMFAStatus(userId);
      
      // Add MFA status to request for downstream handlers
      req.mfaEnabled = mfaEnabled;
      req.mfaSuggested = !mfaEnabled;
      
      next();
    } catch (error) {
      console.error('Suggest MFA middleware error:', error);
      next();
    }
  };
};

/**
 * Check if user has verified MFA recently (within last 5 minutes)
 * @param {number} userId - User ID
 * @returns {Promise<boolean>}
 */
const hasRecentMFAVerification = async (userId) => {
  try {
    const pool = getPool();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const result = await pool.request()
      .input('userId', userId)
      .input('purpose', 'mfa')
      .input('fiveMinutesAgo', fiveMinutesAgo)
      .query(`
        SELECT COUNT(*) as verificationCount
        FROM dbo.OTPVerifications
        WHERE UserID = @userId
          AND Purpose = @purpose
          AND Status = 'approved'
          AND CreatedAt > @fiveMinutesAgo
      `);

    return result.recordset[0].verificationCount > 0;
  } catch (error) {
    console.error('Check recent MFA verification error:', error);
    return false;
  }
};

/**
 * Record successful MFA verification
 * @param {object} pool - Database pool
 * @param {number} userId - User ID
 * @param {string} method - MFA method used ('sms' or 'email')
 */
const recordMFAVerification = async (pool, userId, method) => {
  try {
    await pool.request()
      .input('userId', userId)
      .input('purpose', 'mfa')
      .input('method', method)
      .query(`
        UPDATE dbo.OTPVerifications
        SET Status = 'approved'
        WHERE UserID = @userId
          AND Purpose = @purpose
          AND Status = 'pending'
      `);
  } catch (error) {
    console.error('Record MFA verification error:', error);
  }
};

module.exports = {
  requireMFA,
  suggestMFA,
  getUserMFAStatus,
  validateMFASession,
  hasRecentMFAVerification,
  recordMFAVerification,
  MFA_REQUIRED_OPERATIONS
};

