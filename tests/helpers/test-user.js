/**
 * Test User Factory
 *
 * Generates unique test users for each test run using the Gmail + trick.
 * This ensures emails still arrive at your inbox while being unique.
 */

// Default test configuration
const DEFAULT_CONFIG = {
  baseEmail: "haashim.ameer@gmail.com", // Your real email
  phoneNumber: "+14255020361", // Your test phone number
  password: "TestPassword123!",
};

/**
 * Generate a unique test email using Gmail + addressing
 * Emails sent to haashim.ameer+test123@gmail.com arrive at haashim.ameer@gmail.com
 *
 * @param {string} baseEmail - Base Gmail address
 * @returns {string} - Unique email address
 */
const generateTestEmail = (baseEmail = DEFAULT_CONFIG.baseEmail) => {
  const timestamp = Date.now();
  const [localPart, domain] = baseEmail.split("@");
  return `${localPart}+test${timestamp}@${domain}`;
};

/**
 * Create a complete test user object
 *
 * @param {object} overrides - Fields to override
 * @returns {object} - Test user data
 */
const createTestUser = (overrides = {}) => {
  const timestamp = Date.now();
  const email = overrides.email || generateTestEmail();

  return {
    email,
    password: DEFAULT_CONFIG.password,
    firstName: "Test",
    lastName: "Runner",
    phoneNumber: DEFAULT_CONFIG.phoneNumber,
    fitnessGoal: "muscle_gain",
    age: 28,
    weight: 175,
    height: 70,
    gender: "male",
    fitnessLevel: "intermediate",
    preferredLoginMethod: "email",
    ...overrides,
  };
};

/**
 * Create a test user with invalid data for negative tests
 *
 * @param {string} invalidField - Which field to make invalid
 * @returns {object} - Test user with invalid field
 */
const createInvalidTestUser = (invalidField) => {
  const user = createTestUser();

  switch (invalidField) {
    case "email":
      user.email = "invalid-email";
      break;
    case "password":
      user.password = "weak"; // Too short, no uppercase/number/symbol
      break;
    case "phone":
      user.phoneNumber = "12345"; // Invalid format
      break;
    case "noEmail":
      delete user.email;
      break;
    case "noPassword":
      delete user.password;
      break;
    case "noPhone":
      delete user.phoneNumber;
      break;
    default:
      throw new Error(`Unknown invalid field: ${invalidField}`);
  }

  return user;
};

/**
 * Get the test phone number
 * @returns {string} - E.164 formatted phone number
 */
const getTestPhone = () => DEFAULT_CONFIG.phoneNumber;

/**
 * Get the default test password
 * @returns {string} - Test password
 */
const getTestPassword = () => DEFAULT_CONFIG.password;

/**
 * Generate a unique biometric token
 * @returns {string} - Biometric token identifier
 */
const generateBiometricToken = () => `test-biometric-${Date.now()}`;

module.exports = {
  generateTestEmail,
  createTestUser,
  createInvalidTestUser,
  getTestPhone,
  getTestPassword,
  generateBiometricToken,
  DEFAULT_CONFIG,
};

