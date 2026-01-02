/**
 * Unit Tests for Token Utility
 */

const jwt = require('jsonwebtoken');
const {
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
} = require('../../../utils/token');

// Set test JWT secret
process.env.JWT_SECRET = 'test-secret-for-unit-tests';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-unit-tests';

describe('Token Utility', () => {
  const testPayload = { userId: 123 };

  describe('generateAccessToken()', () => {
    it('should generate a valid JWT access token', () => {
      const token = generateAccessToken(testPayload);
      
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include userId in token payload', () => {
      const token = generateAccessToken(testPayload);
      const decoded = jwt.decode(token);
      
      expect(decoded.userId).toBe(123);
    });

    it('should set token type to "access"', () => {
      const token = generateAccessToken(testPayload);
      const decoded = jwt.decode(token);
      
      expect(decoded.type).toBe('access');
    });

    it('should have expiration time', () => {
      const token = generateAccessToken(testPayload);
      const decoded = jwt.decode(token);
      
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
    });
  });

  describe('generateRefreshToken()', () => {
    it('should generate a valid JWT refresh token', () => {
      const token = generateRefreshToken(testPayload);
      
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should set token type to "refresh"', () => {
      const token = generateRefreshToken(testPayload);
      const decoded = jwt.decode(token);
      
      expect(decoded.type).toBe('refresh');
    });
  });

  describe('generateTokenPair()', () => {
    it('should return both access and refresh tokens', () => {
      const pair = generateTokenPair(testPayload);
      
      expect(pair).toHaveProperty('accessToken');
      expect(pair).toHaveProperty('refreshToken');
      expect(pair).toHaveProperty('expiresIn');
    });

    it('should return expiresIn as 900 seconds', () => {
      const pair = generateTokenPair(testPayload);
      
      expect(pair.expiresIn).toBe(900);
    });

    it('should generate different tokens for access and refresh', () => {
      const pair = generateTokenPair(testPayload);
      
      expect(pair.accessToken).not.toBe(pair.refreshToken);
    });
  });

  describe('generateToken() (legacy)', () => {
    it('should generate an access token (backward compatibility)', () => {
      const token = generateToken(testPayload);
      const decoded = jwt.decode(token);
      
      expect(decoded.type).toBe('access');
    });
  });

  describe('verifyToken()', () => {
    it('should verify a valid access token', () => {
      const token = generateAccessToken(testPayload);
      const result = verifyToken(token, 'access');
      
      expect(result.valid).toBe(true);
      expect(result.decoded.userId).toBe(123);
    });

    it('should verify a valid refresh token', () => {
      const token = generateRefreshToken(testPayload);
      const result = verifyToken(token, 'refresh');
      
      expect(result.valid).toBe(true);
      expect(result.decoded.userId).toBe(123);
    });

    it('should reject expired tokens', () => {
      const expiredToken = jwt.sign(
        { userId: 123, type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' }
      );
      
      const result = verifyToken(expiredToken, 'access');
      
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('TOKEN_EXPIRED');
    });

    it('should reject invalid tokens', () => {
      const result = verifyToken('invalid-token', 'access');
      
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('TOKEN_INVALID');
    });

    it('should reject token type mismatch', () => {
      const accessToken = generateAccessToken(testPayload);
      const result = verifyToken(accessToken, 'refresh');
      
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('TOKEN_TYPE_MISMATCH');
    });
  });

  describe('decodeToken()', () => {
    it('should decode a token without verification', () => {
      const token = generateAccessToken(testPayload);
      const decoded = decodeToken(token);
      
      expect(decoded.userId).toBe(123);
    });

    it('should return null for invalid tokens', () => {
      const decoded = decodeToken('not-a-valid-token');
      
      expect(decoded).toBeNull();
    });
  });

  describe('isTokenExpiring()', () => {
    it('should return false for fresh token', () => {
      const token = generateAccessToken(testPayload);
      const expiring = isTokenExpiring(token, 60);
      
      expect(expiring).toBe(false);
    });

    it('should return true for token about to expire', () => {
      // Create token that expires in 30 seconds
      const shortToken = jwt.sign(
        { userId: 123, type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: '30s' }
      );
      
      // With 60 second buffer, it should be "expiring"
      const expiring = isTokenExpiring(shortToken, 60);
      
      expect(expiring).toBe(true);
    });

    it('should return true for invalid token', () => {
      const expiring = isTokenExpiring('invalid-token');
      
      expect(expiring).toBe(true);
    });
  });

  describe('getRefreshTokenExpiry()', () => {
    it('should return a date 7 days in the future', () => {
      const expiry = getRefreshTokenExpiry();
      const now = new Date();
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + 7);
      
      expect(expiry).toBeInstanceOf(Date);
      expect(expiry.getTime()).toBeGreaterThan(now.getTime());
      
      // Check it's approximately 7 days (within 1 hour tolerance)
      const diff = Math.abs(expiry.getTime() - expectedDate.getTime());
      expect(diff).toBeLessThan(3600000); // 1 hour in ms
    });
  });

  describe('Constants', () => {
    it('should have correct ACCESS_TOKEN_EXPIRY', () => {
      expect(ACCESS_TOKEN_EXPIRY).toBe('15m');
    });

    it('should have correct REFRESH_TOKEN_EXPIRY', () => {
      expect(REFRESH_TOKEN_EXPIRY).toBe('7d');
    });
  });
});

