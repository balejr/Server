/**
 * Reward Calculator Service
 *
 * Calculates eligibility for weekly/monthly rewards based on user activity data.
 * Called when daily logs are saved or when rewards screen is opened.
 */

const { getPool } = require("../config/db");
const logger = require("../utils/logger");

// Constants
const STEP_GOAL = 10000; // Daily step goal threshold
const WEEKLY_WORKOUT_GOAL = 3; // Workouts needed per week
const PERFECT_MONTH_DAYS = 30; // Consecutive days for perfect month

/**
 * Check if user completed weekly workout goal (3 workouts in 7 days)
 */
async function checkWeeklyGoal(userId, pool) {
  try {
    const result = await pool.request()
      .input("userId", userId)
      .query(`
        SELECT COUNT(DISTINCT CAST(WorkoutRoutineDate AS DATE)) as workout_days
        FROM dbo.ExerciseExistence
        WHERE UserID = @userId
          AND Completed = 1
          AND WorkoutRoutineDate >= DATEADD(DAY, -7, GETDATE())
      `);

    const workoutDays = result.recordset[0]?.workout_days || 0;
    return {
      completed: workoutDays >= WEEKLY_WORKOUT_GOAL,
      count: workoutDays,
      required: WEEKLY_WORKOUT_GOAL,
    };
  } catch (error) {
    logger.error("checkWeeklyGoal error:", error.message);
    return { completed: false, count: 0, required: WEEKLY_WORKOUT_GOAL };
  }
}

/**
 * Check if user hit 10k steps for 7 consecutive days
 */
async function checkStepStreak7(userId, pool) {
  try {
    // Get all days with 10k+ steps in last 30 days (to find streak)
    const result = await pool.request()
      .input("userId", userId)
      .input("stepGoal", STEP_GOAL)
      .query(`
        WITH StepDays AS (
          SELECT DISTINCT CAST(EffectiveDate AS DATE) as LogDate
          FROM dbo.DailyLogs
          WHERE UserID = @userId
            AND Steps >= @stepGoal
            AND EffectiveDate >= DATEADD(DAY, -30, GETDATE())
        ),
        NumberedDays AS (
          SELECT LogDate,
                 DATEDIFF(DAY, LogDate, GETDATE()) as days_ago,
                 ROW_NUMBER() OVER (ORDER BY LogDate DESC) as rn
          FROM StepDays
        ),
        StreakCalc AS (
          SELECT LogDate, days_ago, rn,
                 days_ago - rn as streak_group
          FROM NumberedDays
        )
        SELECT COUNT(*) as streak_length
        FROM StreakCalc
        WHERE streak_group = (
          SELECT TOP 1 streak_group
          FROM StreakCalc
          WHERE days_ago = 0 OR days_ago = 1
          ORDER BY LogDate DESC
        )
      `);

    const streakLength = result.recordset[0]?.streak_length || 0;
    return {
      completed: streakLength >= 7,
      currentStreak: streakLength,
      required: 7,
    };
  } catch (error) {
    logger.error("checkStepStreak7 error:", error.message);
    return { completed: false, currentStreak: 0, required: 7 };
  }
}

/**
 * Check if user completed 100% of weekly goals (weekly powerup)
 * Requires: weekly_goal completed
 */
async function checkWeeklyPowerup(userId, pool) {
  try {
    // Weekly powerup = weekly_goal is completed
    const weeklyGoal = await checkWeeklyGoal(userId, pool);
    return {
      completed: weeklyGoal.completed,
      weeklyGoalMet: weeklyGoal.completed,
    };
  } catch (error) {
    logger.error("checkWeeklyPowerup error:", error.message);
    return { completed: false, weeklyGoalMet: false };
  }
}

/**
 * Check if user has 30 consecutive days of activity (perfect month)
 * Activity = any DailyLog entry OR any completed ExerciseExistence
 */
