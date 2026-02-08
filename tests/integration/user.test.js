/**
 * User Routes Integration Tests
 *
 * Tests user inquiry endpoint.
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

describe("User API", () => {
  beforeAll(async () => {
    clearState();
    testUser = createTestUser();

    const { response: signupRes } = await api.post("/auth/signup", testUser);

    if (signupRes.status === 200 || signupRes.status === 201) {
      const userId = signupRes.data.userId || signupRes.data.user?.id;
      setState({
        accessToken: signupRes.data.accessToken,
        refreshToken: signupRes.data.refreshToken,
        userId: userId,
        email: testUser.email,
      });
      return;
    }

    if (signupRes.data?.message?.includes("Phone number already registered")) {
      throw new Error(
        "Test phone number is already registered to a different email. " +
          "Please run cleanup for the previous test user first, or use a different phone number in test-user.js"
      );
    }

    if (signupRes.data?.message?.includes("already registered")) {
      const { response: signinRes } = await api.post("/auth/signin", {
        email: testUser.email,
        password: testUser.password,
      });

      if (signinRes.status !== 200) {
        throw new Error(`Signin failed: ${JSON.stringify(signinRes.data)}`);
      }

      const userId = signinRes.data.userId || signinRes.data.user?.id;
      setState({
        accessToken: signinRes.data.accessToken,
        refreshToken: signinRes.data.refreshToken,
        userId: userId,
        email: testUser.email,
      });
      return;
    }

    throw new Error(`Signup failed: ${JSON.stringify(signupRes.data)}`);
  });

  afterAll(async () => {
    const state = getState();
    if (state.userId) {
      await cleanupTestUser(state.userId);
    }
  });

  describe("POST /user/inquiry", () => {
    test("requires authentication", async () => {
      const { response } = await api.post("/user/inquiry", {
        message: "Hello support",
      });

      expect(response.status).toBe(401);
    });

    test("rejects missing message", async () => {
      const state = getState();
      const { response } = await api.post(
        "/user/inquiry",
        { message: "" },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(400);
    });

    test("fails fast when email service is not configured", async () => {
      const emailConfigured =
        Boolean(process.env.EMAIL_USER) && Boolean(process.env.EMAIL_PASS);

      if (emailConfigured) {
        console.log("     [SKIP] EMAIL_USER/EMAIL_PASS configured");
        return;
      }

      const state = getState();
      const { response } = await api.post(
        "/user/inquiry",
        { message: "Test inquiry from integration test" },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(500);
      expect(response.data.message).toMatch(/Email service not configured/i);
    });
  });
});
