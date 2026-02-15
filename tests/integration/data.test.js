/**
 * Data Routes Integration Tests
 *
 * Tests all data management endpoints including:
 * - Daily Logs (CRUD)
 * - Dashboard (weekly summary)
 * - Exercise Existence (CRUD, history)
 * - Workout Routines (CRUD)
 * - Mesocycles (CRUD)
 * - Microcycles (CRUD)
 *
 * Run: npm run test:integration
 */

const {
  api,
  getState,
  setState,
  clearState,
  createTestUser,
  cleanupTestUser,
} = require("../helpers");

// Test user and data IDs created during tests
let testUser;
let createdDailyLogId;
let createdExerciseExistenceId;
let createdWorkoutRoutineId;
let createdMesocycleId;
let createdMicrocycleId;
let createdCustomExerciseId;
let createdCustomExerciseName;
let createdCustomExerciseSuffix;
let deviceSyncDate;

// Today's date for test data
const today = new Date().toISOString().split("T")[0];

describe("Data Routes API", () => {
  // =========================================================================
  // SETUP - Create test user and login
  // =========================================================================

  beforeAll(async () => {
    clearState();
    testUser = createTestUser();
    console.log(`\n  📧 Test Email: ${testUser.email}`);

    // Try to sign up first
    const { response: signupRes } = await api.post("/auth/signup", testUser);
    
    if (signupRes.status === 200 || signupRes.status === 201) {
      // Signup successful
      const userId = signupRes.data.userId || signupRes.data.user?.id;
      setState({
        accessToken: signupRes.data.accessToken,
        refreshToken: signupRes.data.refreshToken,
        userId: userId,
        email: testUser.email,
      });
      console.log(`  ✓ Test user created: ${userId}\n`);
    } else if (signupRes.data?.message?.includes("Phone number already registered")) {
      // Phone already registered to a different user - this is a known test infrastructure limitation
      // The shared test phone can only be used by one user at a time
      console.log("  ⚠ Phone number is registered to a different test user");
      console.log("  ℹ Run the auth-basic tests first to clean up, or manually clean the test phone from the database");
      console.log("  ℹ Alternatively, update tests/helpers/test-user.js with a different test phone");
      throw new Error(
        "Test phone number is already registered to a different email. " +
        "Please run cleanup for the previous test user first, or use a different phone number in test-user.js"
      );
    } else if (signupRes.data?.message?.includes("already registered")) {
      // Email already exists - try signin
      console.log("  ⚠ Email already exists, signing in...");
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
      console.log(`  ✓ Signed in as existing user: ${userId}\n`);
    } else {
      throw new Error(`Signup failed: ${JSON.stringify(signupRes.data)}`);
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
  // DAILY LOGS
  // =========================================================================

  describe("Daily Logs", () => {
    describe("POST /data/dailylog", () => {
      test("creates daily log with valid data", async () => {
        const state = getState();
        const logData = {
          effectiveDate: today,
          sleep: 7.5,
          steps: 10000,
          heartrate: 72,
          waterIntake: 2.5,
          sleepQuality: "good",
          caloriesBurned: 2500,
          restingHeartRate: 60,
          weight: 175,
        };

        const { response, duration } = await api.post("/data/dailylog", logData, {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.logId).toBeDefined();

        createdDailyLogId = response.data.logId;
        console.log(`     Daily log created: ${createdDailyLogId} (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.post("/data/dailylog", {
          effectiveDate: today,
          sleep: 8,
        });

        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/dailylogs", () => {
      test("returns paginated daily logs", async () => {
        const state = getState();
        const { response, duration } = await api.get("/data/dailylogs", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty("data");
        expect(response.data).toHaveProperty("pagination");
        expect(Array.isArray(response.data.data)).toBe(true);

        console.log(`     Retrieved ${response.data.data.length} logs (${duration}ms)`);
      });

      test("supports pagination parameters", async () => {
        const state = getState();
        const { response } = await api.get("/data/dailylogs?page=1&limit=5", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(response.data.pagination.page).toBe(1);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/dailylogs");
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/dailylog/:logId", () => {
      test("returns specific daily log", async () => {
        if (!createdDailyLogId) {
          console.log("     [SKIP] No daily log created");
          return;
        }

        const state = getState();
        const { response, duration } = await api.get(
          `/data/dailylog/${createdDailyLogId}`,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.LogID || response.data.logId).toBe(createdDailyLogId);
        console.log(`     Retrieved log ${createdDailyLogId} (${duration}ms)`);
      });

      test("returns 404 for non-existent log", async () => {
        const state = getState();
        const { response } = await api.get("/data/dailylog/999999", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect([404, 200]).toContain(response.status);
        if (response.status === 200) {
          expect(response.data).toBeNull();
        }
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/dailylog/1");
        expect(response.status).toBe(401);
      });
    });

    describe("PATCH /data/dailylog/:logId", () => {
      test("updates daily log", async () => {
        if (!createdDailyLogId) {
          console.log("     [SKIP] No daily log created");
          return;
        }

        const state = getState();
        const { response, duration } = await api.patch(
          `/data/dailylog/${createdDailyLogId}`,
          { steps: 12000, waterIntake: 3.0 },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Daily log updated (${duration}ms)`);
      });

      test("returns 404 for non-existent log", async () => {
        const state = getState();
        const { response } = await api.patch(
          "/data/dailylog/999999",
          { steps: 5000 },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(404);
      });

      test("requires authentication", async () => {
        const { response } = await api.patch("/data/dailylog/1", { steps: 5000 });
        expect(response.status).toBe(401);
      });
    });

    describe("DELETE /data/dailylog/:logId", () => {
      test("deletes daily log", async () => {
        if (!createdDailyLogId) {
          console.log("     [SKIP] No daily log created");
          return;
        }

        const state = getState();
        const { response, duration } = await api.delete(
          `/data/dailylog/${createdDailyLogId}`,
          {},
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Daily log deleted (${duration}ms)`);
        createdDailyLogId = null; // Mark as deleted
      });

      test("returns 404 for non-existent log", async () => {
        const state = getState();
        const { response } = await api.delete(
          "/data/dailylog/999999",
          {},
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(404);
      });

      test("requires authentication", async () => {
        const { response } = await api.delete("/data/dailylog/1");
        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // DEVICE DATA
  // =========================================================================

  describe("Device Data", () => {
    describe("PATCH /data/deviceData/sync/:deviceType", () => {
      test("syncs device data payload", async () => {
        const state = getState();
        deviceSyncDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

        const payload = {
          deviceData: [
            {
              stepCount: 7560,
              calories: 2200,
              sleepRating: "good",
              collectedDate: deviceSyncDate,
              sleep: 7.2,
              heartRate: 67,
              waterIntake: 2.4,
              restingHeartRate: 58,
              heartRateVariability: 41,
              weight: 173.5,
            },
          ],
        };

        const { response, duration } = await api.patch(
          "/data/deviceData/sync/device-test",
          payload,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.message).toBeDefined();
        console.log(`     Device data synced (${duration}ms)`);
      });

      test("returns 400 when no device data is provided", async () => {
        const state = getState();
        const { response } = await api.patch(
          "/data/deviceData/sync/device-test",
          { deviceData: [] },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(400);
      });

      test("requires authentication", async () => {
        const { response } = await api.patch("/data/deviceData/sync/device-test", {
          deviceData: [{ stepCount: 1000, collectedDate: today }],
        });

        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/deviceData/lastSync/:deviceType", () => {
      test("returns last synced timestamp", async () => {
        const state = getState();
        const { response, duration } = await api.get(
          "/data/deviceData/lastSync/device-test",
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        if (response.data[0]) {
          const collected =
            response.data[0].CollectedDate ?? response.data[0].collectedDate;
          expect(collected).toBeDefined();
        }
        console.log(`     Last sync fetched (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/deviceData/lastSync/device-test");
        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // EXERCISES (CUSTOM)
  // =========================================================================

  describe("Custom Exercises", () => {
    describe("POST /data/exercises", () => {
      test("creates a custom exercise", async () => {
        const state = getState();
        const uniqueSuffix = Date.now();
        const exerciseName = `Bird Dog ${uniqueSuffix}`;
        const exerciseId = `custom_bird_dog_${uniqueSuffix}_a`;
        const payload = {
          ExerciseName: exerciseName,
          ExerciseId: exerciseId,
          TargetMuscle: "core",
          Equipment: "bodyweight",
          Instructions: "Keep form strict and controlled.",
          ImageURL: "https://example.com/custom.gif",
        };

        const { response, duration } = await api.post(
          "/data/exercises",
          payload,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect([200, 201]).toContain(response.status);
        expect(response.data.success).toBe(true);
        expect(response.data.data).toHaveProperty("MasterExerciseID");
        expect(response.data.data).toHaveProperty("ExerciseId");

        createdCustomExerciseId = response.data.data.ExerciseId;
        createdCustomExerciseName = exerciseName;
        createdCustomExerciseSuffix = uniqueSuffix;
        console.log(`     Custom exercise saved (${duration}ms)`);
      });

      test("is idempotent for existing ExerciseId", async () => {
        if (!createdCustomExerciseId) {
          console.log("     [SKIP] No custom exercise created");
          return;
        }

        const state = getState();
        const { response } = await api.post(
          "/data/exercises",
          {
            ExerciseName: "Test Custom Exercise",
            ExerciseId: createdCustomExerciseId,
          },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.data.ExerciseId).toBe(createdCustomExerciseId);
      });

      test("dedupes by normalized ExerciseName", async () => {
        if (!createdCustomExerciseId || !createdCustomExerciseSuffix) {
          console.log("     [SKIP] No custom exercise created");
          return;
        }

        const state = getState();
        const { response } = await api.post(
          "/data/exercises",
          {
            ExerciseName: `Bird-Dog ${createdCustomExerciseSuffix} (alt)`,
            ExerciseId: `custom_bird_dog_${createdCustomExerciseSuffix}_b`,
          },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.data.ExerciseId).toBe(createdCustomExerciseId);
      });

      test("accepts long field values", async () => {
        const state = getState();
        const uniqueSuffix = Date.now();
        const longName = `Long Exercise ${uniqueSuffix} ${"A".repeat(220)}`;
        const longExerciseId = `custom_long_${uniqueSuffix}_${"b".repeat(150)}`;
        const longTarget = "t".repeat(150);
        const longEquipment = "e".repeat(150);
        const longInstructions = "i".repeat(1000);
        const longImageUrl = "x".repeat(520);

        const { response } = await api.post(
          "/data/exercises",
          {
            ExerciseName: longName,
            ExerciseId: longExerciseId,
            TargetMuscle: longTarget,
            Equipment: longEquipment,
            Instructions: longInstructions,
            ImageURL: longImageUrl,
          },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect([200, 201]).toContain(response.status);
        expect(response.data.success).toBe(true);
        expect(response.data.data).toHaveProperty("ExerciseId");
      });

      test("rejects missing ExerciseName", async () => {
        const state = getState();
        const { response } = await api.post(
          "/data/exercises",
          { ExerciseId: `custom_missing_${Date.now()}` },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(400);
      });

      test("requires authentication", async () => {
        const { response } = await api.post("/data/exercises", {
          ExerciseName: "No Auth Exercise",
        });

        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // PRE ASSESSMENT
  // =========================================================================

  describe("Pre Assessment", () => {
    describe("POST /data/preworkoutassessment", () => {
      test("creates pre assessment with valid data", async () => {
        const state = getState();
        const payload = {
          WorkoutPlanID: "plan-123",
          Feeling: "Energized",
          WaterIntake: "2L",
          SleepQuality: 4,
          SleepHours: "7.5",
          RecoveryStatus: "Ready",
          CreatedAt: new Date().toISOString(),
        };

        const { response, duration } = await api.post(
          "/data/preworkoutassessment",
          payload,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Pre assessment saved (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.post("/data/preworkoutassessment", {
          Feeling: "Good",
        });

        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // POST ASSESSMENT
  // =========================================================================

  describe("Post Assessment", () => {
    describe("POST /data/postassessment", () => {
      test("creates post assessment with valid data", async () => {
        const state = getState();
        const payload = {
          FeelingAfterWorkout: "Great session",
          Assessperformance: "Felt strong and stable",
          NextSessionPlans: "Increase reps next time",
          LastUpdateDate: new Date().toISOString(),
        };

        const { response, duration } = await api.post(
          "/data/postassessment",
          payload,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Post assessment saved (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.post("/data/postassessment", {
          FeelingAfterWorkout: "Good",
        });

        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // PAYMENTS
  // =========================================================================

  describe("Payments", () => {
    describe("POST /data/payments/initialize", () => {
      test("fails fast when Stripe secret key is missing", async () => {
        const stripeKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
        if (stripeKey) {
          console.log("     [SKIP] STRIPE_SECRET_KEY is configured");
          return;
        }

        const state = getState();
        const { response } = await api.post(
          "/data/payments/initialize",
          {
            plan: "premium",
            billingInterval: "monthly",
            paymentMethod: "card",
          },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(500);
        expect(response.data.message).toMatch(/STRIPE_SECRET_KEY/i);
      });
    });
  });

  // =========================================================================
  // DASHBOARD
  // =========================================================================

  describe("Dashboard", () => {
    describe("GET /data/dashboard/weekly-summary", () => {
      test("returns weekly summary data", async () => {
        const state = getState();
        const { response, duration } = await api.get(
          "/data/dashboard/weekly-summary",
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.data).toBeDefined();
        expect(Array.isArray(response.data.data)).toBe(true);
        expect(response.data.data.length).toBe(7); // 7 days

        // Verify structure of each day
        if (response.data.data.length > 0) {
          const day = response.data.data[0];
          expect(day).toHaveProperty("Date");
          expect(day).toHaveProperty("DayName");
          expect(day).toHaveProperty("PlannedWorkouts");
          expect(day).toHaveProperty("TotalExercises");
          expect(day).toHaveProperty("CompletedExercises");
          expect(day).toHaveProperty("CompletionPercent");
        }

        console.log(`     Weekly summary retrieved (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/dashboard/weekly-summary");
        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // EXERCISE EXISTENCE
  // =========================================================================

  describe("Exercise Existence", () => {
    describe("POST /data/exerciseexistence", () => {
      test("creates exercise instances", async () => {
        const state = getState();
        const exerciseData = {
          exerciseList: [
            {
              exercise: {
                id: "0001",
                exerciseName: "Test Bench Press",
                target: "chest",
                equipment: "barbell",
                instructions: ["Lie down", "Press up"],
                gifURL: "",
              },
              reps: 10,
              sets: 3,
              difficulty: "medium",
              date: today,
              note: "Integration test exercise",
              rir: 2,
              rpe: 7,
              status: "completed",
              completed: true,
              weight: 135,
              workoutName: "Test Chest Day",
            },
          ],
        };

        const { response, duration } = await api.post(
          "/data/exerciseexistence",
          exerciseData,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.ids).toBeDefined();
        expect(Array.isArray(response.data.ids)).toBe(true);
        expect(response.data.ids.length).toBeGreaterThan(0);

        createdExerciseExistenceId = response.data.ids[0];
        console.log(`     Exercise created: ${createdExerciseExistenceId} (${duration}ms)`);
      });

      test("reuses canonical exerciseId when names match", async () => {
        const state = getState();
        let canonicalExerciseId = createdCustomExerciseId;
        let nameSuffix = createdCustomExerciseSuffix;

        if (!canonicalExerciseId || !nameSuffix) {
          const uniqueSuffix = Date.now();
          const baseName = `Bird Dog ${uniqueSuffix}`;
          const { response: createResponse } = await api.post(
            "/data/exercises",
            {
              ExerciseName: baseName,
              ExerciseId: `custom_bird_dog_${uniqueSuffix}_seed`,
              TargetMuscle: "core",
              Equipment: "bodyweight",
              Instructions: "Hold position.",
            },
            { Authorization: `Bearer ${state.accessToken}` }
          );

          canonicalExerciseId = createResponse.data?.data?.ExerciseId;
          nameSuffix = uniqueSuffix;
        }

        if (!canonicalExerciseId || !nameSuffix) {
          console.log("     [SKIP] No canonical exercise id available");
          return;
        }

        const sourceExerciseId = `custom_bird_dog_${nameSuffix}_source`;
        const { response } = await api.post(
          "/data/exerciseexistence",
          {
            exerciseList: [
              {
                exercise: {
                  id: sourceExerciseId,
                  exerciseName: `Bird-Dog ${nameSuffix} (alt)`,
                  target: "core",
                  equipment: "bodyweight",
                  instructions: ["Hold position"],
                  gifURL: "",
                },
                reps: 5,
                sets: 2,
                difficulty: "easy",
                date: today,
                note: "Dedupe by name",
                rir: 1,
                rpe: 5,
                status: "completed",
                completed: true,
                weight: 0,
                workoutName: "Test Core Day",
              },
            ],
          },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);

        const { response: canonicalResponse } = await api.get(
          `/data/exerciseexistence/user/${canonicalExerciseId}`,
          { Authorization: `Bearer ${state.accessToken}` }
        );
        expect(canonicalResponse.status).toBe(200);
        expect(Array.isArray(canonicalResponse.data)).toBe(true);
        expect(canonicalResponse.data.length).toBeGreaterThan(0);

        const { response: sourceResponse } = await api.get(
          `/data/exerciseexistence/user/${sourceExerciseId}`,
          { Authorization: `Bearer ${state.accessToken}` }
        );
        expect(sourceResponse.status).toBe(200);
        expect(Array.isArray(sourceResponse.data)).toBe(true);
        expect(sourceResponse.data.length).toBe(0);
      });

      test("rejects empty exercise list", async () => {
        const state = getState();
        const { response } = await api.post(
          "/data/exerciseexistence",
          { exerciseList: [] },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(400);
      });

      test("requires authentication", async () => {
        const { response } = await api.post("/data/exerciseexistence", {
          exerciseList: [],
        });
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/exerciseexistences", () => {
      test("returns paginated exercise instances", async () => {
        const state = getState();
        const { response, duration } = await api.get("/data/exerciseexistences", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty("data");
        expect(response.data).toHaveProperty("pagination");
        expect(Array.isArray(response.data.data)).toBe(true);

        console.log(`     Retrieved ${response.data.data.length} exercises (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/exerciseexistences");
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/exerciseexistence/user/:exerciseId", () => {
      test("returns exercise instances by exercise ID", async () => {
        const state = getState();
        const { response, duration } = await api.get(
          "/data/exerciseexistence/user/0001",
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        console.log(`     Retrieved by exercise ID (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/exerciseexistence/user/0001");
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/exerciseexistence/date/:date", () => {
      test("returns exercise instances by date", async () => {
        const state = getState();
        const { response, duration } = await api.get(
          `/data/exerciseexistence/date/${today}`,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        console.log(`     Retrieved by date (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get(`/data/exerciseexistence/date/${today}`);
        expect(response.status).toBe(401);
      });
    });

    describe("PATCH /data/exerciseexistence/:id", () => {
      test("updates exercise instance", async () => {
        if (!createdExerciseExistenceId) {
          console.log("     [SKIP] No exercise created");
          return;
        }

        const state = getState();
        const { response, duration } = await api.patch(
          `/data/exerciseexistence/${createdExerciseExistenceId}`,
          { weight: 145, reps: 12 },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Exercise updated (${duration}ms)`);
      });

      test("returns 404 for non-existent exercise", async () => {
        const state = getState();
        const { response } = await api.patch(
          "/data/exerciseexistence/999999",
          { weight: 100 },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(404);
      });

      test("requires authentication", async () => {
        const { response } = await api.patch("/data/exerciseexistence/1", {
          weight: 100,
        });
        expect(response.status).toBe(401);
      });
    });

    describe("DELETE /data/exerciseexistence/:id", () => {
      test("deletes exercise instance", async () => {
        if (!createdExerciseExistenceId) {
          console.log("     [SKIP] No exercise created");
          return;
        }

        const state = getState();
        const { response, duration } = await api.delete(
          `/data/exerciseexistence/${createdExerciseExistenceId}`,
          {},
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Exercise deleted (${duration}ms)`);
        createdExerciseExistenceId = null;
      });

      test("returns 404 for non-existent exercise", async () => {
        const state = getState();
        const { response } = await api.delete(
          "/data/exerciseexistence/999999",
          {},
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(404);
      });

      test("requires authentication", async () => {
        const { response } = await api.delete("/data/exerciseexistence/1");
        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // EXERCISE HISTORY ENDPOINTS
  // =========================================================================

  describe("Exercise History", () => {
    describe("GET /data/exercises/unfinished", () => {
      test("returns unfinished exercises", async () => {
        const state = getState();
        const { response, duration } = await api.get("/data/exercises/unfinished", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        console.log(`     Unfinished exercises: ${response.data.length} (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/exercises/unfinished");
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/exercises/previous-all", () => {
      test("returns previous workout data", async () => {
        const state = getState();
        const { response, duration } = await api.get("/data/exercises/previous-all", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(typeof response.data).toBe("object");
        console.log(`     Previous exercises retrieved (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/exercises/previous-all");
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/exercises/history", () => {
      test("returns exercise history", async () => {
        const state = getState();
        const { response, duration } = await api.get("/data/exercises/history", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        console.log(`     Exercise history: ${response.data.length} items (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/exercises/history");
        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // WORKOUT ROUTINES
  // =========================================================================

  describe("Workout Routines", () => {
    describe("POST /data/workoutroutine", () => {
      test("creates workout routine", async () => {
        const state = getState();
        const routineData = {
          workoutName: "Test Push Day",
          exerciseInstances: "",
          equipment: "barbell,dumbbell",
          duration: 60,
          caloriesBurned: 300,
          intensity: 7,
          load: 5000,
          durationLeft: 0,
          completed: 0,
          workoutRoutineDate: today,
        };

        const { response, duration } = await api.post(
          "/data/workoutroutine",
          routineData,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        console.log(`     Workout routine created (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.post("/data/workoutroutine", {
          workoutName: "Test",
        });
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/workoutroutines", () => {
      test("returns paginated workout routines", async () => {
        const state = getState();
        const { response, duration } = await api.get("/data/workoutroutines", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty("data");
        expect(response.data).toHaveProperty("pagination");
        expect(Array.isArray(response.data.data)).toBe(true);

        // Store first routine ID for later tests
        if (response.data.data.length > 0) {
          createdWorkoutRoutineId = response.data.data[0].WorkoutRoutineID;
        }

        console.log(`     Retrieved ${response.data.data.length} routines (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/workoutroutines");
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/workoutroutine/:id", () => {
      test("returns specific workout routine", async () => {
        if (!createdWorkoutRoutineId) {
          console.log("     [SKIP] No workout routine available");
          return;
        }

        const state = getState();
        const { response, duration } = await api.get(
          `/data/workoutroutine/${createdWorkoutRoutineId}`,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.WorkoutRoutineID).toBe(createdWorkoutRoutineId);
        console.log(`     Retrieved routine ${createdWorkoutRoutineId} (${duration}ms)`);
      });

      test("returns 404 for non-existent routine", async () => {
        const state = getState();
        const { response } = await api.get("/data/workoutroutine/999999", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(404);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/workoutroutine/1");
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/workoutroutines/date/:date", () => {
      test("returns routines by date", async () => {
        const state = getState();
        const { response, duration } = await api.get(
          `/data/workoutroutines/date/${today}`,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        console.log(`     Routines for ${today}: ${response.data.length} (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get(`/data/workoutroutines/date/${today}`);
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/workoutroutine/exerciseinstances/:id", () => {
      test("returns exercise instances for routine", async () => {
        if (!createdWorkoutRoutineId) {
          console.log("     [SKIP] No workout routine available");
          return;
        }

        const state = getState();
        const { response, duration } = await api.get(
          `/data/workoutroutine/exerciseinstances/${createdWorkoutRoutineId}`,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        console.log(`     Exercise instances: ${response.data.length} (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/workoutroutine/exerciseinstances/1");
        expect(response.status).toBe(401);
      });
    });

    describe("PATCH /data/workoutroutine/:id", () => {
      test("updates workout routine", async () => {
        if (!createdWorkoutRoutineId) {
          console.log("     [SKIP] No workout routine available");
          return;
        }

        const state = getState();
        const { response, duration } = await api.patch(
          `/data/workoutroutine/${createdWorkoutRoutineId}`,
          { duration: 75, completed: 1 },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Routine updated (${duration}ms)`);
      });

      test("returns 404 for non-existent routine", async () => {
        const state = getState();
        const { response } = await api.patch(
          "/data/workoutroutine/999999",
          { duration: 60 },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(404);
      });

      test("requires authentication", async () => {
        const { response } = await api.patch("/data/workoutroutine/1", {
          duration: 60,
        });
        expect(response.status).toBe(401);
      });
    });

    describe("DELETE /data/workoutroutine/:id", () => {
      test("deletes workout routine", async () => {
        if (!createdWorkoutRoutineId) {
          console.log("     [SKIP] No workout routine available");
          return;
        }

        const state = getState();
        const { response, duration } = await api.delete(
          `/data/workoutroutine/${createdWorkoutRoutineId}`,
          {},
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Routine deleted (${duration}ms)`);
        createdWorkoutRoutineId = null;
      });

      test("returns 404 for non-existent routine", async () => {
        const state = getState();
        const { response } = await api.delete(
          "/data/workoutroutine/999999",
          {},
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(404);
      });

      test("requires authentication", async () => {
        const { response } = await api.delete("/data/workoutroutine/1");
        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // MESOCYCLES
  // =========================================================================

  describe("Mesocycles", () => {
    const mesoStartDate = today;
    const mesoEndDate = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    describe("POST /data/mesocycle", () => {
      test("creates mesocycle", async () => {
        const state = getState();
        const mesoData = {
          start_date: mesoStartDate,
          end_date: mesoEndDate,
          is_current: 1,
          created_date: new Date().toISOString(),
        };

        const { response, duration } = await api.post("/data/mesocycle", mesoData, {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        console.log(`     Mesocycle created (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.post("/data/mesocycle", {
          start_date: mesoStartDate,
        });
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/mesocycles", () => {
      test("returns paginated mesocycles", async () => {
        const state = getState();
        const { response, duration } = await api.get("/data/mesocycles", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty("data");
        expect(response.data).toHaveProperty("pagination");
        expect(Array.isArray(response.data.data)).toBe(true);

        // Store first mesocycle ID for later tests
        if (response.data.data.length > 0) {
          createdMesocycleId = response.data.data[0].mesocycle_id;
        }

        console.log(`     Retrieved ${response.data.data.length} mesocycles (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/mesocycles");
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/mesocycles/date", () => {
      test("returns mesocycles by date range", async () => {
        const state = getState();
        const { response, duration } = await api.get(
          `/data/mesocycles/date?start_date=${mesoStartDate}&end_date=${mesoEndDate}`,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        console.log(`     Mesocycles in range: ${response.data.length} (${duration}ms)`);
      });

      test("returns 400 for missing dates", async () => {
        const state = getState();
        const { response } = await api.get("/data/mesocycles/date", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(400);
      });

      test("requires authentication", async () => {
        const { response } = await api.get(
          `/data/mesocycles/date?start_date=${mesoStartDate}&end_date=${mesoEndDate}`
        );
        expect(response.status).toBe(401);
      });
    });

    describe("PATCH /data/mesocycle/:id", () => {
      test("updates mesocycle", async () => {
        if (!createdMesocycleId) {
          console.log("     [SKIP] No mesocycle available");
          return;
        }

        const state = getState();
        const newEndDate = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

        const { response, duration } = await api.patch(
          `/data/mesocycle/${createdMesocycleId}`,
          { end_date: newEndDate },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Mesocycle updated (${duration}ms)`);
      });

      test("returns 404 for non-existent mesocycle", async () => {
        const state = getState();
        const { response } = await api.patch(
          "/data/mesocycle/999999",
          { end_date: mesoEndDate },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(404);
      });

      test("requires authentication", async () => {
        const { response } = await api.patch("/data/mesocycle/1", {
          end_date: mesoEndDate,
        });
        expect(response.status).toBe(401);
      });
    });

    describe("DELETE /data/mesocycle/:id", () => {
      // Note: We'll test delete at the end to not affect other tests

      test("returns 404 for non-existent mesocycle", async () => {
        const state = getState();
        const { response } = await api.delete(
          "/data/mesocycle/999999",
          {},
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(404);
      });

      test("requires authentication", async () => {
        const { response } = await api.delete("/data/mesocycle/1");
        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // MICROCYCLES
  // =========================================================================

  describe("Microcycles", () => {
    const microStartDate = today;
    const microEndDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    describe("POST /data/microcycle", () => {
      test("creates microcycle", async () => {
        if (!createdMesocycleId) {
          console.log("     [SKIP] No mesocycle available");
          return;
        }

        const state = getState();
        const microData = {
          mesocycle_id: createdMesocycleId,
          start_date: microStartDate,
          end_date: microEndDate,
          is_current: 1,
          created_date: new Date().toISOString(),
        };

        const { response, duration } = await api.post("/data/microcycle", microData, {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        console.log(`     Microcycle created (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.post("/data/microcycle", {
          mesocycle_id: 1,
        });
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/microcycles", () => {
      test("returns paginated microcycles", async () => {
        const state = getState();
        const { response, duration } = await api.get("/data/microcycles", {
          Authorization: `Bearer ${state.accessToken}`,
        });

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty("data");
        expect(response.data).toHaveProperty("pagination");
        expect(Array.isArray(response.data.data)).toBe(true);

        // Store first microcycle ID for later tests
        if (response.data.data.length > 0) {
          createdMicrocycleId = response.data.data[0].microcycle_id;
        }

        console.log(`     Retrieved ${response.data.data.length} microcycles (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/microcycles");
        expect(response.status).toBe(401);
      });
    });

    describe("GET /data/microcycles/:mesocycle_id", () => {
      test("returns microcycles for mesocycle", async () => {
        if (!createdMesocycleId) {
          console.log("     [SKIP] No mesocycle available");
          return;
        }

        const state = getState();
        const { response, duration } = await api.get(
          `/data/microcycles/${createdMesocycleId}`,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        console.log(`     Microcycles for mesocycle: ${response.data.length} (${duration}ms)`);
      });

      test("requires authentication", async () => {
        const { response } = await api.get("/data/microcycles/1");
        expect(response.status).toBe(401);
      });
    });

    describe("PATCH /data/microcycle/:id", () => {
      test("updates microcycle", async () => {
        if (!createdMicrocycleId) {
          console.log("     [SKIP] No microcycle available");
          return;
        }

        const state = getState();
        const newEndDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

        const { response, duration } = await api.patch(
          `/data/microcycle/${createdMicrocycleId}`,
          { end_date: newEndDate },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Microcycle updated (${duration}ms)`);
      });

      test("returns 404 for non-existent microcycle", async () => {
        const state = getState();
        const { response } = await api.patch(
          "/data/microcycle/999999",
          { end_date: microEndDate },
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(404);
      });

      test("requires authentication", async () => {
        const { response } = await api.patch("/data/microcycle/1", {
          end_date: microEndDate,
        });
        expect(response.status).toBe(401);
      });
    });

    describe("DELETE /data/microcycle/:id", () => {
      test("deletes microcycle", async () => {
        if (!createdMicrocycleId) {
          console.log("     [SKIP] No microcycle available");
          return;
        }

        const state = getState();
        const { response, duration } = await api.delete(
          `/data/microcycle/${createdMicrocycleId}`,
          {},
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        console.log(`     Microcycle deleted (${duration}ms)`);
        createdMicrocycleId = null;
      });

      test("returns 404 for non-existent microcycle", async () => {
        const state = getState();
        const { response } = await api.delete(
          "/data/microcycle/999999",
          {},
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(404);
      });

      test("requires authentication", async () => {
        const { response } = await api.delete("/data/microcycle/1");
        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // COMBINED MESOCYCLE WITH MICROCYCLE
  // =========================================================================

  describe("Combined Mesocycle with Microcycle", () => {
    describe("POST /data/mesocycle-with-microcycle", () => {
      test("creates mesocycle and microcycle together", async () => {
        const state = getState();
        const combinedData = {
          mesocycleStart: today,
          mesocycleEnd: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
          microcycleStart: today,
          microcycleEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
          is_current: 1,
          created_date: new Date().toISOString(),
        };

        const { response, duration } = await api.post(
          "/data/mesocycle-with-microcycle",
          combinedData,
          { Authorization: `Bearer ${state.accessToken}` }
        );

        expect(response.status).toBe(200);
        expect(response.data.mesocycle_id).toBeDefined();
        console.log(
          `     Created mesocycle ${response.data.mesocycle_id} with microcycle (${duration}ms)`
        );
      });

      test("requires authentication", async () => {
        const { response } = await api.post("/data/mesocycle-with-microcycle", {
          mesocycleStart: today,
        });
        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // CLEANUP - Delete mesocycle at the end
  // =========================================================================

  describe("Cleanup", () => {
    test("deletes test mesocycle", async () => {
      if (!createdMesocycleId) {
        console.log("     [SKIP] No mesocycle to delete");
        return;
      }

      const state = getState();
      const { response, duration } = await api.delete(
        `/data/mesocycle/${createdMesocycleId}`,
        {},
        { Authorization: `Bearer ${state.accessToken}` }
      );

      expect(response.status).toBe(200);
      console.log(`     Mesocycle deleted (${duration}ms)`);
    });
  });
});
