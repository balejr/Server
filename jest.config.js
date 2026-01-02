/**
 * Jest Configuration for ApogeeHnP Backend
 */

module.exports = {
  // Use Node.js test environment
  testEnvironment: 'node',
  
  // Coverage configuration
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'routes/**/*.js',
    'utils/**/*.js',
    'middleware/**/*.js',
    '!**/node_modules/**',
    '!coverage/**'
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 40,
      functions: 50,
      lines: 50
    }
  },
  
  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/coverage/',
    'tests/auth-api.test.js',           // Legacy standalone test
    'tests/subscription-management.test.js'  // Legacy standalone test
  ],
  
  // Setup files
  setupFilesAfterEnv: ['./tests/setup.js'],
  
  // Timeout for async tests
  testTimeout: 30000,
  
  // Verbose output
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Force exit after tests complete (useful for database connections)
  forceExit: true,
  
  // Detect open handles (connections, timers)
  detectOpenHandles: true,
  
  // Module name mapper for aliases (if needed)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1'
  }
};

