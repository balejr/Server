// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const { verifyToken, isTokenExpiring } = require("../utils/token");
const { getPool } = require("../config/db");
const logger = require("../utils/logger");

/**
 * Error codes for authentication failures
 */
const AUTH_ERROR_CODES = {
  MISSING_TOKEN: "MISSING_TOKEN",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID: "TOKEN_INVALID",
  REFRESH_REQUIRED: "REFRESH_REQUIRED",
  TOKEN_TYPE_MISMATCH: "TOKEN_TYPE_MISMATCH",
  SESSION_INVALIDATED: "SESSION_INVALIDATED",
  AUTH_ERROR: "AUTH_ERROR",
};

/**
 * Authenticate access token middleware
 * Verifies the JWT access token from the Authorization header
 * Also checks if the token was issued before user logged out
 */
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    logger.debug("Auth failed: No token provided", {
      path: req.path,
      authHeader: authHeader ? "present but malformed" : "missing",
    });
    return res.status(401).json({
      success: false,
      message: "Authentication required",
      errorCode: AUTH_ERROR_CODES.MISSING_TOKEN,
    });
  }

  // Verify the token
  const result = verifyToken(token, "access");

  if (!result.valid) {
    logger.debug("Auth failed", {
      path: req.path,
      errorCode: result.errorCode,
      error: result.error,
      tokenPreview: token ? `${token.substring(0, 20)}...` : "none",
    });

    // Determine appropriate status code and response
    if (result.errorCode === "TOKEN_EXPIRED") {
      return res.status(401).json({
        success: false,
        message: "Access token has expired",
        errorCode: AUTH_ERROR_CODES.TOKEN_EXPIRED,
        refreshRequired: true,
      });
    }

    if (result.errorCode === "TOKEN_TYPE_MISMATCH") {
      return res.status(401).json({
        success: false,
        message: "Invalid token type",
        errorCode: AUTH_ERROR_CODES.TOKEN_TYPE_MISMATCH,
      });
    }

    return res.status(403).json({
      success: false,
      message: "Session invalid. Please sign in again.",
      errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
      requireLogin: true,
    });
  }

  // Check if token was issued before user logged out (TokenInvalidatedAt check)
  try {
    const pool = getPool();
    const invalidationCheck = await pool
      .request()
      .input("userId", result.decoded.userId)
      .query(
        `SELECT TokenInvalidatedAt FROM dbo.UserLogin WHERE UserID = @userId`
      );

    if (invalidationCheck.recordset.length > 0) {
      const invalidatedAt = invalidationCheck.recordset[0].TokenInvalidatedAt;

      // If TokenInvalidatedAt is set and token was issued before that time, reject it
      // JWT 'iat' is in seconds, so multiply by 1000 to compare with JS Date
      if (invalidatedAt && result.decoded.iat) {
        const tokenIssuedAt = result.decoded.iat * 1000; // Convert to milliseconds
        const invalidatedAtTime = new Date(invalidatedAt).getTime();

        if (tokenIssuedAt < invalidatedAtTime) {
          logger.debug("Auth failed: Token was invalidated by logout", {
            path: req.path,
            userId: result.decoded.userId,
            tokenIssuedAt: new Date(tokenIssuedAt).toISOString(),
            invalidatedAt: new Date(invalidatedAtTime).toISOString(),
          });

          return res.status(401).json({
            success: false,
            message: "Session has been invalidated. Please sign in again.",
            errorCode: AUTH_ERROR_CODES.SESSION_INVALIDATED,
            requireLogin: true,
          });
        }
      }
    }
  } catch (dbError) {
    // Log error but don't block auth if database check fails
    // This prevents auth from breaking if column doesn't exist yet
    logger.warn("TokenInvalidatedAt check failed (non-blocking)", {
      error: dbError.message,
    });
  }

  // Check if token is about to expire (within 2 minutes)
  const tokenExpiringSoon = isTokenExpiring(token, 120);

  // Attach user info to request
  req.user = result.decoded;
  req.tokenExpiringSoon = tokenExpiringSoon;

  // Add header to inform client if token refresh is recommended
  if (tokenExpiringSoon) {
    res.set("X-Token-Refresh-Recommended", "true");
  }

  next();
};

/**
 * Authenticate refresh token
 * Used specifically for the token refresh endpoint
 */
const authenticateRefreshToken = (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({
      success: false,
      message: "Refresh token required",
      errorCode: AUTH_ERROR_CODES.MISSING_TOKEN,
    });
  }

  // Verify the refresh token
  const result = verifyToken(refreshToken, "refresh");

  if (!result.valid) {
    if (result.errorCode === "TOKEN_EXPIRED") {
      return res.status(401).json({
        success: false,
        message: "Refresh token has expired. Please sign in again.",
        errorCode: AUTH_ERROR_CODES.TOKEN_EXPIRED,
        requireLogin: true,
      });
    }

    return res.status(403).json({
      success: false,
      message: result.error || "Invalid refresh token",
      errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
    });
  }

  // Attach user info to request
  req.user = result.decoded;
  req.refreshToken = refreshToken;

  next();
};

/**
 * Optional authentication middleware
 * Attaches user info if token is valid, but doesn't block if missing/invalid
 * Useful for endpoints that have different behavior for authenticated vs anonymous users
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    req.user = null;
    return next();
  }

  const result = verifyToken(token, "access");

  if (result.valid) {
    req.user = result.decoded;
  } else {
    req.user = null;
    req.authError = result.errorCode;
  }

  next();
};

/**
 * Rate limiting helper for auth endpoints
 * Tracks failed authentication attempts by IP
 */
const authRateLimitMap = new Map();
const AUTH_RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = 5;

const checkAuthRateLimit = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  // Get or create rate limit entry for this IP
  let entry = authRateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > AUTH_RATE_LIMIT_WINDOW) {
    // Create new window
    entry = { windowStart: now, attempts: 0 };
    authRateLimitMap.set(ip, entry);
  }

  if (entry.attempts >= AUTH_RATE_LIMIT_MAX_ATTEMPTS) {
    const retryAfter = Math.ceil(
      (entry.windowStart + AUTH_RATE_LIMIT_WINDOW - now) / 1000
    );
    res.set("Retry-After", retryAfter.toString());

    return res.status(429).json({
      success: false,
      message: "Too many authentication attempts. Please try again later.",
      errorCode: "RATE_LIMIT_EXCEEDED",
      retryAfter,
    });
  }

  // Increment attempts
  entry.attempts++;

  // Attach rate limit info to request for logging
  req.authRateLimit = {
    attempts: entry.attempts,
    remaining: AUTH_RATE_LIMIT_MAX_ATTEMPTS - entry.attempts,
  };

  next();
};

/**
 * Reset rate limit for successful authentication
 */
const resetAuthRateLimit = (req) => {
  const ip = req.ip || req.connection.remoteAddress;
  authRateLimitMap.delete(ip);
};

/**
 * Clean up old rate limit entries (call periodically)
 */
const cleanupRateLimitEntries = () => {
  const now = Date.now();
  for (const [ip, entry] of authRateLimitMap.entries()) {
    if (now - entry.windowStart > AUTH_RATE_LIMIT_WINDOW) {
      authRateLimitMap.delete(ip);
    }
  }
};

// Clean up rate limit entries every 5 minutes
setInterval(cleanupRateLimitEntries, 5 * 60 * 1000);

module.exports = {
  authenticateToken,
  authenticateRefreshToken,
  optionalAuth,
  checkAuthRateLimit,
  resetAuthRateLimit,
  AUTH_ERROR_CODES,
};
