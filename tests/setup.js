/**
 * Jest Global Test Setup
 * Runs before all test suites
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Increase default timeout for database operations
jest.setTimeout(30000);

// Suppress console output during tests (optional - comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };

// Global setup before all tests
beforeAll(async () => {
  // Any global initialization
});

// Global teardown after all tests
afterAll(async () => {
  // Cleanup resources
});

// Reset state between tests
beforeEach(() => {
  // Reset mocks
  jest.clearAllMocks();
});

// Custom matchers
expect.extend({
  toBeValidJWT(received) {
    const jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
    const pass = jwtRegex.test(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid JWT`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid JWT`,
        pass: false,
      };
    }
  },
});
