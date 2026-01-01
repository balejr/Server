/**
 * Auth API Test Suite
 *
 * Tests all authentication endpoints against production Azure server.
 * Follows the flow from POSTMAN_TESTING_GUIDE.md
 *
 * Run: node tests/auth-api.test.js
 */

const axios = require("axios");
const readline = require("readline");
const sql = require("mssql");

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_BASE_URL = "https://apogeehnp.azurewebsites.net/api";

// Database configuration for direct cleanup
const DB_CONFIG = {
  user: "ApogeeDev_Haashim",
  password: "SecurePassword123",
  server: "apogeehnp.database.windows.net",
  database: "ApogeeFit",
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};
const TEST_PHONE = "+14255020361";
const TEST_PASSWORD = "TestPassword123!";

// Generate unique email using Gmail + trick (emails still arrive at your inbox)
const timestamp = Date.now();
const TEST_EMAIL = `haashim.ameer+test${timestamp}@gmail.com`;

// Test user data
const TEST_USER = {
  email: TEST_EMAIL,
  password: TEST_PASSWORD,
  firstName: "Test",
  lastName: "Runner",
  phoneNumber: TEST_PHONE,
  fitnessGoal: "muscle_gain",
  age: 28,
  weight: 175,
  height: 70,
  gender: "male",
  fitnessLevel: "intermediate",
  preferredLoginMethod: "email",
};

// ============================================================================
// STATE (populated during test run)
// ============================================================================

let accessToken = null;
let refreshToken = null;
let userId = null;
let mfaSessionToken = null;
let biometricToken = `test-biometric-${timestamp}`;
let currentPassword = TEST_PASSWORD; // Track current password (may change during password reset test)

// ============================================================================
// UTILITIES
// ============================================================================

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(message) {
  console.log(message);
}

function pass(testName, duration) {
  log(
    `  ${colors.green}[PASS]${colors.reset} ${testName} ${colors.dim}(${duration}ms)${colors.reset}`
  );
}

function fail(testName, reason) {
  log(`  ${colors.red}[FAIL]${colors.reset} ${testName}`);
  log(`         ${colors.red}→ ${reason}${colors.reset}`);
}

function skip(testName, reason) {
  log(`  ${colors.yellow}[SKIP]${colors.reset} ${testName} - ${reason}`);
}

function section(title) {
  log(`\n${colors.cyan}▶ ${title}${colors.reset}`);
}

// Prompt user for input (for OTP codes)
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `\n  ${colors.yellow}>> ${question}: ${colors.reset}`,
      (answer) => {
        rl.close();
        resolve(answer.trim());
      }
    );
  });
}

// Make API request with timing
async function request(method, endpoint, data = null, headers = {}) {
  const start = Date.now();
  const config = {
    method,
    url: `${API_BASE_URL}${endpoint}`,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    validateStatus: () => true, // Don't throw on non-2xx
  };

  if (data) {
    config.data = data;
  }

  const response = await axios(config);
  const duration = Date.now() - start;

  return { response, duration };
}

// Auth header helper
function authHeader() {
  return { Authorization: `Bearer ${accessToken}` };
}

// ============================================================================
// TEST RESULTS TRACKING
// ============================================================================

const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  failures: [],
};

function recordPass(name, duration) {
  results.passed++;
  pass(name, duration);
}

function recordFail(name, reason) {
  results.failed++;
  results.failures.push({ name, reason });
  fail(name, reason);
}

function recordSkip(name, reason) {
  results.skipped++;
  skip(name, reason);
}

// ============================================================================
// TESTS
// ============================================================================

// --- Health Check ---
async function testHealthCheck() {
  section("Health Check");

  // Test root endpoint
  try {
    const { response, duration } = await request("GET", "/../");
    if (response.status === 200) {
      recordPass("Server is running", duration);
    } else {
      recordFail("Server is running", `Expected 200, got ${response.status}`);
    }
  } catch (e) {
    recordFail("Server is running", e.message);
  }

  // Test version endpoint
  try {
    const { response, duration } = await request("GET", "/version");
    if (response.status === 200 && response.data.version) {
      recordPass(`Version endpoint (${response.data.version})`, duration);
    } else {
      recordFail("Version endpoint", `Expected version in response`);
    }
  } catch (e) {
    recordFail("Version endpoint", e.message);
  }
}

