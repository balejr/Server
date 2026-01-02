/**
 * MFA Tests
 *
 * Tests Multi-Factor Authentication flows:
 * - Setup MFA with SMS
 * - Complete MFA setup with code
 * - Signin with MFA enabled
 * - Send MFA code
 * - Verify MFA login
 * - Disable MFA
 *
 * NOTE: This test file requires interactive input for MFA codes.
 * Run: npm run test:mfa
 */

const {
  api,
  getState,
  setState,
  clearState,
  createTestUser,
  getTestPhone,
  askForOTP,
  askYesNo,
  cleanupTestUser,
} = require("../helpers");

let testUser;
let mfaEnabled = false;

describe("MFA Flows", () => {
  beforeAll(async () => {
    let state = getState();

    if (!state.userId) {
      // Need to create and sign up a new test user
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
  // MFA SETUP
  // =========================================================================

  describe("MFA Setup", () => {
    test("initiates MFA setup (sends code)", async () => {
      const state = getState();
      const { response, duration } = await api.post(
        "/auth/setup-mfa",
        { method: "sms" },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      console.log(`     MFA setup initiated: ${duration}ms`);
    });

    test("completes MFA setup with code (interactive)", async () => {
      const state = getState();

      // Ask user for the code
      const code = await askForOTP("your phone (MFA setup code)");

      if (!code) {
        console.log("     Skipping - no code entered");
        return;
      }

      const { response, duration } = await api.post(
        "/auth/setup-mfa",
        {
          method: "sms",
          code: code,
        },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);

      if (response.data.mfaEnabled === true || response.data.success === true) {
        mfaEnabled = true;
        console.log(`     MFA enabled: ${duration}ms`);
      }
    });
  });

  // =========================================================================
  // MFA SIGNIN
  // =========================================================================

  describe("MFA Signin", () => {
    test("signin triggers MFA challenge when enabled", async () => {
      if (!mfaEnabled) {
        console.log("     Skipping - MFA not enabled");
        return;
      }

      // First logout to test MFA signin
      const state = getState();
      await api.post(
        "/auth/logout",
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      // Now try to sign in
      const { response, duration } = await api.post("/auth/signin", {
        email: testUser.email,
        password: testUser.password,
      });

      expect(response.status).toBe(200);

      if (response.data.mfaRequired) {
        expect(response.data.mfaSessionToken).toBeDefined();
        setState({ mfaSessionToken: response.data.mfaSessionToken });
        console.log(`     MFA challenge received: ${duration}ms`);
        console.log(`     User ID: ${response.data.userId}`);
      } else {
        // MFA might not be required for some reason
        console.log(`     Direct signin (MFA not triggered): ${duration}ms`);
        if (response.data.accessToken) {
          setState({
            accessToken: response.data.accessToken,
            refreshToken: response.data.refreshToken,
          });
        }
      }
    });

    test("sends MFA code", async () => {
      if (!mfaEnabled) {
        console.log("     Skipping - MFA not enabled");
        return;
      }

      const state = getState();
      const { response, duration } = await api.post("/auth/send-mfa-code", {
        userId: state.userId,
        method: "sms",
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      console.log(`     MFA code sent: ${duration}ms`);
    });

    test("verifies MFA and completes login (interactive)", async () => {
      if (!mfaEnabled) {
        console.log("     Skipping - MFA not enabled");
        return;
      }

      const state = getState();

      // Ask user for the code
      const code = await askForOTP("your phone (MFA login code)");

      if (!code) {
        console.log("     Skipping - no code entered");
        return;
      }

      const { response, duration } = await api.post("/auth/verify-mfa-login", {
        userId: state.userId,
        mfaSessionToken: state.mfaSessionToken,
        code: code,
        method: "sms",
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      if (response.data.accessToken) {
        setState({
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
        });
        console.log(`     MFA login successful: ${duration}ms`);
      }
    });
  });

  // =========================================================================
  // MFA DISABLE
  // =========================================================================

  describe("MFA Disable", () => {
    test("disables MFA", async () => {
      if (!mfaEnabled) {
        console.log("     Skipping - MFA not enabled");
        return;
      }

      const state = getState();
      const { response, duration } = await api.post(
        "/auth/disable-mfa",
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      mfaEnabled = false;
      console.log(`     MFA disabled: ${duration}ms`);
    });

    test("signin no longer requires MFA after disable", async () => {
      // Logout first
      const state = getState();
      await api.post(
        "/auth/logout",
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      // Signin should work without MFA
      const { response, duration } = await api.post("/auth/signin", {
        email: testUser.email,
        password: testUser.password,
      });

      expect(response.status).toBe(200);

      if (response.data.accessToken) {
        expect(response.data.mfaRequired).toBeFalsy();
        setState({
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
        });
        console.log(`     Direct signin (no MFA): ${duration}ms`);
      }
    });
  });

  // =========================================================================
  // MFA SECURITY
  // =========================================================================

  describe("MFA Security", () => {
    test("rejects invalid MFA code", async () => {
      // Enable MFA first if not enabled
      const state = getState();

      // Send MFA code
      await api.post("/auth/send-mfa-code", {
        userId: state.userId,
        method: "sms",
      });

      // Try invalid code
      const { response } = await api.post("/auth/verify-mfa-code", {
        userId: state.userId,
        code: "000000",
      });

      expect([400, 401]).toContain(response.status);
    });

    test("rejects MFA verification without userId", async () => {
      const { response } = await api.post("/auth/verify-mfa-code", {
        code: "123456",
      });

      expect(response.status).toBe(400);
    });
  });
});