async function checkPerfectMonth(userId, pool) {
  try {
    const result = await pool.request()
      .input("userId", userId)
      .query(`
        WITH ActivityDays AS (
          -- Days with daily logs
          SELECT DISTINCT CAST(EffectiveDate AS DATE) as ActivityDate
          FROM dbo.DailyLogs
          WHERE UserID = @userId
          UNION
          -- Days with completed workouts
          SELECT DISTINCT CAST(WorkoutRoutineDate AS DATE)
          FROM dbo.ExerciseExistence
          WHERE UserID = @userId AND Completed = 1
        ),
        NumberedDays AS (
          SELECT ActivityDate,
                 DATEDIFF(DAY, ActivityDate, GETDATE()) as days_ago,
                 ROW_NUMBER() OVER (ORDER BY ActivityDate DESC) as rn
          FROM ActivityDays
          WHERE ActivityDate <= GETDATE()
        ),
        StreakCalc AS (
          SELECT ActivityDate, days_ago, rn,
                 days_ago - rn as streak_group
          FROM NumberedDays
        )
        SELECT COUNT(*) as streak_length
        FROM StreakCalc
        WHERE streak_group = (
          SELECT TOP 1 streak_group
          FROM StreakCalc
          WHERE days_ago = 0 OR days_ago = 1
          ORDER BY ActivityDate DESC
        )
      `);

    const streakLength = result.recordset[0]?.streak_length || 0;
    return {
      completed: streakLength >= PERFECT_MONTH_DAYS,
      currentStreak: streakLength,
      required: PERFECT_MONTH_DAYS,
    };
  } catch (error) {
    logger.error("checkPerfectMonth error:", error.message);
    return { completed: false, currentStreak: 0, required: PERFECT_MONTH_DAYS };
  }
}

/**
 * Check hydration streak (7 consecutive days with water logged)
 * Used for challenge_complete
 */
async function checkHydrationStreak(userId, pool) {
  try {
    const result = await pool.request()
      .input("userId", userId)
      .query(`
        WITH WaterDays AS (
          SELECT DISTINCT CAST(EffectiveDate AS DATE) as LogDate
          FROM dbo.DailyLogs
          WHERE UserID = @userId
            AND WaterIntake IS NOT NULL
            AND WaterIntake > 0
            AND EffectiveDate >= DATEADD(DAY, -30, GETDATE())
        ),
        NumberedDays AS (
          SELECT LogDate,
                 DATEDIFF(DAY, LogDate, GETDATE()) as days_ago,
                 ROW_NUMBER() OVER (ORDER BY LogDate DESC) as rn
          FROM WaterDays
        ),
        StreakCalc AS (
          SELECT LogDate, days_ago, rn,
                 days_ago - rn as streak_group
          FROM NumberedDays
        )
        SELECT COUNT(*) as streak_length
        FROM StreakCalc
        WHERE streak_group = (
          SELECT TOP 1 streak_group
          FROM StreakCalc
          WHERE days_ago = 0 OR days_ago = 1
          ORDER BY LogDate DESC
        )
      `);

    const streakLength = result.recordset[0]?.streak_length || 0;
    return {
      completed: streakLength >= 7,
      currentStreak: streakLength,
      required: 7,
    };
  } catch (error) {
    logger.error("checkHydrationStreak error:", error.message);
    return { completed: false, currentStreak: 0, required: 7 };
  }
}

/**
 * Update reward progress in database
 */