// --- Step 1: Check Email Exists ---
async function testCheckEmailNotExists() {
  section("Step 1: Check Email Exists (Before Signup)");

  try {
    const { response, duration } = await request(
      "GET",
      `/auth/checkemail?email=${encodeURIComponent(TEST_EMAIL)}`
    );

    if (response.status === 200 && response.data.exists === false) {
      recordPass("Email does not exist yet", duration);
      return true;
    } else if (response.data.exists === true) {
      recordFail(
        "Email check",
        "Email already exists - try running again with a fresh timestamp"
      );
      return false;
    } else {
      recordFail(
        "Email check",
        `Unexpected response: ${JSON.stringify(response.data)}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Email check", e.message);
    return false;
  }
}

// --- Step 2: Sign Up ---
async function testSignup() {
  section("Step 2: Sign Up");

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/signup",
      TEST_USER
    );

    if (response.status === 200 && response.data.success === true) {
      // Validate required fields
      if (!response.data.accessToken) {
        recordFail("Signup", "Missing accessToken in response");
        return false;
      }
      if (!response.data.refreshToken) {
        recordFail("Signup", "Missing refreshToken in response");
        return false;
      }
      if (!response.data.userId && !response.data.user?.id) {
        recordFail("Signup", "Missing userId in response");
        return false;
      }

      // Store tokens for later tests
      accessToken = response.data.accessToken;
      refreshToken = response.data.refreshToken;
      userId = response.data.userId || response.data.user?.id;

      recordPass("Account created successfully", duration);
      log(`         User ID: ${userId}`);
      return true;
    } else {
      recordFail(
        "Signup",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Signup", e.message);
    return false;
  }
}

// --- Step 3: Sign In ---
async function testSignin() {
  section("Step 3: Sign In");

  try {
    const { response, duration } = await request("POST", "/auth/signin", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    if (response.status === 200 && response.data.success === true) {
      // Check for MFA required response
      if (response.data.mfaRequired) {
        recordPass("Signin - MFA required (as expected)", duration);
        mfaSessionToken = response.data.mfaSessionToken;
        return "mfa_required";
      }

      // Validate tokens
      if (!response.data.accessToken || !response.data.refreshToken) {
        recordFail("Signin", "Missing tokens in response");
        return false;
      }

      // Update tokens
      accessToken = response.data.accessToken;
      refreshToken = response.data.refreshToken;

      recordPass("Signin successful", duration);
      return true;
    } else {
      recordFail(
        "Signin",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Signin", e.message);
    return false;
  }
}

// --- Step 4: Get Auth Status ---
async function testAuthStatus() {
  section("Step 4: Get Auth Status");

  try {
    const { response, duration } = await request(
      "GET",
      "/auth/status",
      null,
      authHeader()
    );

    if (response.status === 200 && response.data.success === true) {
      const status = response.data.authStatus;
      if (status && status.email) {
        recordPass("Auth status retrieved", duration);
        log(`         Email: ${status.email}`);
        log(`         Phone Verified: ${status.phoneVerified}`);
        log(`         MFA Enabled: ${status.mfaEnabled}`);
        return true;
      } else {
        recordFail("Auth status", "Missing authStatus in response");
        return false;
      }
    } else if (response.status === 401) {
      recordFail("Auth status", "Unauthorized - token may be invalid");
      return false;
    } else {
      recordFail(
        "Auth status",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Auth status", e.message);
    return false;
  }
}

// --- Step 5: Refresh Token ---
async function testRefreshToken() {
  section("Step 5: Refresh Token");

  const oldAccessToken = accessToken;

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/refresh-token",
      {
        refreshToken: refreshToken,
      }
    );

    if (response.status === 200 && response.data.success === true) {
      if (!response.data.accessToken || !response.data.refreshToken) {
        recordFail("Refresh token", "Missing new tokens in response");
        return false;
      }

      // Verify we got a NEW token
      if (response.data.accessToken === oldAccessToken) {
        recordFail(
          "Refresh token",
          "Got same access token back (should be new)"
        );
        return false;
      }

      // Update tokens
      accessToken = response.data.accessToken;
      refreshToken = response.data.refreshToken;

      recordPass("Token refreshed successfully", duration);
      return true;
    } else {
      recordFail(
        "Refresh token",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Refresh token", e.message);
    return false;
  }
}

// --- Step 7: Check Phone Exists ---
async function testCheckPhone() {
  section("Step 7: Check Phone Exists");

  try {
    const { response, duration } = await request(
      "GET",
      `/auth/checkphone?phoneNumber=${encodeURIComponent(TEST_PHONE)}`
    );

    if (response.status === 200) {
      recordPass(`Phone check (exists: ${response.data.exists})`, duration);
      return true;
    } else {
      recordFail(
        "Phone check",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Phone check", e.message);
    return false;
  }
}

// --- Step 8: Send Phone OTP (Multiple Purposes) ---
async function testSendPhoneOtp() {
  section("Step 8: Send Phone OTP (Multiple Purposes)");

  // Track which purpose succeeded for verification test later
  let lastSuccessfulPurpose = null;

  // Test multiple purposes - for phone, 'verification' is valid for existing users
  // because it's used for verifying phone number ownership (not signup)
  const purposesToTest = ["signin", "verification", "mfa"];

  for (const purpose of purposesToTest) {
    try {
      const { response, duration } = await request(
        "POST",
        "/auth/send-phone-otp",
        {
          phoneNumber: TEST_PHONE,
          purpose: purpose,
        }
      );

      if (response.status === 200 && response.data.success === true) {
        recordPass(`Phone OTP sent (purpose: ${purpose})`, duration);
        if (response.data.remainingAttempts !== undefined) {
          log(
            `         Remaining attempts: ${response.data.remainingAttempts}`
          );
        }
        lastSuccessfulPurpose = purpose;
      } else {
        recordFail(
          `Send phone OTP (purpose: ${purpose})`,
          response.data.message || `Status: ${response.status}`
        );
      }
    } catch (e) {
      recordFail(`Send phone OTP (purpose: ${purpose})`, e.message);
    }
  }

  return lastSuccessfulPurpose !== null;
}

// --- Step 9: Verify Phone OTP ---
async function testVerifyPhoneOtp() {
  section("Step 9: Verify Phone OTP");

  const code = await prompt("Enter the 6-digit code from your phone");

  if (!code || code.length !== 6) {
    recordSkip("Verify phone OTP", "Invalid or no code entered");
    return false;
  }

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/verify-phone-otp",
      {
        phoneNumber: TEST_PHONE,
        code: code,
        purpose: "verification",
      }
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("Phone verified", duration);
      return true;
    } else {
      recordFail(
        "Verify phone OTP",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Verify phone OTP", e.message);
    return false;
  }
}

// --- Step 10: Send Email OTP (Multiple Purposes) ---
async function testSendEmailOtp() {
  section("Step 10: Send Email OTP (Multiple Purposes)");

  // Track which purpose succeeded for verification test later
  let lastSuccessfulPurpose = null;

  // Test purposes valid for existing/registered users
  const validPurposes = ["signin", "mfa", "password_reset"];

  for (const purpose of validPurposes) {
    try {
      const { response, duration } = await request(
        "POST",
        "/auth/send-email-otp",
        {
          email: TEST_EMAIL,
          purpose: purpose,
        }
      );

      if (response.status === 200 && response.data.success === true) {
        recordPass(`Email OTP sent (purpose: ${purpose})`, duration);
        lastSuccessfulPurpose = purpose;
      } else {
        recordFail(
          `Send email OTP (purpose: ${purpose})`,
          response.data.message || `Status: ${response.status}`
        );
      }
    } catch (e) {
      recordFail(`Send email OTP (purpose: ${purpose})`, e.message);
    }
  }

  // Test that 'verification' purpose is correctly REJECTED for existing user
  try {
    const { response, duration } = await request(
      "POST",
      "/auth/send-email-otp",
      {
        email: TEST_EMAIL,
        purpose: "verification",
      }
    );

    if (response.status === 409) {
      recordPass(
        "Email OTP correctly rejected verification for existing user",
        duration
      );
    } else if (response.status === 200) {
      recordFail(
        "Email OTP verification rejection",
        "Should reject verification purpose for existing user, but got 200"
      );
    } else {
      recordFail(
        "Email OTP verification rejection",
        `Expected 409, got ${response.status}: ${response.data.message}`
      );
    }
  } catch (e) {
    recordFail("Email OTP verification rejection", e.message);
  }

  return lastSuccessfulPurpose !== null;
}

// --- Step 11: Verify Email OTP ---
async function testVerifyEmailOtp() {
  section("Step 11: Verify Email OTP");

  const code = await prompt("Enter the 6-digit code from your email");

  if (!code || code.length !== 6) {
    recordSkip("Verify email OTP", "Invalid or no code entered");
    return false;
  }

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/verify-email-otp",
      {
        email: TEST_EMAIL,
        code: code,
        purpose: "verification",
      }
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("Email verified", duration);
      return true;
    } else {
      recordFail(
        "Verify email OTP",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Verify email OTP", e.message);
    return false;
  }
}

// --- Step 19: Forgot Password ---
async function testForgotPassword() {
  section("Step 19: Forgot Password");

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/forgot-password",
      {
        email: TEST_EMAIL,
      }
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("Forgot password email sent", duration);
      return true;
    } else {
      recordFail(
        "Forgot password",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Forgot password", e.message);
    return false;
  }
}

// --- Step 22: Enable Biometric ---
async function testEnableBiometric() {
  section("Step 22: Enable Biometric");

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/enable-biometric",
      {
        biometricToken: biometricToken,
      },
      authHeader()
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("Biometric enabled", duration);
      return true;
    } else {
      recordFail(
        "Enable biometric",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Enable biometric", e.message);
    return false;
  }
}

// --- Step 23: Biometric Login ---
async function testBiometricLogin() {
  section("Step 23: Biometric Login");

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/biometric-login",
      {
        userId: userId,
        biometricToken: biometricToken,
      }
    );

    if (response.status === 200 && response.data.success === true) {
      if (!response.data.accessToken || !response.data.refreshToken) {
        recordFail("Biometric login", "Missing tokens in response");
        return false;
      }

      // Update tokens
      accessToken = response.data.accessToken;
      refreshToken = response.data.refreshToken;

      recordPass("Biometric login successful", duration);
      return true;
    } else {
      recordFail(
        "Biometric login",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Biometric login", e.message);
    return false;
  }
}

// --- Step 24: Disable Biometric ---
async function testDisableBiometric() {
  section("Step 24: Disable Biometric");

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/disable-biometric",
      {},
      authHeader()
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("Biometric disabled", duration);
      return true;
    } else {
      recordFail(
        "Disable biometric",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Disable biometric", e.message);
    return false;
  }
}

// --- Update Login Preference ---
async function testUpdateLoginPreference() {
  section("Utility: Update Login Preference");

  try {
    const { response, duration } = await request(
      "PATCH",
      "/auth/update-login-preference",
      {
        preferredLoginMethod: "phone",
      },
      authHeader()
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("Login preference updated to phone", duration);
      return true;
    } else {
      recordFail(
        "Update login preference",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Update login preference", e.message);
    return false;
  }
}

// --- Update Profile ---
async function testUpdateProfile() {
  section("Utility: Update Profile");

  try {
    // FIXED: Use PATCH instead of PUT, and lowercase field names
    const { response, duration } = await request(
      "PATCH",
      `/auth/update-profile/${userId}`,
      {
        firstname: "TestUpdated", // lowercase (API expects lowercase)
        lastname: "RunnerUpdated", // lowercase (API expects lowercase)
      },
      authHeader()
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("Profile updated", duration);
      return true;
    } else {
      recordFail(
        "Update profile",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Update profile", e.message);
    return false;
  }
}

// --- Step 6: Logout ---
async function testLogout() {
  section("Step 6: Logout");

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/logout",
      {},
      authHeader()
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("Logged out successfully", duration);
      return true;
    } else {
      recordFail(
        "Logout",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Logout", e.message);
    return false;
  }
}

// --- Verify Token Invalidated After Logout ---
async function testTokenInvalidAfterLogout() {
  section("Security: Verify Token Invalid After Logout");

  try {
    const { response, duration } = await request(
      "GET",
      "/auth/status",
      null,
      authHeader()
    );

    if (response.status === 401) {
      recordPass("Token correctly invalidated after logout", duration);
      return true;
    } else {
      recordFail("Token invalidation", `Expected 401, got ${response.status}`);
      return false;
    }
  } catch (e) {
    recordFail("Token invalidation", e.message);
    return false;
  }
}

// ============================================================================
// SECURITY VALIDATION TESTS (from ERRORS_TO_FIX.md)
// ============================================================================

// --- Security: Phone Number Required at Signup (Issue #3) ---
async function testSignupWithoutPhone() {
  section("Security: Phone Number Required at Signup");

  try {
    const userWithoutPhone = {
      email: `test-nophone-${Date.now()}@example.com`,
      password: TEST_PASSWORD,
      firstName: "Test",
      lastName: "NoPhone",
      // phoneNumber intentionally omitted
      fitnessGoal: "muscle_gain",
      age: 28,
      weight: 175,
      height: 70,
      gender: "male",
      fitnessLevel: "intermediate",
    };

    const { response, duration } = await request(
      "POST",
      "/auth/signup",
      userWithoutPhone
    );

    if (response.status === 400) {
      recordPass("Signup correctly rejected without phone number", duration);
      return true;
    } else if (response.status === 200) {
      recordFail(
        "Signup phone validation",
        "Should reject signup without phone, but got 200"
      );
      return false;
    } else {
      recordFail(
        "Signup phone validation",
        `Expected 400, got ${response.status}: ${response.data.message}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Signup phone validation", e.message);
    return false;
  }
}

// --- Security: Email Case Insensitive Signin (Issue #7) ---
async function testSigninCaseInsensitive() {
  section("Security: Email Case Insensitive Signin");

  // Convert email to uppercase for test
  const uppercaseEmail = TEST_EMAIL.toUpperCase();

  try {
    const { response, duration } = await request("POST", "/auth/signin", {
      email: uppercaseEmail,
      password: TEST_PASSWORD,
    });

    if (response.status === 200 && response.data.success === true) {
      // Update tokens if we got them
      if (response.data.accessToken) {
        accessToken = response.data.accessToken;
        refreshToken = response.data.refreshToken;
      }
      recordPass(
        `Signin works with uppercase email (${uppercaseEmail})`,
        duration
      );
      return true;
    } else if (response.data.mfaRequired) {
      recordPass(
        "Signin with uppercase email triggered MFA (as expected)",
        duration
      );
      return true;
    } else {
      recordFail(
        "Case insensitive signin",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Case insensitive signin", e.message);
    return false;
  }
}

// --- Security: Duplicate Email Case Insensitive Check (Issue #10) ---
async function testSignupDuplicateCaseInsensitive() {
  section("Security: Duplicate Email Case Insensitive Check");

  // Try to sign up with same email but different case
  const mixedCaseEmail =
    TEST_EMAIL.charAt(0).toUpperCase() + TEST_EMAIL.slice(1).toLowerCase();

  try {
    const duplicateUser = {
      ...TEST_USER,
      email: mixedCaseEmail,
    };

    const { response, duration } = await request(
      "POST",
      "/auth/signup",
      duplicateUser
    );

    if (response.status === 409) {
      recordPass(
        "Signup correctly rejected duplicate email (case-insensitive)",
        duration
      );
      return true;
    } else if (response.status === 200) {
      recordFail(
        "Duplicate email check",
        `Should reject duplicate email ${mixedCaseEmail}, but got 200`
      );
      return false;
    } else {
      recordFail(
        "Duplicate email check",
        `Expected 409, got ${response.status}: ${response.data.message}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Duplicate email check", e.message);
    return false;
  }
}

// --- Security: Profile Update Authorization (Issue #12) ---
async function testProfileUpdateUnauthorized() {
  section("Security: Profile Update Authorization");

  // Test 1: Try updating another user's profile
  try {
    const { response, duration } = await request(
      "PATCH",
      `/auth/update-profile/99999`, // Non-existent or different user
      {
        firstname: "Hacker",
        lastname: "Attempt",
      },
      authHeader()
    );

    if (response.status === 403) {
      recordPass("Profile update correctly rejected for wrong user", duration);
    } else if (response.status === 200) {
      recordFail(
        "Profile auth check (wrong user)",
        "Should reject update for different user, but got 200"
      );
    } else {
      // 404 is also acceptable if user doesn't exist
      if (response.status === 404) {
        recordPass("Profile update rejected (user not found)", duration);
      } else {
        recordFail(
          "Profile auth check (wrong user)",
          `Expected 403 or 404, got ${response.status}`
        );
      }
    }
  } catch (e) {
    recordFail("Profile auth check (wrong user)", e.message);
  }

  // Test 2: Try updating without auth token
  try {
    const { response, duration } = await request(
      "PATCH",
      `/auth/update-profile/${userId}`,
      {
        firstname: "NoAuth",
        lastname: "Test",
      }
      // No auth header
    );

    if (response.status === 401) {
      recordPass("Profile update correctly rejected without auth", duration);
      return true;
    } else if (response.status === 200) {
      recordFail(
        "Profile auth check (no token)",
        "Should reject update without auth, but got 200"
      );
      return false;
    } else {
      recordFail(
        "Profile auth check (no token)",
        `Expected 401, got ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Profile auth check (no token)", e.message);
    return false;
  }
}

// --- Security: Logged In Elsewhere Detection (Issue #8) ---
async function testLoggedInElsewhere() {
  section("Security: Logged In Elsewhere Detection");

  // Save current refresh token as "Device A"
  const deviceARefreshToken = refreshToken;

  // Login again to simulate "Device B" - this invalidates Device A's token
  try {
    const { response: signinResponse } = await request("POST", "/auth/signin", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    if (signinResponse.status === 200 && signinResponse.data.accessToken) {
      // Device B now has valid tokens
      accessToken = signinResponse.data.accessToken;
      refreshToken = signinResponse.data.refreshToken;

      // Now try to refresh with Device A's old token
      const { response, duration } = await request(
        "POST",
        "/auth/refresh-token",
        {
          refreshToken: deviceARefreshToken,
        }
      );

      if (
        response.status === 401 &&
        response.data.errorCode === "LOGGED_IN_ELSEWHERE"
      ) {
        recordPass("Correctly detected logged in elsewhere", duration);
        return true;
      } else if (response.status === 401) {
        // Token invalid is also acceptable (might show different error)
        recordPass(
          `Old token rejected (${response.data.errorCode || "TOKEN_INVALID"})`,
          duration
        );
        return true;
      } else if (response.status === 200) {
        recordFail(
          "Logged in elsewhere detection",
          "Old refresh token should be invalid, but got 200"
        );
        return false;
      } else {
        recordFail(
          "Logged in elsewhere detection",
          `Expected 401, got ${response.status}: ${response.data.message}`
        );
        return false;
      }
    } else if (signinResponse.data.mfaRequired) {
      recordSkip("Logged in elsewhere detection", "MFA enabled - cannot test");
      return false;
    } else {
      recordFail(
        "Logged in elsewhere detection",
        `Second signin failed: ${signinResponse.data.message}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Logged in elsewhere detection", e.message);
    return false;
  }
}

// ============================================================================
// MFA FLOW TESTS (Steps 13-18 from Postman Guide)
// ============================================================================

// --- MFA: Setup MFA with SMS ---
async function testSetupMFA() {
  section("MFA: Setup MFA with SMS");

  try {
    // First, just initiate setup (sends verification code)
    const { response, duration } = await request(
      "POST",
      "/auth/setup-mfa",
      {
        method: "sms",
      },
      authHeader()
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("MFA setup initiated (code sent)", duration);
      return true;
    } else {
      recordFail(
        "MFA setup",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("MFA setup", e.message);
    return false;
  }
}

// --- MFA: Complete Setup with Code ---
async function testCompleteMFASetup() {
  section("MFA: Complete Setup with Code");

  const code = await prompt("Enter the 6-digit MFA setup code from your phone");

  if (!code || code.length !== 6) {
    recordSkip("MFA setup completion", "Invalid or no code entered");
    return false;
  }

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/setup-mfa",
      {
        method: "sms",
        code: code,
      },
      authHeader()
    );

    if (response.status === 200 && response.data.mfaEnabled === true) {
      recordPass("MFA enabled successfully", duration);
      return true;
    } else if (response.status === 200 && response.data.success === true) {
      recordPass("MFA setup completed", duration);
      return true;
    } else {
      recordFail(
        "MFA setup completion",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("MFA setup completion", e.message);
    return false;
  }
}

// --- MFA: Signin with MFA Enabled ---
async function testSigninWithMFA() {
  section("MFA: Signin with MFA Enabled");

  try {
    const { response, duration } = await request("POST", "/auth/signin", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    if (response.status === 200 && response.data.mfaRequired === true) {
      mfaSessionToken = response.data.mfaSessionToken;
      recordPass("Signin returned MFA challenge", duration);
      log(
        `         MFA Session Token: ${
          mfaSessionToken ? "received" : "missing"
        }`
      );
      log(`         User ID: ${response.data.userId}`);
      return true;
    } else if (response.status === 200 && response.data.accessToken) {
      recordFail(
        "MFA signin",
        "Expected MFA challenge but got direct login (MFA may not be enabled)"
      );
      // Still update tokens
      accessToken = response.data.accessToken;
      refreshToken = response.data.refreshToken;
      return false;
    } else {
      recordFail(
        "MFA signin",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("MFA signin", e.message);
    return false;
  }
}

// --- MFA: Send MFA Code ---
async function testSendMFACode() {
  section("MFA: Send MFA Code");

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/send-mfa-code",
      {
        userId: userId,
        method: "sms",
      }
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("MFA code sent", duration);
      return true;
    } else {
      recordFail(
        "Send MFA code",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Send MFA code", e.message);
    return false;
  }
}

// --- MFA: Verify MFA Login ---
async function testVerifyMFALogin() {
  section("MFA: Verify MFA Login");

  const code = await prompt("Enter the 6-digit MFA code from your phone");

  if (!code || code.length !== 6) {
    recordSkip("MFA verification", "Invalid or no code entered");
    return false;
  }

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/verify-mfa-login",
      {
        userId: userId,
        mfaSessionToken: mfaSessionToken,
        code: code,
        method: "sms",
      }
    );

    if (response.status === 200 && response.data.success === true) {
      if (response.data.accessToken) {
        accessToken = response.data.accessToken;
        refreshToken = response.data.refreshToken;
      }
      recordPass("MFA verification successful", duration);
      return true;
    } else {
      recordFail(
        "MFA verification",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("MFA verification", e.message);
    return false;
  }
}

// --- MFA: Disable MFA ---
async function testDisableMFA() {
  section("MFA: Disable MFA");

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/disable-mfa",
      {},
      authHeader()
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("MFA disabled successfully", duration);
      return true;
    } else {
      recordFail(
        "Disable MFA",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Disable MFA", e.message);
    return false;
  }
}

// ============================================================================
// NEGATIVE/ERROR CASE TESTS
// ============================================================================

// --- Negative: Wrong Password ---
async function testWrongPassword() {
  section("Negative: Wrong Password");

  try {
    const { response, duration } = await request("POST", "/auth/signin", {
      email: TEST_EMAIL,
      password: "WrongPassword123!",
    });

    if (response.status === 401 || response.status === 400) {
      recordPass("Wrong password correctly rejected", duration);
      return true;
    } else if (response.status === 200) {
      recordFail(
        "Wrong password test",
        "Should reject wrong password, but got 200"
      );
      return false;
    } else {
      recordFail(
        "Wrong password test",
        `Expected 401, got ${response.status}: ${response.data.message}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Wrong password test", e.message);
    return false;
  }
}

// --- Negative: Invalid OTP Code ---
async function testInvalidOTP() {
  section("Negative: Invalid OTP Code");

  try {
    const { response, duration } = await request(
      "POST",
      "/auth/verify-phone-otp",
      {
        phoneNumber: TEST_PHONE,
        code: "000000", // Invalid code
        purpose: "verification",
      }
    );

    if (response.status === 400 || response.status === 401) {
      recordPass("Invalid OTP correctly rejected", duration);
      return true;
    } else if (response.status === 200) {
      recordFail("Invalid OTP test", "Should reject invalid code, but got 200");
      return false;
    } else {
      recordFail(
        "Invalid OTP test",
        `Expected 400/401, got ${response.status}: ${response.data.message}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Invalid OTP test", e.message);
    return false;
  }
}

// --- Negative: Expired/Invalid Token ---
async function testExpiredToken() {
  section("Negative: Invalid Access Token");

  try {
    const { response, duration } = await request("GET", "/auth/status", null, {
      Authorization: "Bearer invalid.token.here",
    });

    if (response.status === 401 || response.status === 403) {
      recordPass("Invalid token correctly rejected", duration);
      return true;
    } else if (response.status === 200) {
      recordFail(
        "Invalid token test",
        "Should reject invalid token, but got 200"
      );
      return false;
    } else {
      recordFail(
        "Invalid token test",
        `Expected 401/403, got ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Invalid token test", e.message);
    return false;
  }
}

// --- Negative: Missing Required Fields ---
async function testMissingRequiredFields() {
  section("Negative: Missing Required Fields");

  // Test signup without email
  try {
    const userWithoutEmail = {
      password: TEST_PASSWORD,
      firstName: "Test",
      lastName: "NoEmail",
      phoneNumber: "+15551234567",
    };

    const { response, duration } = await request(
      "POST",
      "/auth/signup",
      userWithoutEmail
    );

    if (response.status === 400) {
      recordPass("Signup without email correctly rejected", duration);
    } else if (response.status === 200) {
      recordFail(
        "Missing email validation",
        "Should reject signup without email, but got 200"
      );
    } else {
      recordFail(
        "Missing email validation",
        `Expected 400, got ${response.status}`
      );
    }
  } catch (e) {
    recordFail("Missing email validation", e.message);
  }

  // Test signin without password
  try {
    const { response, duration } = await request("POST", "/auth/signin", {
      email: TEST_EMAIL,
      // password missing
    });

    if (response.status === 400) {
      recordPass("Signin without password correctly rejected", duration);
      return true;
    } else if (response.status === 200) {
      recordFail(
        "Missing password validation",
        "Should reject signin without password, but got 200"
      );
      return false;
    } else {
      recordFail(
        "Missing password validation",
        `Expected 400, got ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Missing password validation", e.message);
    return false;
  }
}

// ============================================================================
// PASSWORD RESET COMPLETE FLOW
// ============================================================================

async function testPasswordResetComplete() {
  section("Password Reset: Complete Flow");

  const NEW_PASSWORD = "NewTestPassword456!";

  // Step 1: Request password reset
  try {
    const { response: forgotResponse } = await request(
      "POST",
      "/auth/forgot-password",
      {
        email: TEST_EMAIL,
      }
    );

    if (forgotResponse.status !== 200) {
      recordFail(
        "Password reset request",
        forgotResponse.data.message || `Status: ${forgotResponse.status}`
      );
      return false;
    }
    recordPass("Password reset code sent", 0);
  } catch (e) {
    recordFail("Password reset request", e.message);
    return false;
  }

  // Step 2: Get code from user
  const code = await prompt(
    "Enter the 6-digit password reset code from your email/phone"
  );

  if (!code || code.length !== 6) {
    recordSkip("Password reset", "Invalid or no code entered");
    return false;
  }

  // Step 3: Reset password with code
  try {
    const { response, duration } = await request(
      "POST",
      "/auth/reset-password",
      {
        email: TEST_EMAIL,
        code: code,
        newPassword: NEW_PASSWORD,
        useTwilio: true,
      }
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("Password reset successful", duration);
    } else {
      recordFail(
        "Password reset",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Password reset", e.message);
    return false;
  }

  // Step 4: Verify signin with new password
  try {
    const { response, duration } = await request("POST", "/auth/signin", {
      email: TEST_EMAIL,
      password: NEW_PASSWORD,
    });

    if (
      response.status === 200 &&
      (response.data.success === true || response.data.mfaRequired)
    ) {
      if (response.data.accessToken) {
        accessToken = response.data.accessToken;
        refreshToken = response.data.refreshToken;
      }
      // Update currentPassword to track the new password
      currentPassword = NEW_PASSWORD;
      recordPass("Signin with new password successful", duration);
      return true;
    } else {
      recordFail(
        "Signin with new password",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Signin with new password", e.message);
    return false;
  }
}

// ============================================================================
// DELETE ACCOUNT TEST (Run LAST - destroys test account)
// ============================================================================

async function testDeleteAccount() {
  section("Delete Account (Final Test)");

  try {
    const { response, duration } = await request(
      "DELETE",
      "/user/profile",
      {},
      authHeader()
    );

    if (response.status === 200 && response.data.success === true) {
      recordPass("Account deleted successfully", duration);
      return true;
    } else if (response.status === 403 && response.data.mfaRequired) {
      // MFA required for deletion
      recordSkip("Account deletion", "MFA verification required - skipping");
      return false;
    } else {
      recordFail(
        "Account deletion",
        response.data.message || `Status: ${response.status}`
      );
      return false;
    }
  } catch (e) {
    recordFail("Account deletion", e.message);
    return false;
  }
}

// ============================================================================
// DATABASE CLEANUP (Direct SQL - handles foreign keys properly)
// ============================================================================

async function cleanupTestUserFromDatabase(targetUserId) {
  section("Database Cleanup (Direct SQL)");

  if (!targetUserId) {
    recordSkip("Database cleanup", "No userId available");
    return false;
  }

  const start = Date.now();

  try {
    log(`         Connecting to database...`);
    await sql.connect(DB_CONFIG);

    // Get all tables with UserID columns
    const tablesResult = await sql.query`
      SELECT TABLE_NAME, COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE COLUMN_NAME LIKE '%UserID%' 
         OR COLUMN_NAME LIKE '%UserId%' 
         OR COLUMN_NAME LIKE '%user_id%'
    `;

    const tables = tablesResult.recordset;
    log(`         Found ${tables.length} tables with UserID columns`);

    let remainingTables = [...tables];
    let pass = 1;
    let totalDeleted = 0;

    // Multi-pass deletion to handle foreign key constraints
    while (remainingTables.length > 0 && pass <= 5) {
      const stillRemaining = [];

      for (const { TABLE_NAME, COLUMN_NAME } of remainingTables) {
        try {
          const request = new sql.Request();
          const result = await request.query(
            `DELETE FROM dbo.[${TABLE_NAME}] WHERE [${COLUMN_NAME}] = ${targetUserId}`
          );
          if (result.rowsAffected[0] > 0) {
            log(
              `         ${colors.green}✓${colors.reset} Deleted ${result.rowsAffected[0]} rows from ${TABLE_NAME}`
            );
            totalDeleted += result.rowsAffected[0];
          }
        } catch (err) {
          if (
            err.message.includes("REFERENCE constraint") ||
            err.message.includes("FOREIGN KEY")
          ) {
            stillRemaining.push({ TABLE_NAME, COLUMN_NAME });
          }
          // Ignore other errors (table might not have matching rows)
        }
      }

      remainingTables = stillRemaining;
      pass++;
    }

    const duration = Date.now() - start;

    if (totalDeleted > 0) {
      recordPass(
        `User ${targetUserId} cleaned up (${totalDeleted} total rows deleted)`,
        duration
      );
    } else {
      recordPass(
        `User ${targetUserId} cleanup complete (no rows found)`,
        duration
      );
    }

    return true;
  } catch (err) {
    recordFail("Database cleanup", err.message);
    return false;
  } finally {
    await sql.close();
  }
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runTests() {
  const startTime = Date.now();

  // Header
  log("\n" + "═".repeat(62));
  log("              Auth API Test Suite - Production");
  log("═".repeat(62));
  log(`  Target: ${API_BASE_URL}`);
  log(`  Test Email: ${TEST_EMAIL}`);
  log(`  Test Phone: ${TEST_PHONE}`);
  log("═".repeat(62));

  // ==========================================================================
  // PHASE 1: Health Check & Pre-signup Security Tests
  // ==========================================================================
  await testHealthCheck();

  // Security: Test phone required at signup (before main signup)
  await testSignupWithoutPhone();

  // ==========================================================================
  // PHASE 2: Basic Auth Flow
  // ==========================================================================
  const emailCheckOk = await testCheckEmailNotExists();
  if (!emailCheckOk) {
    log("\n⚠️  Cannot proceed - email already exists or check failed");
    printSummary(startTime);
    process.exit(1);
  }

  const signupOk = await testSignup();
  if (!signupOk) {
    log("\n⚠️  Cannot proceed - signup failed");
    printSummary(startTime);
    process.exit(1);
  }

  // Security: Test duplicate email with different case (after signup)
  await testSignupDuplicateCaseInsensitive();

  await testSignin();
  await testAuthStatus();
  await testRefreshToken();

  // ==========================================================================
  // PHASE 3: Security Tests (Require authenticated user)
  // ==========================================================================
  await testSigninCaseInsensitive();
  await testProfileUpdateUnauthorized();
  await testLoggedInElsewhere();

  // Re-signin to get fresh tokens after logged-in-elsewhere test
  await testSignin();

  // ==========================================================================
  // PHASE 4: Phone OTP Flow
  // ==========================================================================
  await testCheckPhone();
  const phoneOtpSent = await testSendPhoneOtp();
  if (phoneOtpSent) {
    await testVerifyPhoneOtp();
  }

  // ==========================================================================
  // PHASE 5: Email OTP Flow
  // ==========================================================================
  const emailOtpSent = await testSendEmailOtp();
  if (emailOtpSent) {
    await testVerifyEmailOtp();
  }

  // ==========================================================================
  // PHASE 6: MFA Flow (Optional - requires user input)
  // ==========================================================================
  const runMFA = await prompt("Run MFA tests? (y/n)");
  if (runMFA.toLowerCase() === "y") {
    const mfaSetupOk = await testSetupMFA();
    if (mfaSetupOk) {
      const mfaCompleted = await testCompleteMFASetup();
      if (mfaCompleted) {
        // Logout to test MFA signin
        await testLogout();

        // Signin should now require MFA
        const mfaRequired = await testSigninWithMFA();
        if (mfaRequired) {
          await testSendMFACode();
          await testVerifyMFALogin();
        }

        // Disable MFA for remaining tests
        await testDisableMFA();
      }
    }
  } else {
    log(`\n${colors.yellow}[SKIP]${colors.reset} MFA tests skipped by user`);
    results.skipped += 5; // Count skipped MFA tests
  }

  // Ensure we're logged in for remaining tests
  await testSignin();

  // ==========================================================================
  // PHASE 7: Biometric Flow
  // ==========================================================================
  await testEnableBiometric();
  await testBiometricLogin();
  await testDisableBiometric();

  // ==========================================================================
  // PHASE 8: Utility Routes
  // ==========================================================================
  await testUpdateLoginPreference();
  await testUpdateProfile();

  // ==========================================================================
  // PHASE 9: Negative/Error Cases
  // ==========================================================================
  await testWrongPassword();
  await testInvalidOTP();
  await testExpiredToken();
  await testMissingRequiredFields();

  // ==========================================================================
  // PHASE 10: Password Reset Flow (Optional - requires user input)
  // ==========================================================================
  const runPasswordReset = await prompt("Run password reset test? (y/n)");
  if (runPasswordReset.toLowerCase() === "y") {
    await testPasswordResetComplete();
    // Re-signin with original password if reset changed it
    await testSignin();
  } else {
    log(
      `\n${colors.yellow}[SKIP]${colors.reset} Password reset test skipped by user`
    );
    results.skipped += 1;
  }

  // ==========================================================================
  // PHASE 11: Logout & Token Invalidation
  // ==========================================================================
  await testLogout();
  await testTokenInvalidAfterLogout();

  // ==========================================================================
  // PHASE 12: Delete Account (FINAL - Destroys test account)
  // ==========================================================================
  const runDelete = await prompt("Delete test account? (y/n)");
  if (runDelete.toLowerCase() === "y") {
    // Try API delete first
    // Re-signin for delete (token was invalidated)
    // Use currentPassword which may have changed during password reset test
    const signinForDelete = await request("POST", "/auth/signin", {
      email: TEST_EMAIL,
      password: currentPassword,
    });
    if (
      signinForDelete.response.status === 200 &&
      signinForDelete.response.data.accessToken
    ) {
      accessToken = signinForDelete.response.data.accessToken;
      refreshToken = signinForDelete.response.data.refreshToken;
    }

    const apiDeleteResult = await testDeleteAccount();

    // If API delete failed or was skipped, use direct database cleanup
    if (!apiDeleteResult) {
      log(
        `\n${colors.yellow}[INFO]${colors.reset} API delete failed/skipped, using direct database cleanup...`
      );
      await cleanupTestUserFromDatabase(userId);
    }
  } else {
    // Ask if they want database cleanup only (no API)
    const runDbCleanup = await prompt(
      "Run direct database cleanup instead? (y/n)"
    );
    if (runDbCleanup.toLowerCase() === "y") {
      await cleanupTestUserFromDatabase(userId);
    } else {
      log(
        `\n${colors.yellow}[SKIP]${colors.reset} Account deletion skipped by user`
      );
      log(`         Test account: ${TEST_EMAIL}`);
      log(`         User ID: ${userId}`);
      log(`         (You may want to delete this manually)`);
      results.skipped += 1;
    }
  }

  // Summary
  printSummary(startTime);

  // Exit code for CI/CD
  process.exit(results.failed > 0 ? 1 : 0);
}

function printSummary(startTime) {
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

  log("\n" + "═".repeat(62));
  log("                         TEST SUMMARY");
  log("═".repeat(62));
  log(`  ${colors.green}Passed:${colors.reset}  ${results.passed}`);
  log(`  ${colors.red}Failed:${colors.reset}  ${results.failed}`);
  log(`  ${colors.yellow}Skipped:${colors.reset} ${results.skipped}`);
  log("");
  log(`  Total time: ${totalTime}s`);

  if (results.failures.length > 0) {
    log("\n  Failed tests:");
    results.failures.forEach((f) => {
      log(`    ${colors.red}✗${colors.reset} ${f.name}: ${f.reason}`);
    });
  }

  log("═".repeat(62));
  log(`\n  Test account: ${TEST_EMAIL}`);
  log("  (You may want to delete this test account manually)\n");
}

// Run!
runTests().catch((err) => {
  console.error("\n❌ Test suite crashed:", err.message);
  process.exit(1);
});
