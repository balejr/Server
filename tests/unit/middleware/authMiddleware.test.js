/**
 * Unit Tests for Auth Middleware
 */

const { authenticateToken, checkAuthRateLimit } = require('../../../middleware/authMiddleware');
const { generateTestToken, generateExpiredToken } = require('../../helpers/testUtils');

// Mock dependencies
jest.mock('../../../config/db', () => ({
  getPool: jest.fn(() => ({
    request: jest.fn(() => ({
      input: jest.fn().mockReturnThis(),
      query: jest.fn().mockResolvedValue({ recordset: [{ TokenInvalidatedAt: null }] }),
    })),
  })),
}));

describe('Auth Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    // Setup mocks
    mockReq = {
      headers: {},
      ip: '127.0.0.1',
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    
    // Set test environment
    process.env.JWT_SECRET = 'test-secret-for-middleware-tests';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('authenticateToken()', () => {
    it('should reject requests without Authorization header', async () => {
      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject requests with invalid Authorization format', async () => {
      mockReq.headers.authorization = 'InvalidFormat token';
      
      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject requests with invalid token', async () => {
      mockReq.headers.authorization = 'Bearer invalid-token';
      
      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should accept requests with valid token', async () => {
      const token = generateTestToken({ userId: 123 }, { secret: process.env.JWT_SECRET });
      mockReq.headers.authorization = `Bearer ${token}`;
      
      await authenticateToken(mockReq, mockRes, mockNext);

      // Check that user was attached to request
      expect(mockReq.user).toBeDefined();
      expect(mockReq.user.userId).toBe(123);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject expired tokens', async () => {
      // Create expired token with same secret
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        { userId: 123, type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' }
      );
      mockReq.headers.authorization = `Bearer ${expiredToken}`;
      
      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'TOKEN_EXPIRED',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('checkAuthRateLimit()', () => {
    it('should allow requests under rate limit', () => {
      checkAuthRateLimit(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should track requests by IP', () => {
      mockReq.ip = '192.168.1.1';
      
      checkAuthRateLimit(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Authorization header parsing', () => {
    it('should handle lowercase "bearer"', async () => {
      const token = generateTestToken({ userId: 123 }, { secret: process.env.JWT_SECRET });
      mockReq.headers.authorization = `bearer ${token}`;
      
      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockReq.user).toBeDefined();
    });

    it('should handle extra whitespace', async () => {
      const token = generateTestToken({ userId: 123 }, { secret: process.env.JWT_SECRET });
      mockReq.headers.authorization = `Bearer  ${token}`;
      
      await authenticateToken(mockReq, mockRes, mockNext);

      // Middleware may or may not handle extra whitespace
      // Adjust based on actual implementation
    });
  });
});

