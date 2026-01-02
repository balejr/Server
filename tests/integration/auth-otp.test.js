/**
 * OTP Tests
 *
 * Tests phone and email OTP flows:
 * - Send phone OTP (various purposes)
 * - Verify phone OTP (interactive)
 * - Send email OTP (various purposes)
 * - Verify email OTP (interactive)
 * - Invalid OTP handling
 *
 * NOTE: This test file requires interactive input for OTP verification.
 * Run: npm run test:otp
 */

const {
  api,
  getState,
  setState,
  clearState,
  createTestUser,
  getTestPhone,
  askForOTP,
  cleanupTestUser,
} = require("../helpers");

// Test user - shares with auth-basic tests if they ran first
let testUser;

describe("OTP Flows", () => {
  beforeAll(async () => {
    // Check if we have an existing session from previous tests
    let state = getState();

    if (!state.userId) {
      // Need to create a new test user
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
      } else if (response.status === 409) {
        // User exists, try to sign in
        const signinResponse = await api.post("/auth/signin", {
          email: testUser.email,
          password: testUser.password,
        });
        if (signinResponse.response.data.accessToken) {
          setState({
            accessToken: signinResponse.response.data.accessToken,
            refreshToken: signinResponse.response.data.refreshToken,
            userId: signinResponse.response.data.userId,
          });
        }
      }
    } else {
      // Use existing test user
      testUser = createTestUser();
      testUser.phoneNumber = getTestPhone();
    }

    console.log(`  Using test phone: ${getTestPhone()}`);
  });

  afterAll(async () => {
    const state = getState();
    if (state.userId) {
      console.log(`\n  🧹 Cleaning up test user ${state.userId}...`);
      await cleanupTestUser(state.userId);
    }
  });

  // =========================================================================
  // PHONE OTP
  // =========================================================================

  describe("Phone OTP", () => {
    describe("Send Phone OTP", () => {
      test("sends OTP for signin purpose", async () => {
        const { response, duration } = await api.post("/auth/send-phone-otp", {
          phoneNumber: getTestPhone(),
          purpose: "signin",
        });

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Phone OTP sent (signin): ${duration}ms`);

        if (response.data.remainingAttempts !== undefined) {
          console.log(`     Remaining attempts: ${response.data.remainingAttempts}`);
        }
      });

      test("sends OTP for verification purpose", async () => {
        const { response, duration } = await api.post("/auth/send-phone-otp", {
          phoneNumber: getTestPhone(),
          purpose: "verification",
        });

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Phone OTP sent (verification): ${duration}ms`);
      });

      test("sends OTP for mfa purpose", async () => {
        const { response, duration } = await api.post("/auth/send-phone-otp", {
          phoneNumber: getTestPhone(),
          purpose: "mfa",
        });

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Phone OTP sent (mfa): ${duration}ms`);
      });
    });

    describe("Verify Phone OTP", () => {
      test("verifies phone OTP (interactive)", async () => {
        // First, send a fresh OTP
        await api.post("/auth/send-phone-otp", {
          phoneNumber: getTestPhone(),
          purpose: "verification",
        });

        // Ask user for the code
        const code = await askForOTP("your phone");

        if (!code) {
          console.log("     Skipping - no code entered");
          return;
        }

        const { response, duration } = await api.post("/auth/verify-phone-otp", {
          phoneNumber: getTestPhone(),
          code: code,
          purpose: "verification",
        });

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Phone verified: ${duration}ms`);
      });

      test("rejects invalid OTP code", async () => {
        const { response } = await api.post("/auth/verify-phone-otp", {
          phoneNumber: getTestPhone(),
          code: "000000",
          purpose: "verification",
        });

        expect([400, 401]).toContain(response.status);
      });

      test("rejects invalid OTP format", async () => {
        const { response } = await api.post("/auth/verify-phone-otp", {
          phoneNumber: getTestPhone(),
          code: "123", // Too short
          purpose: "verification",
        });

        expect(response.status).toBe(400);
      });
    });
  });

  // =========================================================================
  // EMAIL OTP
  // =========================================================================

  describe("Email OTP", () => {
    beforeAll(() => {
      // Ensure we have the test user email
      if (!testUser) {
        testUser = createTestUser();
      }
    });

    describe("Send Email OTP", () => {
      test("sends OTP for signin purpose", async () => {
        const { response, duration } = await api.post("/auth/send-email-otp", {
          email: testUser.email,
          purpose: "signin",
        });

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Email OTP sent (signin): ${duration}ms`);
      });

      test("sends OTP for mfa purpose", async () => {
        const { response, duration } = await api.post("/auth/send-email-otp", {
          email: testUser.email,
          purpose: "mfa",
        });

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Email OTP sent (mfa): ${duration}ms`);
      });

      test("sends OTP for password_reset purpose", async () => {
        const { response, duration } = await api.post("/auth/send-email-otp", {
          email: testUser.email,
          purpose: "password_reset",
        });

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Email OTP sent (password_reset): ${duration}ms`);
      });

      test("rejects verification purpose for existing user", async () => {
        // 'verification' purpose should be rejected for users who already exist
        const { response, duration } = await api.post("/auth/send-email-otp", {
          email: testUser.email,
          purpose: "verification",
        });

        // Should return 409 Conflict for existing user
        expect(response.status).toBe(409);
        console.log(`     Correctly rejected verification for existing user: ${duration}ms`);
      });
    });

    describe("Verify Email OTP", () => {
      test("verifies email OTP (interactive)", async () => {
        // First, send a fresh OTP (using signin purpose for existing user)
        await api.post("/auth/send-email-otp", {
          email: testUser.email,
          purpose: "signin",
        });

        // Ask user for the code
        const code = await askForOTP("your email");

        if (!code) {
          console.log("     Skipping - no code entered");
          return;
        }

        const { response, duration } = await api.post("/auth/verify-email-otp", {
          email: testUser.email,
          code: code,
          purpose: "signin",
        });

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Email verified: ${duration}ms`);

        // If signin, we should get tokens
        if (response.data.accessToken) {
          setState({
            accessToken: response.data.accessToken,
            refreshToken: response.data.refreshToken,
          });
        }
      });

      test("rejects invalid email OTP code", async () => {
        const { response } = await api.post("/auth/verify-email-otp", {
          email: testUser.email,
          code: "000000",
          purpose: "signin",
        });

        expect([400, 401]).toContain(response.status);
      });
    });
  });
});

