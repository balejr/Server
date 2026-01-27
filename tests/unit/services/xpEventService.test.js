/**
 * Unit tests for xpEventService
 *
 * Tests verify that awardWorkoutComplete properly:
 * 1. Checks if already awarded today via wasAwardedToday
 * 2. Uses correct awardType (workout_complete vs custom_routine)
 * 3. Records the daily award via recordDailyAward
 */

// Mock dependencies before requiring
const mockRequest = {
  input: jest.fn().mockReturnThis(),
  query: jest.fn(),
};

const mockPool = {
  request: jest.fn(() => mockRequest),
};

jest.mock("../../../config/db", () => ({
  getPool: jest.fn(() => mockPool),
}));

jest.mock("../../../utils/logger", () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../../services/levelCalculator", () => ({
  calculateLevel: jest.fn(() => 1),
  getTierFromLevel: jest.fn(() => "BRONZE"),
  checkLevelUp: jest.fn(() => ({ leveledUp: false })),
  applyStreakBonus: jest.fn((xp) => xp),
}));

const { awardWorkoutComplete } = require("../../../services/xpEventService");

describe("xpEventService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest.input.mockReturnThis();
  });

  describe("awardWorkoutComplete()", () => {
    it("should return early if already awarded today for workout_complete", async () => {
      // wasAwardedToday returns true (record found)
      mockRequest.query.mockResolvedValueOnce({
        recordset: [{ 1: 1 }],
      });

      const result = await awardWorkoutComplete(123, false);

      expect(result.awarded).toBe(false);
      expect(result.reason).toBe("Already awarded today");

      // Verify it checked for workout_complete awardType
      expect(mockRequest.input).toHaveBeenCalledWith(
        "awardType",
        "workout_complete"
      );
    });

    it("should return early if already awarded today for custom_routine", async () => {
      mockRequest.query.mockResolvedValueOnce({
        recordset: [{ 1: 1 }],
      });

      const result = await awardWorkoutComplete(123, true);

      expect(result.awarded).toBe(false);
      expect(result.reason).toBe("Already awarded today");

      // Verify it checked for custom_routine awardType
      expect(mockRequest.input).toHaveBeenCalledWith(
        "awardType",
        "custom_routine"
      );
    });

    it("should use workout_complete awardType for regular workout", async () => {
      mockRequest.query.mockResolvedValueOnce({
        recordset: [{ 1: 1 }], // Already awarded
      });

      await awardWorkoutComplete(456, false);

      const inputCalls = mockRequest.input.mock.calls;
      const awardTypeCall = inputCalls.find(
        (call) => call[0] === "awardType"
      );

      expect(awardTypeCall[1]).toBe("workout_complete");
    });

    it("should use custom_routine awardType for custom workout", async () => {
      mockRequest.query.mockResolvedValueOnce({
        recordset: [{ 1: 1 }], // Already awarded
      });

      await awardWorkoutComplete(456, true);

      const inputCalls = mockRequest.input.mock.calls;
      const awardTypeCall = inputCalls.find(
        (call) => call[0] === "awardType"
      );

      expect(awardTypeCall[1]).toBe("custom_routine");
    });

    it("should return error object on database failure", async () => {
      const dbError = new Error("Connection failed");
      mockRequest.query.mockRejectedValueOnce(dbError);

      const result = await awardWorkoutComplete(123, false);

      expect(result.awarded).toBe(false);
      expect(result.error).toBe("Connection failed");
    });

    it("should call recordDailyAward INSERT when not already awarded", async () => {
      // wasAwardedToday returns false (no record)
      mockRequest.query.mockResolvedValueOnce({ recordset: [] });

      // recordDailyAward INSERT succeeds
      mockRequest.query.mockResolvedValueOnce({});

      // updateStreak UPDATE/INSERT
      mockRequest.query.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await awardWorkoutComplete(123, false);

      // Find the INSERT INTO DailyXPAwards call
      const queryCalls = mockRequest.query.mock.calls;
      const insertCall = queryCalls.find(
        (call) => call[0] && call[0].includes("INSERT INTO dbo.DailyXPAwards")
      );

      expect(insertCall).toBeDefined();
    });

    it("should pass correct XP amount (50) for regular workout to recordDailyAward", async () => {
      // wasAwardedToday returns false
      mockRequest.query.mockResolvedValueOnce({ recordset: [] });
      // All subsequent calls succeed
      mockRequest.query.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await awardWorkoutComplete(123, false);

      // Check xpAmount was set to 50
      const inputCalls = mockRequest.input.mock.calls;
      const xpCalls = inputCalls.filter((call) => call[0] === "xpAmount");

      // Should include 50 for recordDailyAward
      expect(xpCalls.some((call) => call[1] === 50)).toBe(true);
    });

    it("should pass correct XP amount (75) for custom routine to recordDailyAward", async () => {
      mockRequest.query.mockResolvedValueOnce({ recordset: [] });
      mockRequest.query.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await awardWorkoutComplete(123, true);

      const inputCalls = mockRequest.input.mock.calls;
      const xpCalls = inputCalls.filter((call) => call[0] === "xpAmount");

      expect(xpCalls.some((call) => call[1] === 75)).toBe(true);
    });

    describe("race condition prevention", () => {
      it("should return early when recordDailyAward fails due to unique constraint", async () => {
        // wasAwardedToday returns false (not awarded yet from this request's perspective)
        mockRequest.query.mockResolvedValueOnce({ recordset: [] });

        // recordDailyAward INSERT fails due to unique constraint (concurrent request already inserted)
        const uniqueConstraintError = new Error(
          "Violation of UNIQUE KEY constraint 'UQ_DailyXP_UserTypeDate'"
        );
        mockRequest.query.mockRejectedValueOnce(uniqueConstraintError);

        const result = await awardWorkoutComplete(123, false);

        // Should return early without awarding XP
        expect(result.awarded).toBe(false);
        expect(result.reason).toBe("Already awarded today");

        // Verify awardXP was NOT called (no UPDATE to UserRewards)
        const queryCalls = mockRequest.query.mock.calls;
        const updateUserRewardsCall = queryCalls.find(
          (call) => call[0] && call[0].includes("UPDATE dbo.UserRewards")
        );
        expect(updateUserRewardsCall).toBeUndefined();
      });

      it("should still throw on non-unique-constraint database errors", async () => {
        // wasAwardedToday returns false
        mockRequest.query.mockResolvedValueOnce({ recordset: [] });

        // recordDailyAward INSERT fails with a different error
        const dbError = new Error("Connection timeout");
        mockRequest.query.mockRejectedValueOnce(dbError);

        const result = await awardWorkoutComplete(123, false);

        // Should return error (caught by outer try-catch)
        expect(result.awarded).toBe(false);
        expect(result.error).toBe("Connection timeout");
      });

      it("should only award XP when INSERT succeeds (first concurrent request wins)", async () => {
        // wasAwardedToday returns false
        mockRequest.query.mockResolvedValueOnce({ recordset: [] });

        // recordDailyAward INSERT succeeds (first request wins)
        mockRequest.query.mockResolvedValueOnce({});

        // Subsequent queries for streak, awardXP, etc.
        mockRequest.query.mockResolvedValue({ recordset: [], rowsAffected: [1] });

        const result = await awardWorkoutComplete(123, false);

        expect(result.awarded).toBe(true);

        // Verify awardXP WAS called (UPDATE to UserRewards should exist)
        const queryCalls = mockRequest.query.mock.calls;
        const hasAwardXPCalls = queryCalls.some(
          (call) =>
            call[0] &&
            (call[0].includes("UPDATE dbo.UserRewards") ||
              call[0].includes("INSERT INTO dbo.UserRewardHistory"))
        );
        expect(hasAwardXPCalls).toBe(true);
      });
    });
  });
});
