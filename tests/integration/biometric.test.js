/**
 * Biometric Authentication Tests
 *
 * Tests biometric login flows:
 * - Enable biometric authentication
 * - Biometric login
 * - Disable biometric authentication
 *
 * Run: npm run test:biometric
 */

const {
  api,
  getState,
  setState,
  clearState,
  createTestUser,
  cleanupTestUser,
} = require("../helpers");

let testUser;
let biometricToken = null;

describe("Biometric Authentication", () => {
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
  // ENABLE BIOMETRIC
  // =========================================================================

  describe("Enable Biometric", () => {
    test("enables biometric authentication", async () => {
      const state = getState();

      const { response, duration } = await api.post(
        "/auth/enable-biometric",
        {}, // Empty body - server generates token
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.biometricToken).toBeDefined();

      // Store the biometric token for login test
      biometricToken = response.data.biometricToken;
      setState({ biometricToken });

      console.log(`     Biometric enabled: ${duration}ms`);
      console.log(`     Token received: ${biometricToken ? "yes" : "no"}`);
    });

    test("rejects enable biometric without auth", async () => {
      const { response } = await api.post("/auth/enable-biometric", {});

      expect(response.status).toBe(401);
    });
  });

  // =========================================================================
  // BIOMETRIC LOGIN
  // =========================================================================

  describe("Biometric Login", () => {
    test("logs in with biometric token", async () => {
      if (!biometricToken) {
        console.log("     Skipping - no biometric token available");
        return;
      }

      const state = getState();

      const { response, duration } = await api.post("/auth/biometric-login", {
        userId: state.userId,
        biometricToken: biometricToken,
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.accessToken).toBeDefined();
      expect(response.data.refreshToken).toBeDefined();

      // Update tokens
      setState({
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
      });

      console.log(`     Biometric login successful: ${duration}ms`);
    });

    test("rejects biometric login with invalid token", async () => {
      const state = getState();

      const { response } = await api.post("/auth/biometric-login", {
        userId: state.userId,
        biometricToken: "invalid-biometric-token",
      });

      expect([400, 401]).toContain(response.status);
    });

    test("rejects biometric login with missing userId", async () => {
      const { response } = await api.post("/auth/biometric-login", {
        biometricToken: biometricToken || "some-token",
      });

      expect(response.status).toBe(400);
    });

    test("rejects biometric login with missing token", async () => {
      const state = getState();

      const { response } = await api.post("/auth/biometric-login", {
        userId: state.userId,
      });

      expect(response.status).toBe(400);
    });

    test("rejects biometric login for non-existent user", async () => {
      const { response } = await api.post("/auth/biometric-login", {
        userId: 99999999,
        biometricToken: "some-token",
      });

      expect([400, 401, 404]).toContain(response.status);
    });
  });

  // =========================================================================
  // DISABLE BIOMETRIC
  // =========================================================================

  describe("Disable Biometric", () => {
    test("disables biometric authentication", async () => {
      const state = getState();

      const { response, duration } = await api.post(
        "/auth/disable-biometric",
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      console.log(`     Biometric disabled: ${duration}ms`);
    });

    test("biometric login fails after disable", async () => {
      if (!biometricToken) {
        console.log("     Skipping - no biometric token available");
        return;
      }

      const state = getState();

      const { response } = await api.post("/auth/biometric-login", {
        userId: state.userId,
        biometricToken: biometricToken,
      });

      // Should fail because biometric is disabled
      expect([400, 401]).toContain(response.status);
    });

    test("rejects disable biometric without auth", async () => {
      const { response } = await api.post("/auth/disable-biometric", {});

      expect(response.status).toBe(401);
    });
  });

  // =========================================================================
  // RE-ENABLE BIOMETRIC (verify it can be re-enabled)
  // =========================================================================

  describe("Re-enable Biometric", () => {
    test("can re-enable biometric after disable", async () => {
      const state = getState();

      const { response, duration } = await api.post(
        "/auth/enable-biometric",
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.biometricToken).toBeDefined();

      // New token should be different from old one
      expect(response.data.biometricToken).not.toBe(biometricToken);

      biometricToken = response.data.biometricToken;
      console.log(`     Biometric re-enabled with new token: ${duration}ms`);
    });
  });
});

