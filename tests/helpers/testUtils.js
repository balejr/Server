/**
 * Test Utilities and Helpers
 * Common functions used across test suites
 */

const jwt = require('jsonwebtoken');

// Test constants
const TEST_SECRET = 'test-jwt-secret-for-testing-only';
const TEST_REFRESH_SECRET = 'test-refresh-secret-for-testing-only';

/**
 * Generate a valid test JWT token
 * @param {Object} payload - Token payload
 * @param {Object} options - Token options
 * @returns {string} JWT token
 */
const generateTestToken = (payload = {}, options = {}) => {
  const defaultPayload = {
    userId: 1,
    email: 'test@example.com',
    iat: Math.floor(Date.now() / 1000),
  };
  
  return jwt.sign(
    { ...defaultPayload, ...payload },
    options.secret || TEST_SECRET,
    { expiresIn: options.expiresIn || '1h' }
  );
};

/**
 * Generate an expired test token
 * @param {Object} payload - Token payload
 * @returns {string} Expired JWT token
 */
const generateExpiredToken = (payload = {}) => {
  const defaultPayload = {
    userId: 1,
    email: 'test@example.com',
    iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
    exp: Math.floor(Date.now() / 1000) - 3600,  // 1 hour ago
  };
  
  return jwt.sign(
    { ...defaultPayload, ...payload },
    TEST_SECRET,
    { noTimestamp: true }
  );
};

/**
 * Generate a refresh token
 * @param {Object} payload - Token payload
 * @returns {string} Refresh token
 */
const generateRefreshToken = (payload = {}) => {
  const defaultPayload = {
    userId: 1,
    type: 'refresh',
  };
  
  return jwt.sign(
    { ...defaultPayload, ...payload },
    TEST_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
};

/**
 * Create authorization header
 * @param {string} token - JWT token
 * @returns {Object} Headers object with Authorization
 */
const authHeader = (token) => ({
  Authorization: `Bearer ${token}`,
});

/**
 * Generate random test email
 * @returns {string} Random email address
 */
const randomEmail = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `test-${timestamp}-${random}@example.com`;
};

/**
 * Generate random phone number
 * @returns {string} Random E.164 phone number
 */
const randomPhone = () => {
  const random = Math.floor(Math.random() * 9000000000) + 1000000000;
  return `+1${random}`;
};

/**
 * Generate valid password
 * @returns {string} Valid password meeting requirements
 */
const validPassword = () => 'TestPassword123!';

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after delay
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Assert response has success structure
 * @param {Object} response - Supertest response
 * @param {boolean} expectedSuccess - Expected success value
 */
const expectSuccessResponse = (response, expectedSuccess = true) => {
  expect(response.body).toHaveProperty('success', expectedSuccess);
};

/**
 * Assert response has error structure
 * @param {Object} response - Supertest response
 * @param {number} statusCode - Expected status code
 */
const expectErrorResponse = (response, statusCode) => {
  expect(response.status).toBe(statusCode);
  expect(response.body.success).toBe(false);
};

/**
 * Assert response contains valid tokens
 * @param {Object} response - Supertest response
 */
const expectValidTokens = (response) => {
  expect(response.body).toHaveProperty('accessToken');
  expect(response.body).toHaveProperty('refreshToken');
  expect(response.body.accessToken).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/);
  expect(response.body.refreshToken).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/);
};

module.exports = {
  TEST_SECRET,
  TEST_REFRESH_SECRET,
  generateTestToken,
  generateExpiredToken,
  generateRefreshToken,
  authHeader,
  randomEmail,
  randomPhone,
  validPassword,
  sleep,
  expectSuccessResponse,
  expectErrorResponse,
  expectValidTokens,
};

