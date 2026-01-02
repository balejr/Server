/**
 * Full E2E Auth Flow Test
 *
 * Complete signup-to-delete journey testing all major authentication features.
 * This is an interactive test that requires user input for OTP codes.
 *
 * Flow:
 * 1. Health check
 * 2. Email check (should not exist)
 * 3. Signup
 * 4. Email check (should exist)
 * 5. Signin
 * 6. Auth status
 * 7. Refresh token
 * 8. Phone OTP send & verify
 * 9. Email OTP send & verify
 * 10. Enable biometric
 * 11. Biometric login
 * 12. Disable biometric
 * 13. (Optional) MFA setup & verify
 * 14. Profile update
 * 15. Logout
 * 16. (Optional) Password reset
 * 17. Delete account / Database cleanup
 *
 * Run: npm run test:full
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
  section,
  success,
  failure,
  info,
  warning,
} = require("../helpers");

// Test configuration
let testUser;
let biometricToken = null;
let mfaEnabled = false;
let currentPassword;

describe("Full E2E Auth Flow", () => {
  beforeAll(() => {
    clearState();
    testUser = createTestUser();
    currentPassword = testUser.password;

    console.log("\n");
    console.log("═".repeat(60));
    console.log("         🚀 Full E2E Authentication Flow Test");
    console.log("═".repeat(60));
    console.log(`  📧 Test Email: ${testUser.email}`);
    console.log(`  📱 Test Phone: ${testUser.phoneNumber}`);
    console.log("═".repeat(60));
    console.log("\n");
  });

  afterAll(async () => {
    const state = getState();
    if (state.userId) {
      console.log("\n");
      console.log("═".repeat(60));
      console.log("         🧹 Cleanup");
      console.log("═".repeat(60));

      const shouldCleanup = await askYesNo(
        "Delete test account from database?",
        true
      );

      if (shouldCleanup) {
        await cleanupTestUser(state.userId);
        console.log("  ✓ Test user cleaned up");
      } else {
        console.log(`  ℹ Test account left in database:`);
        console.log(`    Email: ${testUser.email}`);
        console.log(`    User ID: ${state.userId}`);
      }
    }
  });

  // =========================================================================
  // PHASE 1: HEALTH CHECK
  // =========================================================================

  describe("Phase 1: Health Check", () => {
    test("server is running", async () => {
      const { response, duration } = await api.get("/../");
      expect(response.status).toBe(200);
      console.log(`     ✓ Server online (${duration}ms)`);
    });

    test("version endpoint works", async () => {
      const { response, duration } = await api.get("/version");
      expect(response.status).toBe(200);
      console.log(`     ✓ Version: ${response.data.version} (${duration}ms)`);
    });
  });

  // =========================================================================
  // PHASE 2: SIGNUP FLOW
  // =========================================================================

  describe("Phase 2: Signup Flow", () => {
    test("email does not exist yet", async () => {
      const { response } = await api.get(
        `/auth/checkemail?email=${encodeURIComponent(testUser.email)}`
      );
      expect(response.data.exists).toBe(false);
      console.log("     ✓ Email is available");
    });

    test("creates account successfully", async () => {
      const { response, duration } = await api.post("/auth/signup", testUser);

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.accessToken).toBeDefined();

      setState({
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
        userId: response.data.userId || response.data.user?.id,
      });

      console.log(`     ✓ Account created (${duration}ms)`);
      console.log(`       User ID: ${getState().userId}`);
    });

    test("email exists after signup", async () => {
      const { response } = await api.get(
        `/auth/checkemail?email=${encodeURIComponent(testUser.email)}`
      );
      expect(response.data.exists).toBe(true);
      console.log("     ✓ Email registered");
    });
  });

  // =========================================================================
  // PHASE 3: SIGNIN & TOKEN OPERATIONS
  // =========================================================================

  describe("Phase 3: Signin & Tokens", () => {
    test("signs in successfully", async () => {
      const { response, duration } = await api.post("/auth/signin", {
        email: testUser.email,
        password: currentPassword,
      });

      expect(response.status).toBe(200);

      if (response.data.mfaRequired) {
        setState({ mfaSessionToken: response.data.mfaSessionToken });
        console.log(`     ✓ MFA challenge received (${duration}ms)`);
      } else {
        setState({
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
        });
        console.log(`     ✓ Signed in (${duration}ms)`);
      }
    });

    test("retrieves auth status", async () => {
      const state = getState();
      const { response, duration } = await api.get("/auth/status", {
        Authorization: `Bearer ${state.accessToken}`,
      });

      expect(response.status).toBe(200);
      expect(response.data.authStatus).toBeDefined();

      console.log(`     ✓ Auth status (${duration}ms)`);
      console.log(`       Email: ${response.data.authStatus.email}`);
      console.log(`       Phone Verified: ${response.data.authStatus.phoneVerified}`);
    });

    test("refreshes token", async () => {
      const state = getState();
      const oldToken = state.accessToken;

      const { response, duration } = await api.post("/auth/refresh-token", {
        refreshToken: state.refreshToken,
      });

      expect(response.status).toBe(200);
      expect(response.data.accessToken).toBeDefined();
      expect(response.data.accessToken).not.toBe(oldToken);

      setState({
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
      });

      console.log(`     ✓ Token refreshed (${duration}ms)`);
    });
  });

  // =========================================================================
  // PHASE 4: PHONE OTP
  // =========================================================================

  describe("Phase 4: Phone OTP", () => {
    test("sends phone OTP", async () => {
      const { response, duration } = await api.post("/auth/send-phone-otp", {
        phoneNumber: getTestPhone(),
        purpose: "verification",
      });

      expect(response.status).toBe(200);
      console.log(`     ✓ Phone OTP sent (${duration}ms)`);
    });

    test("verifies phone OTP (interactive)", async () => {
      const code = await askForOTP("your phone");

      if (!code) {
        console.log("     ⚠ Skipped - no code entered");
        return;
      }

      const { response, duration } = await api.post("/auth/verify-phone-otp", {
        phoneNumber: getTestPhone(),
        code: code,
        purpose: "verification",
      });

      expect(response.status).toBe(200);
      console.log(`     ✓ Phone verified (${duration}ms)`);
    });
  });

  // =========================================================================
  // PHASE 5: EMAIL OTP
  // =========================================================================

  describe("Phase 5: Email OTP", () => {
    test("sends email OTP", async () => {
      const { response, duration } = await api.post("/auth/send-email-otp", {
        email: testUser.email,
        purpose: "signin", // Use signin for existing user
      });

      expect(response.status).toBe(200);
      console.log(`     ✓ Email OTP sent (${duration}ms)`);
    });

    test("verifies email OTP (interactive)", async () => {
      const code = await askForOTP("your email");

      if (!code) {
        console.log("     ⚠ Skipped - no code entered");
        return;
      }

      const { response, duration } = await api.post("/auth/verify-email-otp", {
        email: testUser.email,
        code: code,
        purpose: "signin",
      });

      expect(response.status).toBe(200);

      if (response.data.accessToken) {
        setState({
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
        });
      }

      console.log(`     ✓ Email verified (${duration}ms)`);
    });
  });

  // =========================================================================
  // PHASE 6: BIOMETRIC
  // =========================================================================

  describe("Phase 6: Biometric Authentication", () => {
    test("enables biometric", async () => {
      const state = getState();
      const { response, duration } = await api.post(
        "/auth/enable-biometric",
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      biometricToken = response.data.biometricToken;
      console.log(`     ✓ Biometric enabled (${duration}ms)`);
    });

    test("logs in with biometric", async () => {
      if (!biometricToken) {
        console.log("     ⚠ Skipped - no biometric token");
        return;
      }

      const state = getState();
      const { response, duration } = await api.post("/auth/biometric-login", {
        userId: state.userId,
        biometricToken: biometricToken,
      });

      expect(response.status).toBe(200);

      if (response.data.accessToken) {
        setState({
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
        });
      }

      console.log(`     ✓ Biometric login (${duration}ms)`);
    });

    test("disables biometric", async () => {
      const state = getState();
      const { response, duration } = await api.post(
        "/auth/disable-biometric",
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      console.log(`     ✓ Biometric disabled (${duration}ms)`);
    });
  });

  // =========================================================================
  // PHASE 7: MFA (Optional)
  // =========================================================================

  describe("Phase 7: MFA (Optional)", () => {
    test("MFA flow (interactive)", async () => {
      const runMFA = await askYesNo("Run MFA tests?", false);

      if (!runMFA) {
        console.log("     ⚠ MFA tests skipped");
        return;
      }

      const state = getState();

      // Setup MFA
      console.log("\n     Setting up MFA...");
      const setupResponse = await api.post(
        "/auth/setup-mfa",
        { method: "sms" },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      if (setupResponse.response.status !== 200) {
        console.log("     ⚠ MFA setup failed");
        return;
      }

      // Get setup code
      const setupCode = await askForOTP("your phone (MFA setup code)");
      if (!setupCode) {
        console.log("     ⚠ MFA setup skipped");
        return;
      }

      // Complete setup
      const completeResponse = await api.post(
        "/auth/setup-mfa",
        { method: "sms", code: setupCode },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      if (completeResponse.response.data.mfaEnabled) {
        mfaEnabled = true;
        console.log("     ✓ MFA enabled");

        // Test MFA signin
        await api.post(
          "/auth/logout",
          {},
          { Authorization: `Bearer ${state.accessToken}` }
        );

        const signinResponse = await api.post("/auth/signin", {
          email: testUser.email,
          password: currentPassword,
        });

        if (signinResponse.response.data.mfaRequired) {
          console.log("     ✓ MFA challenge received");

          // Send MFA code
          await api.post("/auth/send-mfa-code", {
            userId: state.userId,
            method: "sms",
          });

          const mfaCode = await askForOTP("your phone (MFA login code)");
          if (mfaCode) {
            const verifyResponse = await api.post("/auth/verify-mfa-login", {
              userId: state.userId,
              mfaSessionToken: signinResponse.response.data.mfaSessionToken,
              code: mfaCode,
              method: "sms",
            });

            if (verifyResponse.response.data.accessToken) {
              setState({
                accessToken: verifyResponse.response.data.accessToken,
                refreshToken: verifyResponse.response.data.refreshToken,
              });
              console.log("     ✓ MFA login successful");
            }
          }
        }

        // Disable MFA
        const disableResponse = await api.post(
          "/auth/disable-mfa",
          {},
          { Authorization: `Bearer ${getState().accessToken}` }
        );

        if (disableResponse.response.status === 200) {
          mfaEnabled = false;
          console.log("     ✓ MFA disabled");
        }
      }
    });
  });

  // =========================================================================
  // PHASE 8: PROFILE UPDATE
  // =========================================================================

  describe("Phase 8: Profile Update", () => {
    test("updates profile", async () => {
      const state = getState();
      const { response, duration } = await api.patch(
        `/auth/update-profile/${state.userId}`,
        {
          firstname: "E2ETest",
          lastname: "Complete",
        },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      console.log(`     ✓ Profile updated (${duration}ms)`);
    });
  });

  // =========================================================================
  // PHASE 9: LOGOUT
  // =========================================================================

  describe("Phase 9: Logout", () => {
    test("logs out", async () => {
      const state = getState();
      const { response, duration } = await api.post(
        "/auth/logout",
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      console.log(`     ✓ Logged out (${duration}ms)`);
    });

    test("token is invalid after logout", async () => {
      const state = getState();
      const { response } = await api.get("/auth/status", {
        Authorization: `Bearer ${state.accessToken}`,
      });

      expect(response.status).toBe(401);
      console.log("     ✓ Token invalidated");
    });
  });

  // =========================================================================
  // PHASE 10: PASSWORD RESET (Optional)
  // =========================================================================

  describe("Phase 10: Password Reset (Optional)", () => {
    test("password reset flow (interactive)", async () => {
      const runReset = await askYesNo("Run password reset test?", false);

      if (!runReset) {
        console.log("     ⚠ Password reset skipped");
        return;
      }

      // Send reset code
      const forgotResponse = await api.post("/auth/forgot-password", {
        email: testUser.email,
      });

      if (forgotResponse.response.status !== 200) {
        console.log("     ⚠ Failed to send reset code");
        return;
      }

      console.log("     ✓ Reset code sent");

      const code = await askForOTP("your email/phone (reset code)");
      if (!code) {
        console.log("     ⚠ Password reset skipped");
        return;
      }

      const newPassword = "ResetPassword789!";
      const resetResponse = await api.post("/auth/reset-password", {
        email: testUser.email,
        code: code,
        newPassword: newPassword,
        useTwilio: true,
      });

      if (resetResponse.response.status === 200) {
        currentPassword = newPassword;
        console.log("     ✓ Password reset successful");

        // Verify signin with new password
        const signinResponse = await api.post("/auth/signin", {
          email: testUser.email,
          password: newPassword,
        });

        if (signinResponse.response.status === 200) {
          if (signinResponse.response.data.accessToken) {
            setState({
              accessToken: signinResponse.response.data.accessToken,
              refreshToken: signinResponse.response.data.refreshToken,
            });
          }
          console.log("     ✓ Signin with new password works");
        }
      } else {
        console.log("     ⚠ Password reset failed");
      }
    });
  });
});

