// utils/token.js
const jwt = require("jsonwebtoken");

// Token expiration times
const ACCESS_TOKEN_EXPIRY = "15m"; // 15 minutes
const REFRESH_TOKEN_EXPIRY = "7d"; // 7 days

// Get JWT secret with fallback for development
const getJwtSecret = () => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  // Development fallback - DO NOT use in production
  console.warn(
    "⚠️  JWT_SECRET not set - using development fallback. Set JWT_SECRET in production!"
  );
  return "dev-secret-key-change-in-production";
};

/**
 * Generate an access token (short-lived)
 * @param {object} payload - Token payload (e.g., { userId: 123 })
 * @returns {string} - JWT access token
 */
const generateAccessToken = (payload) => {
  return jwt.sign({ ...payload, type: "access" }, getJwtSecret(), {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
};

/**
 * Generate a refresh token (long-lived)
 * @param {object} payload - Token payload (e.g., { userId: 123 })
 * @returns {string} - JWT refresh token
 */
const generateRefreshToken = (payload) => {
  const refreshSecret = process.env.JWT_REFRESH_SECRET || getJwtSecret();
  return jwt.sign({ ...payload, type: "refresh" }, refreshSecret, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
};

/**
 * Generate both access and refresh tokens
 * @param {object} payload - Token payload (e.g., { userId: 123 })
 * @returns {{accessToken: string, refreshToken: string, expiresIn: number}}
 */
const generateTokenPair = (payload) => {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
    expiresIn: 900, // 15 minutes in seconds
  };
};

/**
 * Legacy function for backward compatibility
 * @param {object} payload - Token payload
 * @returns {string} - JWT token (access token)
 */
const generateToken = (payload) => {
  return generateAccessToken(payload);
};

/**
 * Verify a token
 * @param {string} token - JWT token to verify
 * @param {string} type - Token type ('access' or 'refresh')
 * @returns {{valid: boolean, decoded?: object, error?: string, errorCode?: string}}
 */
const verifyToken = (token, type = "access") => {
  try {
    const secret =
      type === "refresh"
        ? process.env.JWT_REFRESH_SECRET || getJwtSecret()
        : getJwtSecret();

    const decoded = jwt.verify(token, secret);

    // Verify token type matches expected type
    if (decoded.type && decoded.type !== type) {
      return {
        valid: false,
        error: "Token type mismatch",
        errorCode: "TOKEN_TYPE_MISMATCH",
      };
    }

    return {
      valid: true,
      decoded,
    };
  } catch (error) {
    // Log the specific JWT error for debugging
    console.log("🔑 Token verification error:", {
      errorName: error.name,
      errorMessage: error.message,
      tokenType: type,
    });

    if (error.name === "TokenExpiredError") {
      return {
        valid: false,
        error: "Token has expired",
        errorCode: "TOKEN_EXPIRED",
      };
    }

    if (error.name === "JsonWebTokenError") {
      return {
        valid: false,
        error: `Invalid token: ${error.message}`,
        errorCode: "TOKEN_INVALID",
      };
    }

    return {
      valid: false,
      error: error.message || "Token verification failed",
      errorCode: "TOKEN_ERROR",
    };
  }
};

/**
 * Decode a token without verification (for inspection)
 * @param {string} token - JWT token to decode
 * @returns {object|null} - Decoded payload or null if invalid
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch {
    return null;
  }
};

/**
 * Check if a token is expired or about to expire
 * @param {string} token - JWT token to check
 * @param {number} bufferSeconds - Buffer time before expiry (default: 60 seconds)
 * @returns {boolean} - True if token is expired or about to expire
 */
const isTokenExpiring = (token, bufferSeconds = 60) => {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) {
      return true;
    }

    const expiryTime = decoded.exp * 1000; // Convert to milliseconds
    const bufferTime = bufferSeconds * 1000;
    const now = Date.now();

    return expiryTime - bufferTime <= now;
  } catch {
    return true;
  }
};

/**
 * Calculate refresh token expiry date
 * @returns {Date} - Expiry date for refresh token (7 days from now)
 */
const getRefreshTokenExpiry = () => {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 7); // 7 days
  return expiryDate;
};

module.exports = {
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyToken,
  decodeToken,
  isTokenExpiring,
  getRefreshTokenExpiry,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
};
