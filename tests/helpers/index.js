/**
 * Test Helpers Index
 *
 * Re-exports all helpers for convenient importing
 */

const {
  api,
  request,
  authRequest,
  getState,
  setState,
  clearState,
  API_BASE_URL,
} = require("./api-client");

const {
  createTestUser,
  createInvalidTestUser,
  generateTestEmail,
  getTestPhone,
  getTestPassword,
  generateBiometricToken,
} = require("./test-user");

const {
  cleanupTestUser,
  cleanupTestUserByEmail,
  findUserIdByEmail,
} = require("./db-cleanup");

const {
  prompt,
  askForOTP,
  askYesNo,
  section,
  success,
  failure,
  info,
  warning,
} = require("./prompts");

module.exports = {
  // API Client
  api,
  request,
  authRequest,
  getState,
  setState,
  clearState,
  API_BASE_URL,

  // Test User Factory
  createTestUser,
  createInvalidTestUser,
  generateTestEmail,
  getTestPhone,
  getTestPassword,
  generateBiometricToken,

  // Database Cleanup
  cleanupTestUser,
  cleanupTestUserByEmail,
  findUserIdByEmail,

  // Interactive Prompts
  prompt,
  askForOTP,
  askYesNo,
  section,
  success,
  failure,
  info,
  warning,
};

