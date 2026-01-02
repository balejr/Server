/**
 * Jest Global Setup
 *
 * Runs before all test suites
 */

// Load environment variables
require("dotenv").config();

// Increase default timeout for API calls
jest.setTimeout(120000);

// Custom console formatting for test output
const originalConsoleLog = console.log;
console.log = (...args) => {
  // Add timestamp to logs during tests
  const timestamp = new Date().toLocaleTimeString();
  originalConsoleLog(`[${timestamp}]`, ...args);
};

// Global beforeAll - runs once before all tests
beforeAll(async () => {
  console.log("\n");
  console.log("═".repeat(60));
  console.log("         🧪 Starting Test Suite");
  console.log("═".repeat(60));
  console.log(`  Target: ${global.API_BASE_URL || "https://apogeehnp.azurewebsites.net/api"}`);
  console.log("═".repeat(60));
  console.log("\n");
});

// Global afterAll - runs once after all tests
afterAll(async () => {
  console.log("\n");
  console.log("═".repeat(60));
  console.log("         ✅ Test Suite Complete");
  console.log("═".repeat(60));
  console.log("\n");
});

// Custom matchers for API responses
expect.extend({
  /**
   * Check if response is a successful API response
   * Usage: expect(response).toBeSuccessfulResponse()
   */
  toBeSuccessfulResponse(response) {
    const pass =
      response.status >= 200 &&
      response.status < 300 &&
      response.data?.success === true;

    if (pass) {
      return {
        message: () =>
          `expected response not to be successful, but got status ${response.status}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `expected successful response, but got status ${response.status}: ${
            response.data?.message || "No message"
          }`,
        pass: false,
      };
    }
  },

  /**
   * Check if response contains valid auth tokens
   * Usage: expect(response.data).toHaveValidTokens()
   */
  toHaveValidTokens(data) {
    const hasAccessToken =
      typeof data.accessToken === "string" && data.accessToken.length > 0;
    const hasRefreshToken =
      typeof data.refreshToken === "string" && data.refreshToken.length > 0;

    if (hasAccessToken && hasRefreshToken) {
      return {
        message: () => `expected response not to have valid tokens`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `expected response to have valid tokens, but got accessToken: ${
            hasAccessToken ? "valid" : "missing/invalid"
          }, refreshToken: ${hasRefreshToken ? "valid" : "missing/invalid"}`,
        pass: false,
      };
    }
  },

  /**
   * Check if response has specific error code
   * Usage: expect(response.data).toHaveErrorCode('LOGGED_IN_ELSEWHERE')
   */
  toHaveErrorCode(data, expectedCode) {
    const pass = data.errorCode === expectedCode;

    if (pass) {
      return {
        message: () =>
          `expected response not to have error code ${expectedCode}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `expected error code ${expectedCode}, but got ${
            data.errorCode || "none"
          }`,
        pass: false,
      };
    }
  },
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

