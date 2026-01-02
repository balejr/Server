/**
 * Security Validation Tests
 *
 * Tests security requirements from ERRORS_TO_FIX.md:
 * - Phone number required at signup (Issue #3)
 * - Email case insensitive signin (Issue #7)
 * - Duplicate email case insensitive check (Issue #10)
 * - Profile update authorization (Issue #12)
 * - Logged in elsewhere detection (Issue #8)
 * - Weak password validation (Issue #21)
 * - Missing required fields validation
 * - Invalid token handling
 *
 * Run: npm run test:security
 */

const {
  api,
  getState,
  setState,
  clearState,
  createTestUser,
  createInvalidTestUser,
  getTestPassword,
  cleanupTestUser,
} = require("../helpers");

let testUser;

describe("Security Validations", () => {
  beforeAll(async () => {
    let state = getState();

    if (!state.userId) {
      clearState();
      testUser = createTestUser();
      console.log(`\n  📧 Test Email: ${testUser.email}`);
      console.log(`  📱 Test Phone: ${testUser.phoneNumber}\n`);

      // Sign up
      const { response } = await api.post("/auth/signup", testUser);
      if (response.status === 200) {
        setState({
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
          userId: response.data.userId || response.data.user?.id,
        });
      }
    } else {
      testUser = createTestUser();
    }
  });

  afterAll(async () => {
    const state = getState();
    if (state.userId) {
      console.log(`\n  🧹 Cleaning up test user ${state.userId}...`);
      await cleanupTestUser(state.userId);
    }
  });

  // =========================================================================
  // SIGNUP VALIDATION (Issue #3, #21)
  // =========================================================================

  describe("Signup Validation", () => {
    test("rejects signup without phone number (Issue #3)", async () => {
      const userWithoutPhone = createInvalidTestUser("noPhone");
      userWithoutPhone.email = `test-nophone-${Date.now()}@example.com`;

      const { response, duration } = await api.post(
        "/auth/signup",
        userWithoutPhone
      );

      expect(response.status).toBe(400);
      console.log(`     Correctly rejected without phone: ${duration}ms`);
    });

    test("rejects signup without email", async () => {
      const userWithoutEmail = createInvalidTestUser("noEmail");

      const { response } = await api.post("/auth/signup", userWithoutEmail);

      expect(response.status).toBe(400);
    });

    test("rejects signup with weak password (Issue #21)", async () => {
      const userWithWeakPassword = createTestUser({
        email: `weak-pwd-${Date.now()}@example.com`,
        password: "weak123", // No uppercase, no symbol
      });

      const { response, duration } = await api.post(
        "/auth/signup",
        userWithWeakPassword
      );

      expect(response.status).toBe(400);
      console.log(`     Correctly rejected weak password: ${duration}ms`);
    });

    test("rejects signup with password missing uppercase", async () => {
      const user = createTestUser({
        email: `no-upper-${Date.now()}@example.com`,
        password: "weakpassword123!", // No uppercase
      });

      const { response } = await api.post("/auth/signup", user);

      expect(response.status).toBe(400);
    });

    test("rejects signup with password missing number", async () => {
      const user = createTestUser({
        email: `no-num-${Date.now()}@example.com`,
        password: "WeakPassword!", // No number
      });

      const { response } = await api.post("/auth/signup", user);

      expect(response.status).toBe(400);
    });

    test("rejects signup with password missing symbol", async () => {
      const user = createTestUser({
        email: `no-sym-${Date.now()}@example.com`,
        password: "WeakPassword123", // No symbol
      });

      const { response } = await api.post("/auth/signup", user);

      expect(response.status).toBe(400);
    });
  });

  // =========================================================================
  // EMAIL CASE SENSITIVITY (Issue #7, #10)
  // =========================================================================

  describe("Email Case Sensitivity", () => {
    test("signin works with uppercase email (Issue #7)", async () => {
      const uppercaseEmail = testUser.email.toUpperCase();

      const { response, duration } = await api.post("/auth/signin", {
        email: uppercaseEmail,
        password: testUser.password,
      });

      expect(response.status).toBe(200);
      console.log(`     Uppercase email signin: ${duration}ms`);
    });

    test("signin works with mixed case email", async () => {
      // Capitalize first letter
      const mixedCaseEmail =
        testUser.email.charAt(0).toUpperCase() +
        testUser.email.slice(1).toLowerCase();

      const { response } = await api.post("/auth/signin", {
        email: mixedCaseEmail,
        password: testUser.password,
      });

      expect(response.status).toBe(200);
    });

    test("rejects duplicate signup with different case (Issue #10)", async () => {
      const duplicateUser = {
        ...testUser,
        email: testUser.email.toUpperCase(),
        phoneNumber: "+15559999999", // Different phone
      };

      const { response, duration } = await api.post(
        "/auth/signup",
        duplicateUser
      );

      expect(response.status).toBe(409);
      console.log(`     Correctly rejected case-variant duplicate: ${duration}ms`);
    });
  });

  // =========================================================================
  // PROFILE UPDATE AUTHORIZATION (Issue #12, #16)
  // =========================================================================

  describe("Profile Update Authorization", () => {
    test("rejects profile update for different user (Issue #12)", async () => {
      const state = getState();

      const { response, duration } = await api.patch(
        "/auth/update-profile/99999", // Non-existent or different user
        { firstname: "Hacker", lastname: "Attempt" },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      // Should get 403 Forbidden or 404 Not Found
      expect([403, 404]).toContain(response.status);
      console.log(`     Correctly rejected wrong user update: ${duration}ms`);
    });

    test("rejects profile update without auth token", async () => {
      const state = getState();

      const { response, duration } = await api.patch(
        `/auth/update-profile/${state.userId}`,
        { firstname: "NoAuth", lastname: "Test" }
        // No auth header
      );

      expect(response.status).toBe(401);
      console.log(`     Correctly rejected unauthenticated update: ${duration}ms`);
    });

    test("allows profile update for own user", async () => {
      const state = getState();

      const { response } = await api.patch(
        `/auth/update-profile/${state.userId}`,
        { firstname: "ValidUpdate" },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
    });
  });

  // =========================================================================
  // LOGGED IN ELSEWHERE (Issue #8)
  // =========================================================================

  describe("Logged In Elsewhere Detection", () => {
    test("detects when user logged in elsewhere (Issue #8)", async () => {
      const state = getState();

      // Save Device A's refresh token
      const deviceARefreshToken = state.refreshToken;

      // Login again as Device B (this invalidates Device A's token)
      const signinResponse = await api.post("/auth/signin", {
        email: testUser.email,
        password: testUser.password,
      });

      if (
        signinResponse.response.status === 200 &&
        signinResponse.response.data.accessToken
      ) {
        // Device B now has valid tokens
        setState({
          accessToken: signinResponse.response.data.accessToken,
          refreshToken: signinResponse.response.data.refreshToken,
        });

        // Try to refresh with Device A's old token
        const { response, duration } = await api.post("/auth/refresh-token", {
          refreshToken: deviceARefreshToken,
        });

        expect(response.status).toBe(401);

        // Check for specific error code
        if (response.data.errorCode === "LOGGED_IN_ELSEWHERE") {
          console.log(`     Detected logged in elsewhere: ${duration}ms`);
        } else {
          console.log(
            `     Token rejected (${response.data.errorCode || "TOKEN_INVALID"}): ${duration}ms`
          );
        }
      } else if (signinResponse.response.data.mfaRequired) {
        console.log("     Skipping - MFA enabled");
      }
    });
  });

  // =========================================================================
  // TOKEN VALIDATION
  // =========================================================================

  describe("Token Validation", () => {
    test("rejects invalid access token", async () => {
      const { response, duration } = await api.get("/auth/status", {
        Authorization: "Bearer invalid.token.here",
      });

      expect([401, 403]).toContain(response.status);
      console.log(`     Invalid token rejected: ${duration}ms`);
    });

    test("rejects malformed token", async () => {
      const { response } = await api.get("/auth/status", {
        Authorization: "Bearer not-even-a-jwt",
      });

      expect([401, 403]).toContain(response.status);
    });

    test("rejects missing Authorization header", async () => {
      const { response } = await api.get("/auth/status");

      expect([401, 403]).toContain(response.status);
    });

    test("rejects empty token", async () => {
      const { response } = await api.get("/auth/status", {
        Authorization: "Bearer ",
      });

      expect([401, 403]).toContain(response.status);
    });
  });

  // =========================================================================
  // INPUT VALIDATION
  // =========================================================================

  describe("Input Validation", () => {
    test("rejects invalid email format on signup", async () => {
      const invalidUser = createTestUser({
        email: "not-an-email",
        phoneNumber: "+15551234567",
      });

      const { response } = await api.post("/auth/signup", invalidUser);

      expect(response.status).toBe(400);
    });

    test("rejects invalid phone format on signup", async () => {
      const invalidUser = createTestUser({
        email: `invalid-phone-${Date.now()}@example.com`,
        phoneNumber: "12345", // Invalid format
      });

      const { response } = await api.post("/auth/signup", invalidUser);

      expect(response.status).toBe(400);
    });

    test("handles very long email gracefully", async () => {
      const longEmail = "a".repeat(300) + "@example.com";

      const { response } = await api.post("/auth/signin", {
        email: longEmail,
        password: "password",
      });

      // Should get 400 or 401, not 500
      expect([400, 401]).toContain(response.status);
    });

    test("handles SQL injection attempt in email", async () => {
      const { response } = await api.post("/auth/signin", {
        email: "'; DROP TABLE Users; --",
        password: "password",
      });

      // Should get 400 or 401, not 500
      expect([400, 401]).toContain(response.status);
    });
  });
});

