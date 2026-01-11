/**
 * Rewards API Integration Tests
 *
 * Tests the rewards system endpoints including XP tracking, tier progression,
 * and reward claiming functionality.
 */

const { api, getState, setState, cleanup } = require("../helpers/testUtils");

describe("Rewards API", () => {
  // =========================================================================
  // SETUP - Create test user and login
  // =========================================================================

  beforeAll(async () => {
    // Create a fresh test user
    const timestamp = Date.now();
    const testUser = {
      email: `rewards.test.${timestamp}@test.com`,
      password: "TestPassword123!",
      firstName: "Rewards",
      lastName: "Tester",
      phoneNumber: `+1425${String(timestamp).slice(-7)}`,
      fitnessGoal: "muscle_gain",
      age: 25,
      weight: 170,
      height: 68,
      gender: "male",
      fitnessLevel: "beginner",
    };

    // Sign up
    const { response: signupRes } = await api.post("/auth/signup", testUser);
    if (signupRes.status !== 201) {
      throw new Error(`Signup failed: ${JSON.stringify(signupRes.data)}`);
    }

    // Login
    const { response: loginRes } = await api.post("/auth/signin", {
      email: testUser.email,
      password: testUser.password,
    });

    if (loginRes.status !== 200) {
      throw new Error(`Login failed: ${JSON.stringify(loginRes.data)}`);
    }

    setState({
      accessToken: loginRes.data.accessToken,
      refreshToken: loginRes.data.refreshToken,
      userId: loginRes.data.user.id,
      email: testUser.email,
    });

    console.log(`     Test user created: ${testUser.email}`);
  });

  afterAll(async () => {
    await cleanup();
  });

  // =========================================================================
  // GET USER REWARDS
  // =========================================================================

  describe("GET /rewards/user", () => {
    test("returns user rewards data for new user", async () => {
      const state = getState();
      const { response, duration } = await api.get("/rewards/user", {
        Authorization: `Bearer ${state.accessToken}`,
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("totalXP");
      expect(response.data).toHaveProperty("currentTier");
      expect(response.data).toHaveProperty("rewardProgress");
      expect(response.data).toHaveProperty("completedRewards");

      // New user should start at 0 XP and BRONZE tier
      expect(response.data.totalXP).toBe(0);
      expect(response.data.currentTier).toBe("BRONZE");

      console.log(`     User rewards retrieved (${duration}ms)`);
    });

    test("requires authentication", async () => {
      const { response } = await api.get("/rewards/user");
      expect(response.status).toBe(401);
    });
  });

  // =========================================================================
  // UPDATE REWARD PROGRESS
  // =========================================================================

  describe("POST /rewards/progress/:rewardKey", () => {
    test("updates progress for daily_signin reward", async () => {
      const state = getState();
      const { response, duration } = await api.post(
        "/rewards/progress/daily_signin",
        { increment: 1 },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.currentProgress).toBeGreaterThanOrEqual(1);
      expect(response.data).toHaveProperty("isCompleted");
      expect(response.data).toHaveProperty("requiredCount");

      console.log(
        `     Progress updated: ${response.data.currentProgress}/${response.data.requiredCount} (${duration}ms)`
      );
    });

    test("returns 404 for non-existent reward", async () => {
      const state = getState();
      const { response } = await api.post(
        "/rewards/progress/fake_reward_xyz",
        { increment: 1 },
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(404);
    });

    test("requires authentication", async () => {
      const { response } = await api.post("/rewards/progress/daily_signin", {
        increment: 1,
      });
      expect(response.status).toBe(401);
    });
  });

  // =========================================================================
  // CLAIM REWARD
  // =========================================================================

  describe("POST /rewards/:rewardId/claim", () => {
    let completedRewardId = null;

    beforeAll(async () => {
      // Find a completed but unclaimed reward
      const state = getState();
      const { response } = await api.get("/rewards/user", {
        Authorization: `Bearer ${state.accessToken}`,
      });

      if (response.status === 200 && response.data.rewardProgress) {
        for (const category of Object.values(response.data.rewardProgress)) {
          for (const reward of category) {
            if (reward.isCompleted && !reward.isClaimed) {
              completedRewardId = reward.rewardId;
              break;
            }
          }
          if (completedRewardId) break;
        }
      }
    });

    test("claims a completed reward", async () => {
      if (!completedRewardId) {
        console.log("     [SKIP] No completed unclaimed rewards to test");
        return;
      }

      const state = getState();
      const { response, duration } = await api.post(
        `/rewards/${completedRewardId}/claim`,
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data).toHaveProperty("xpEarned");
      expect(response.data).toHaveProperty("newTotalXP");
      expect(response.data).toHaveProperty("newTier");

      console.log(
        `     Claimed ${response.data.xpEarned} XP, new total: ${response.data.newTotalXP} (${duration}ms)`
      );
    });

    test("rejects claiming already claimed reward", async () => {
      if (!completedRewardId) {
        console.log("     [SKIP] No completed rewards to test");
        return;
      }

      const state = getState();
      const { response } = await api.post(
        `/rewards/${completedRewardId}/claim`,
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(400);
      expect(response.data.message).toContain("already claimed");
    });

    test("returns 404 for invalid reward ID", async () => {
      const state = getState();
      const { response } = await api.post(
        "/rewards/99999/claim",
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(404);
    });

    test("requires authentication", async () => {
      const { response } = await api.post("/rewards/1/claim", {});
      expect(response.status).toBe(401);
    });
  });

  // =========================================================================
  // REWARD HISTORY
  // =========================================================================

  describe("GET /rewards/history", () => {
    test("returns paginated reward history", async () => {
      const state = getState();
      const { response, duration } = await api.get("/rewards/history", {
        Authorization: `Bearer ${state.accessToken}`,
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("rewards");
      expect(response.data).toHaveProperty("total");
      expect(response.data).toHaveProperty("page");
      expect(response.data).toHaveProperty("totalPages");
      expect(Array.isArray(response.data.rewards)).toBe(true);

      console.log(
        `     History retrieved: ${response.data.total} entries (${duration}ms)`
      );
    });

    test("supports pagination parameters", async () => {
      const state = getState();
      const { response } = await api.get("/rewards/history?page=1&limit=5", {
        Authorization: `Bearer ${state.accessToken}`,
      });

      expect(response.status).toBe(200);
      expect(response.data.page).toBe(1);
      expect(response.data.rewards.length).toBeLessThanOrEqual(5);
    });

    test("requires authentication", async () => {
      const { response } = await api.get("/rewards/history");
      expect(response.status).toBe(401);
    });
  });
});
