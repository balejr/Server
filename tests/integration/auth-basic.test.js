/**
 * Basic Auth Tests
 *
 * Tests core authentication flows:
 * - Health check & version
 * - Email existence check
 * - Signup
 * - Signin
 * - Auth status
 * - Token refresh
 * - Login preference update
 * - Profile update
 * - Logout
 *
 * Run: npm run test:auth
 */

const {
  api,
  getState,
  setState,
  clearState,
  createTestUser,
  getTestPhone,
  getTestPassword,
  cleanupTestUser,
} = require("../helpers");

// Test user - created fresh for this test suite
let testUser;
let userId;

describe("Basic Auth Flow", () => {
  // Create a fresh test user for this suite
  beforeAll(() => {
    clearState();
    testUser = createTestUser();
    console.log(`\n  📧 Test Email: ${testUser.email}`);
    console.log(`  📱 Test Phone: ${testUser.phoneNumber}\n`);
  });

  // Cleanup after all tests
  afterAll(async () => {
    const state = getState();
    if (state.userId) {
      console.log(`\n  🧹 Cleaning up test user ${state.userId}...`);
      await cleanupTestUser(state.userId);
    }
  });

  // =========================================================================
  // HEALTH CHECK
  // =========================================================================

  describe("Health Check", () => {
    test("server is running", async () => {
      const { response, duration } = await api.get("/../");

      expect(response.status).toBe(200);
      console.log(`     Server responded in ${duration}ms`);
    });

    test("version endpoint returns build info", async () => {
      const { response, duration } = await api.get("/version");

      expect(response.status).toBe(200);
      expect(response.data.version).toBeDefined();
      console.log(`     Version: ${response.data.version} (${duration}ms)`);
    });
  });

  // =========================================================================
  // EMAIL CHECK
  // =========================================================================

  describe("Email Check", () => {
    test("email does not exist before signup", async () => {
      const { response, duration } = await api.get(
        `/auth/checkemail?email=${encodeURIComponent(testUser.email)}`
      );

      expect(response.status).toBe(200);
      expect(response.data.exists).toBe(false);
      console.log(`     Email check: ${duration}ms`);
    });
  });

  // =========================================================================
  // SIGNUP
  // =========================================================================

  describe("Signup", () => {
    test("creates new account with valid data", async () => {
      const { response, duration } = await api.post("/auth/signup", testUser);

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.accessToken).toBeDefined();
      expect(response.data.refreshToken).toBeDefined();

      // Store tokens for later tests
      const newUserId = response.data.userId || response.data.user?.id;
      setState({
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
        userId: newUserId,
      });
      userId = newUserId;

      console.log(`     User created: ${userId} (${duration}ms)`);
    });

    test("email exists after signup", async () => {
      const { response } = await api.get(
        `/auth/checkemail?email=${encodeURIComponent(testUser.email)}`
      );

      expect(response.status).toBe(200);
      expect(response.data.exists).toBe(true);
    });

    test("rejects signup without email", async () => {
      const invalidUser = { ...testUser };
      delete invalidUser.email;
      invalidUser.phoneNumber = "+15551234567"; // Use different phone

      const { response } = await api.post("/auth/signup", invalidUser);

      expect(response.status).toBe(400);
    });

    test("rejects signup without phone", async () => {
      const invalidUser = { ...testUser };
      delete invalidUser.phoneNumber;
      invalidUser.email = `nophone-${Date.now()}@test.com`;

      const { response } = await api.post("/auth/signup", invalidUser);

      expect(response.status).toBe(400);
    });

    test("rejects duplicate email (case-insensitive)", async () => {
      const duplicateUser = {
        ...testUser,
        email: testUser.email.toUpperCase(),
        phoneNumber: "+15559999999",
      };

      const { response } = await api.post("/auth/signup", duplicateUser);

      expect(response.status).toBe(409);
    });
  });

  // =========================================================================
  // SIGNIN
  // =========================================================================

  describe("Signin", () => {
    test("signs in with valid credentials", async () => {
      const { response, duration } = await api.post("/auth/signin", {
        email: testUser.email,
        password: testUser.password,
      });

      expect(response.status).toBe(200);

      // May get MFA required or direct tokens
      if (response.data.mfaRequired) {
        expect(response.data.mfaSessionToken).toBeDefined();
        setState({ mfaSessionToken: response.data.mfaSessionToken });
        console.log(`     MFA required (${duration}ms)`);
      } else {
        expect(response.data.success).toBe(true);
        expect(response.data.accessToken).toBeDefined();
        expect(response.data.refreshToken).toBeDefined();

        setState({
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
        });
        console.log(`     Signin successful (${duration}ms)`);
      }
    });

    test("signs in with uppercase email (case-insensitive)", async () => {
      const { response, duration } = await api.post("/auth/signin", {
        email: testUser.email.toUpperCase(),
        password: testUser.password,
      });

      expect(response.status).toBe(200);
      console.log(`     Case-insensitive signin: ${duration}ms`);
    });

    test("rejects wrong password", async () => {
      const { response } = await api.post("/auth/signin", {
        email: testUser.email,
        password: "WrongPassword123!",
      });

      expect([400, 401]).toContain(response.status);
    });

    test("rejects signin without password", async () => {
      const { response } = await api.post("/auth/signin", {
        email: testUser.email,
      });

      expect(response.status).toBe(400);
    });

    test("rejects non-existent email", async () => {
      const { response } = await api.post("/auth/signin", {
        email: `nonexistent-${Date.now()}@test.com`,
        password: testUser.password,
      });

      expect([400, 401, 404]).toContain(response.status);
    });
  });

  // =========================================================================
  // AUTH STATUS
  // =========================================================================

  describe("Auth Status", () => {
    test("returns auth status with valid token", async () => {
      const state = getState();
      const { response, duration } = await api.get("/auth/status", {
        Authorization: `Bearer ${state.accessToken}`,
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.authStatus).toBeDefined();
      expect(response.data.authStatus.email).toBeDefined();

      console.log(`     Email: ${response.data.authStatus.email}`);
      console.log(`     Phone Verified: ${response.data.authStatus.phoneVerified}`);
      console.log(`     MFA Enabled: ${response.data.authStatus.mfaEnabled}`);
    });

    test("rejects invalid token", async () => {
      const { response } = await api.get("/auth/status", {
        Authorization: "Bearer invalid.token.here",
      });

      expect([401, 403]).toContain(response.status);
    });

    test("rejects missing token", async () => {
      const { response } = await api.get("/auth/status");

      expect([401, 403]).toContain(response.status);
    });
  });

  // =========================================================================
  // TOKEN REFRESH
  // =========================================================================

  describe("Token Refresh", () => {
    test("refreshes token successfully", async () => {
      const state = getState();
      const oldAccessToken = state.accessToken;

      const { response, duration } = await api.post("/auth/refresh-token", {
        refreshToken: state.refreshToken,
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.accessToken).toBeDefined();
      expect(response.data.refreshToken).toBeDefined();
      expect(response.data.accessToken).not.toBe(oldAccessToken);

      // Update tokens
      setState({
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
      });

      console.log(`     Token refreshed (${duration}ms)`);
    });

    test("rejects invalid refresh token", async () => {
      const { response } = await api.post("/auth/refresh-token", {
        refreshToken: "invalid-refresh-token",
      });

      expect([400, 401]).toContain(response.status);
    });
  });

  // =========================================================================
  // PROFILE UPDATE
  // =========================================================================

  describe("Profile Update", () => {
    test("updates login preference", async () => {
      const state = getState();
      const { response, duration } = await api.patch(
        "/auth/update-login-preference",
        { preferredLoginMethod: "phone" },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      console.log(`     Login preference updated (${duration}ms)`);
    });

    test("updates user profile", async () => {
      const state = getState();
      const { response, duration } = await api.patch(
        `/auth/update-profile/${state.userId}`,
        {
          firstname: "TestUpdated",
          lastname: "RunnerUpdated",
        },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      console.log(`     Profile updated (${duration}ms)`);
    });

    test("rejects profile update for different user", async () => {
      const state = getState();
      const { response } = await api.patch(
        "/auth/update-profile/99999",
        { firstname: "Hacker" },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect([403, 404]).toContain(response.status);
    });

    test("rejects profile update without auth", async () => {
      const state = getState();
      const { response } = await api.patch(
        `/auth/update-profile/${state.userId}`,
        { firstname: "NoAuth" }
      );

      expect(response.status).toBe(401);
    });
  });

  // =========================================================================
  // PHONE CHECK
  // =========================================================================

  describe("Phone Check", () => {
    test("checks if phone number exists", async () => {
      const { response, duration } = await api.get(
        `/auth/checkphone?phoneNumber=${encodeURIComponent(getTestPhone())}`
      );

      expect(response.status).toBe(200);
      expect(response.data.exists).toBeDefined();
      console.log(`     Phone exists: ${response.data.exists} (${duration}ms)`);
    });
  });

  // =========================================================================
  // LOGOUT
  // =========================================================================

  describe("Logout", () => {
    test("logs out successfully", async () => {
      const state = getState();
      const { response, duration } = await api.post(
        "/auth/logout",
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      console.log(`     Logged out (${duration}ms)`);
    });

    test("token is invalid after logout", async () => {
      const state = getState();
      const { response } = await api.get("/auth/status", {
        Authorization: `Bearer ${state.accessToken}`,
      });

      expect(response.status).toBe(401);
    });

    // Re-signin for any remaining tests
    test("can sign in again after logout", async () => {
      const { response } = await api.post("/auth/signin", {
        email: testUser.email,
        password: testUser.password,
      });

      expect(response.status).toBe(200);

      if (response.data.accessToken) {
        setState({
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
        });
      }
    });
  });
});

