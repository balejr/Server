/**
 * Password Reset Tests
 *
 * Tests password reset flows:
 * - Forgot password (send reset code)
 * - Reset password with code
 * - Signin with new password
 * - Password validation
 *
 * NOTE: This test file requires interactive input for reset codes.
 * Run: npm run test:password
 */

const {
  api,
  getState,
  setState,
  clearState,
  createTestUser,
  getTestPassword,
  askForOTP,
  cleanupTestUser,
} = require("../helpers");

let testUser;
let currentPassword;
const NEW_PASSWORD = "NewTestPassword456!";

describe("Password Reset Flow", () => {
  beforeAll(async () => {
    let state = getState();

    if (!state.userId) {
      clearState();
      testUser = createTestUser();
      currentPassword = testUser.password;
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
      currentPassword = testUser.password;
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
  // FORGOT PASSWORD
  // =========================================================================

  describe("Forgot Password", () => {
    test("sends password reset code", async () => {
      const { response, duration } = await api.post("/auth/forgot-password", {
        email: testUser.email,
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      console.log(`     Reset code sent: ${duration}ms`);
    });

    test("handles non-existent email gracefully", async () => {
      const { response } = await api.post("/auth/forgot-password", {
        email: `nonexistent-${Date.now()}@example.com`,
      });

      // Should return 200 (don't reveal if email exists)
      // Or 404 depending on implementation
      expect([200, 404]).toContain(response.status);
    });

    test("handles invalid email format", async () => {
      const { response } = await api.post("/auth/forgot-password", {
        email: "not-an-email",
      });

      expect(response.status).toBe(400);
    });

    test("handles missing email", async () => {
      const { response } = await api.post("/auth/forgot-password", {});

      expect(response.status).toBe(400);
    });
  });

  // =========================================================================
  // RESET PASSWORD
  // =========================================================================

  describe("Reset Password", () => {
    test("complete password reset flow (interactive)", async () => {
      // Step 1: Request password reset
      const forgotResponse = await api.post("/auth/forgot-password", {
        email: testUser.email,
      });

      expect(forgotResponse.response.status).toBe(200);
      console.log("     Reset code sent to email/phone");

      // Step 2: Get code from user
      const code = await askForOTP("your email/phone (password reset code)");

      if (!code) {
        console.log("     Skipping - no code entered");
        return;
      }

      // Step 3: Reset password with code
      const { response, duration } = await api.post("/auth/reset-password", {
        email: testUser.email,
        code: code,
        newPassword: NEW_PASSWORD,
        useTwilio: true,
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      console.log(`     Password reset successful: ${duration}ms`);

      // Update current password tracker
      currentPassword = NEW_PASSWORD;
    });

    test("signin works with new password", async () => {
      if (currentPassword !== NEW_PASSWORD) {
        console.log("     Skipping - password not changed");
        return;
      }

      const { response, duration } = await api.post("/auth/signin", {
        email: testUser.email,
        password: NEW_PASSWORD,
      });

      expect(response.status).toBe(200);

      if (response.data.accessToken) {
        setState({
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
        });
        console.log(`     Signin with new password: ${duration}ms`);
      } else if (response.data.mfaRequired) {
        console.log(`     MFA required after password reset: ${duration}ms`);
      }
    });

    test("signin fails with old password after reset", async () => {
      if (currentPassword !== NEW_PASSWORD) {
        console.log("     Skipping - password not changed");
        return;
      }

      const { response } = await api.post("/auth/signin", {
        email: testUser.email,
        password: getTestPassword(), // Original password
      });

      expect([400, 401]).toContain(response.status);
    });
  });

  // =========================================================================
  // PASSWORD VALIDATION ON RESET
  // =========================================================================

  describe("Password Validation on Reset", () => {
    beforeEach(async () => {
      // Send a fresh reset code for each test
      await api.post("/auth/forgot-password", {
        email: testUser.email,
      });
    });

    test("rejects weak password on reset", async () => {
      const { response } = await api.post("/auth/reset-password", {
        email: testUser.email,
        code: "123456", // Fake code - will fail but password validation happens first
        newPassword: "weak", // Too short
      });

      expect(response.status).toBe(400);
    });

    test("rejects password without uppercase on reset", async () => {
      const { response } = await api.post("/auth/reset-password", {
        email: testUser.email,
        code: "123456",
        newPassword: "weakpassword123!", // No uppercase
      });

      expect(response.status).toBe(400);
    });

    test("rejects password without number on reset", async () => {
      const { response } = await api.post("/auth/reset-password", {
        email: testUser.email,
        code: "123456",
        newPassword: "WeakPassword!", // No number
      });

      expect(response.status).toBe(400);
    });

    test("rejects password without symbol on reset", async () => {
      const { response } = await api.post("/auth/reset-password", {
        email: testUser.email,
        code: "123456",
        newPassword: "WeakPassword123", // No symbol
      });

      expect(response.status).toBe(400);
    });

    test("rejects reset with invalid code", async () => {
      const { response } = await api.post("/auth/reset-password", {
        email: testUser.email,
        code: "000000", // Invalid code
        newPassword: "ValidPassword123!",
      });

      expect([400, 401]).toContain(response.status);
    });

    test("rejects reset with missing email", async () => {
      const { response } = await api.post("/auth/reset-password", {
        code: "123456",
        newPassword: "ValidPassword123!",
      });

      expect(response.status).toBe(400);
    });

    test("rejects reset with missing code", async () => {
      const { response } = await api.post("/auth/reset-password", {
        email: testUser.email,
        newPassword: "ValidPassword123!",
      });

      expect(response.status).toBe(400);
    });
  });
});

