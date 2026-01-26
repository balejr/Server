/**
 * Rewards API Integration Tests
 *
 * Tests the rewards system endpoints including XP tracking, tier progression,
 * and reward claiming functionality.
 */

const {
  api,
  getState,
  setState,
  clearState,
  cleanupTestUser,
} = require("../helpers");

describe("Rewards API", () => {
  // =========================================================================
  // SETUP - Create test user and login
  // =========================================================================

  beforeAll(async () => {
    clearState();
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
    if (signupRes.status !== 200 && signupRes.status !== 201) {
      throw new Error(`Signup failed: ${JSON.stringify(signupRes.data)}`);
    }

    const userId = signupRes.data.userId || signupRes.data.user?.id;

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
      userId: loginRes.data.user?.id || userId,
      email: testUser.email,
    });

    console.log(`     Test user created: ${testUser.email}`);
  });

  afterAll(async () => {
    const state = getState();
    if (state.userId) {
      await cleanupTestUser(state.userId);
    }
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
      expect(response.data).toHaveProperty("totalFitPoints");
      expect(response.data).toHaveProperty("currentTier");
      expect(response.data).toHaveProperty("rewardProgress");
      expect(response.data).toHaveProperty("completedRewards");
      expect(typeof response.data.rewardProgress).toBe("object");

      // New user should start at 0 XP and BRONZE tier
      expect(response.data.totalFitPoints).toBe(0);
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
        const rewards = Object.values(response.data.rewardProgress);
        const claimable = rewards.find(
          (reward) => reward.completed && !reward.claimed && reward.canClaim
        );
        completedRewardId = claimable?.rewardId || null;
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
      expect(response.data).toHaveProperty("newTotalFitPoints");
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

  // =========================================================================
  // REWARDS V2 (AUTH REQUIREMENTS)
  // =========================================================================

  describe("Rewards V2", () => {
    test("requires authentication for definitions", async () => {
      const { response } = await api.get("/rewards/v2/definitions");
      expect(response.status).toBe(401);
    });

    test("requires authentication for usage", async () => {
      const { response } = await api.get("/rewards/v2/usage");
      expect(response.status).toBe(401);
    });
  });

  // =========================================================================
  // AI CHALLENGE ENDPOINTS
  // =========================================================================

  describe("AI Challenges", () => {
    describe("GET /rewards/challenges", () => {
      test("returns challenges grouped by category", async () => {
        const state = getState();
        const { response, duration } = await api.get("/rewards/challenges", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty("grouped");
        expect(response.data).toHaveProperty("total");
        expect(response.data.grouped).toHaveProperty("daily");
        expect(response.data.grouped).toHaveProperty("weekly");
        expect(response.data.grouped).toHaveProperty("monthly");
        expect(response.data.grouped).toHaveProperty("universal");

        console.log(
          `     Challenges retrieved: ${response.data.total} total (${duration}ms)`
        );
      });

      test("filters by category when provided", async () => {
        const state = getState();
        const { response } = await api.get("/rewards/challenges?category=daily", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty("challenges");
        expect(response.data).toHaveProperty("total");
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/rewards/challenges");
        expect(response.status).toBe(401);
      });
    });

    describe("POST /rewards/generate-challenges", () => {
      test("generates challenges for user", async () => {
        const state = getState();
        const { response, duration } = await api.post(
          "/rewards/generate-challenges",
          {},
          {
            Authorization: `Bearer ${state.accessToken}`,
          }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data).toHaveProperty("message");

        console.log(`     Challenge generation completed (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.post("/rewards/generate-challenges", {});
        expect(response.status).toBe(401);
      });
    });

    describe("POST /rewards/challenges/:id/progress", () => {
      test("rejects invalid increment values", async () => {
        const state = getState();

        // Test negative increment
        const { response: negResponse } = await api.post(
          "/rewards/challenges/1/progress",
          { increment: -5 },
          { Authorization: `Bearer ${state.accessToken}` }
        );
        expect(negResponse.status).toBe(400);
        expect(negResponse.data.message).toContain("Invalid increment");

        // Test zero increment
        const { response: zeroResponse } = await api.post(
          "/rewards/challenges/1/progress",
          { increment: 0 },
          { Authorization: `Bearer ${state.accessToken}` }
        );
        expect(zeroResponse.status).toBe(400);

        // Test too large increment
        const { response: largeResponse } = await api.post(
          "/rewards/challenges/1/progress",
          { increment: 101 },
          { Authorization: `Bearer ${state.accessToken}` }
        );
        expect(largeResponse.status).toBe(400);

        // Test non-numeric increment
        const { response: stringResponse } = await api.post(
          "/rewards/challenges/1/progress",
          { increment: "abc" },
          { Authorization: `Bearer ${state.accessToken}` }
        );
        expect(stringResponse.status).toBe(400);
      });

      test("requires authentication", async () => {
        const { response } = await api.post("/rewards/challenges/1/progress", {
          increment: 1,
        });
        expect(response.status).toBe(401);
      });
    });

    describe("DELETE /rewards/challenges/:id", () => {
      test("requires valid feedback type", async () => {
        const state = getState();
        const { response } = await api.delete(
          "/rewards/challenges/999",
          { feedbackType: "invalid_type" },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(400);
        expect(response.data.message).toContain("Invalid feedback type");
        expect(response.data).toHaveProperty("validTypes");
      });

      test("requires feedbackType in body", async () => {
        const state = getState();
        const { response } = await api.delete(
          "/rewards/challenges/999",
          {},
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(400);
      });

      test("requires authentication", async () => {
        const { response } = await api.delete("/rewards/challenges/1", {
          feedbackType: "too_hard",
        });
        expect(response.status).toBe(401);
      });
    });

    describe("GET /rewards/tier-benefits", () => {
      test("returns tier benefits with unlock status", async () => {
        const state = getState();
        const { response, duration } = await api.get("/rewards/tier-benefits", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty("currentTier");
        expect(response.data).toHaveProperty("currentLevel");
        expect(response.data).toHaveProperty("totalFitPoints");
        expect(response.data).toHaveProperty("tiers");
        expect(Array.isArray(response.data.tiers)).toBe(true);

        if (response.data.tiers.length > 0) {
          const tier = response.data.tiers[0];
          expect(tier).toHaveProperty("name");
          expect(tier).toHaveProperty("minLevel");
          expect(tier).toHaveProperty("benefits");
          expect(tier).toHaveProperty("isUnlocked");
          expect(tier).toHaveProperty("isCurrent");
        }

        console.log(
          `     Tier benefits retrieved: ${response.data.tiers.length} tiers (${duration}ms)`
        );
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/rewards/tier-benefits");
        expect(response.status).toBe(401);
      });
    });
  });
});
