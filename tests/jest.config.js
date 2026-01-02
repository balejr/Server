/**
 * Jest Configuration
 *
 * Run tests with: npm test
 * Run specific suite: npm test -- auth-basic
 */

module.exports = {
  // Root directory for tests (relative to this config file's location)
  rootDir: __dirname,

  // Use Node.js environment (not browser)
  testEnvironment: "node",

  // Look for test files in these locations
  testMatch: [
    "**/integration/**/*.test.js",
    "**/e2e/**/*.test.js",
  ],

  // Ignore these paths
  testPathIgnorePatterns: [
    "/node_modules/",
    "auth-api.test.js", // Legacy test file
    "subscription-management.test.js", // Legacy test file
  ],

  // Setup file to run before tests
  setupFilesAfterEnv: ["<rootDir>/setup.js"],

  // Longer timeout for API calls and interactive prompts
  testTimeout: 120000, // 2 minutes per test

  // Verbose output
  verbose: true,

  // Force exit after tests complete (handles open handles)
  forceExit: true,

  // Detect open handles (useful for debugging)
  detectOpenHandles: true,

  // Run tests sequentially (required for interactive prompts and shared state)
  maxWorkers: 1,

  // Custom reporters for nice output
  reporters: [
    "default",
    [
      "jest-html-reporters",
      {
        publicPath: "./reports",
        filename: "test-report.html",
        expand: true,
      },
    ],
  ].filter((r) => {
    // Only use HTML reporter if installed
    if (Array.isArray(r) && r[0] === "jest-html-reporters") {
      try {
        require.resolve("jest-html-reporters");
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }),

  // Global variables available in all tests
  globals: {
    API_BASE_URL: "https://apogeehnp.azurewebsites.net/api",
  },
};