async function updateRewardProgress(userId, rewardKey, currentProgress, isCompleted, pool) {
  try {
    // Get reward definition
    const rewardResult = await pool.request()
      .input("rewardKey", rewardKey)
      .query(`
        SELECT RewardID, RequiredCount
        FROM dbo.RewardDefinitions
        WHERE RewardKey = @rewardKey AND IsActive = 1
      `);

    if (rewardResult.recordset.length === 0) {
      return false;
    }

    const reward = rewardResult.recordset[0];

    // Check if progress record exists
    const progressResult = await pool.request()
      .input("userId", userId)
      .input("rewardId", reward.RewardID)
      .query(`
        SELECT ProgressID, IsCompleted, IsClaimed
        FROM dbo.UserRewardProgress
        WHERE UserID = @userId AND RewardID = @rewardId
      `);

    if (progressResult.recordset.length === 0) {
      // Create new progress record
      await pool.request()
        .input("userId", userId)
        .input("rewardId", reward.RewardID)
        .input("progress", currentProgress)
        .input("isCompleted", isCompleted)
        .query(`
          INSERT INTO dbo.UserRewardProgress (UserID, RewardID, CurrentProgress, IsCompleted, CompletedAt)
          VALUES (@userId, @rewardId, @progress, @isCompleted,
                  CASE WHEN @isCompleted = 1 THEN SYSDATETIMEOFFSET() ELSE NULL END)
        `);
    } else {
      const existing = progressResult.recordset[0];

      // Don't update if already claimed
      if (existing.IsClaimed) {
        return true;
      }

      // Update progress
      await pool.request()
        .input("progressId", existing.ProgressID)
        .input("progress", currentProgress)
        .input("isCompleted", isCompleted)
        .query(`
          UPDATE dbo.UserRewardProgress
          SET CurrentProgress = @progress,
              IsCompleted = @isCompleted,
              CompletedAt = CASE
                WHEN @isCompleted = 1 AND IsCompleted = 0 THEN SYSDATETIMEOFFSET()
                ELSE CompletedAt
              END
          WHERE ProgressID = @progressId
        `);
    }

    return true;
  } catch (error) {
    logger.error("updateRewardProgress error:", { rewardKey, error: error.message });
    return false;
  }
}

/**
 * Master function: Check all weekly/monthly rewards and update progress
 */
async function checkAndUpdateRewards(userId) {
  const pool = getPool();
  const updates = {};

  try {
    // Check weekly_goal (3 workouts in 7 days)
    const weeklyGoal = await checkWeeklyGoal(userId, pool);
    await updateRewardProgress(userId, "weekly_goal", weeklyGoal.count, weeklyGoal.completed, pool);
    updates.weekly_goal = weeklyGoal;

    // Check step_streak_7 (7 days of 10k steps)
    const stepStreak = await checkStepStreak7(userId, pool);
    await updateRewardProgress(userId, "step_streak_7", stepStreak.currentStreak, stepStreak.completed, pool);
    updates.step_streak_7 = stepStreak;

    // Check weekly_powerup (100% of weekly goals)
    const weeklyPowerup = await checkWeeklyPowerup(userId, pool);
    await updateRewardProgress(userId, "weekly_powerup", weeklyPowerup.completed ? 1 : 0, weeklyPowerup.completed, pool);
    updates.weekly_powerup = weeklyPowerup;

    // Check perfect_month (30-day streak)
    const perfectMonth = await checkPerfectMonth(userId, pool);
    await updateRewardProgress(userId, "perfect_month", perfectMonth.currentStreak, perfectMonth.completed, pool);
    updates.perfect_month = perfectMonth;

    // Check hydration streak for challenge_complete
    const hydrationStreak = await checkHydrationStreak(userId, pool);
    if (hydrationStreak.completed) {
      await updateRewardProgress(userId, "challenge_complete", 1, true, pool);
      updates.challenge_complete = { completed: true, reason: "hydration_streak" };
    } else {
      updates.hydration_streak = hydrationStreak;
    }

    logger.info("Rewards recalculated for user:", userId);
    return updates;
  } catch (error) {
    logger.error("checkAndUpdateRewards error:", { userId, error: error.message });
    throw error;
  }
}

module.exports = {
  checkWeeklyGoal,
  checkStepStreak7,
  checkWeeklyPowerup,
  checkPerfectMonth,
  checkHydrationStreak,
  checkAndUpdateRewards,
};
