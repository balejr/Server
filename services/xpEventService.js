/**
 * XP Event Service
 *
 * Handles awarding XP for various user activities.
 * Ensures XP is only awarded once per day for daily events.
 * Manages streak bonuses and level-up detection.
 */

const { getPool } = require("../config/db");
const logger = require("../utils/logger");
const {
  calculateLevel,
  getTierFromLevel,
  checkLevelUp,
  applyStreakBonus,
} = require("./levelCalculator");

// XP Values for different events
const XP_VALUES = {
  DAILY_SIGNIN: 10,
  WORKOUT_COMPLETE: 50,
  CUSTOM_ROUTINE: 75,
  WATER_LOG: 5,
  SLEEP_LOG: 5,
  STEP_GOAL: 20,
  FORM_REVIEW: 25,
  PERSONAL_RECORD: 50,
  DAILY_COMBO: 5,
};

/**
 * Award XP to a user and update their level
 * @param {number} userId - User ID
 * @param {number} xpAmount - Amount of XP to award
 * @param {string} reason - Reason for XP award
 * @param {number} rewardId - Optional reward ID for history
 * @param {object} pool - Optional database pool
 * @returns {object} - Result with new XP, level, and level-up info
 */
async function awardXP(userId, xpAmount, reason, rewardId = null, pool = null) {
  const dbPool = pool || getPool();

  try {
    // Get current XP and streak
    const userResult = await dbPool
      .request()
      .input("userId", userId)
      .query(`
        SELECT ur.TotalXP, ur.CurrentLevel, us.CurrentStreak
        FROM dbo.UserRewards ur
        LEFT JOIN dbo.UserStreaks us ON ur.UserID = us.UserID AND us.StreakType = 'workout'
        WHERE ur.UserID = @userId
      `);

    let currentXP = 0;
    let streakDays = 0;

    if (userResult.recordset.length === 0) {
      // Create UserRewards record if doesn't exist
      await dbPool
        .request()
        .input("userId", userId)
        .query(`
          INSERT INTO dbo.UserRewards (UserID, TotalXP, CurrentLevel, CurrentTier)
          VALUES (@userId, 0, 1, 'BRONZE')
        `);
    } else {
      currentXP = userResult.recordset[0].TotalXP || 0;
      streakDays = userResult.recordset[0].CurrentStreak || 0;
    }

    // Apply streak bonus if applicable
    const finalXP = applyStreakBonus(xpAmount, streakDays);
    const newTotalXP = currentXP + finalXP;

    // Check for level up
    const levelUpResult = checkLevelUp(currentXP, newTotalXP);
    const newLevel = calculateLevel(newTotalXP);
    const newTier = getTierFromLevel(newLevel);

    // Update user's XP and level
    await dbPool
      .request()
      .input("userId", userId)
      .input("newXP", newTotalXP)
      .input("newLevel", newLevel)
      .input("newTier", newTier)
      .input("levelUpAt", levelUpResult.leveledUp ? new Date() : null)
      .query(`
        UPDATE dbo.UserRewards
        SET TotalXP = @newXP,
            CurrentLevel = @newLevel,
            CurrentTier = @newTier,
            LevelUpAt = CASE WHEN @levelUpAt IS NOT NULL THEN @levelUpAt ELSE LevelUpAt END,
            LastUpdated = SYSDATETIMEOFFSET()
        WHERE UserID = @userId
      `);

    // Record in history
    await dbPool
      .request()
      .input("userId", userId)
      .input("rewardId", rewardId)
      .input("xpEarned", finalXP)
      .input("reason", reason)
      .query(`
        INSERT INTO dbo.UserRewardHistory (UserID, RewardID, XPEarned, Reason)
        VALUES (@userId, @rewardId, @xpEarned, @reason)
      `);

    logger.info(`Awarded ${finalXP} XP to user ${userId} for: ${reason}`);

    return {
      success: true,
      xpAwarded: finalXP,
      baseXP: xpAmount,
      streakBonus: finalXP > xpAmount,
      newTotalXP,
      newLevel,
      newTier,
      leveledUp: levelUpResult.leveledUp,
      levelUpInfo: levelUpResult.leveledUp ? levelUpResult : null,
    };
  } catch (error) {
    logger.error("awardXP error:", error.message);
    throw error;
  }
}

/**
 * Check if XP was already awarded today for a specific type
 * @param {number} userId - User ID
 * @param {string} awardType - Type of award (e.g., 'water_log', 'sleep_log')
 * @param {object} pool - Database pool
 * @returns {boolean} - True if already awarded
 */
async function wasAwardedToday(userId, awardType, pool) {
  const result = await pool
    .request()
    .input("userId", userId)
    .input("awardType", awardType)
    .query(`
      SELECT 1 FROM dbo.DailyXPAwards
      WHERE UserID = @userId
        AND AwardType = @awardType
        AND AwardDate = CAST(GETDATE() AS DATE)
    `);

  return result.recordset.length > 0;
}

/**
 * Record a daily XP award to prevent duplicates
 * @param {number} userId - User ID
 * @param {string} awardType - Type of award
 * @param {number} xpAmount - XP awarded
 * @param {object} pool - Database pool
 */
async function recordDailyAward(userId, awardType, xpAmount, pool) {
  try {
    await pool
      .request()
      .input("userId", userId)
      .input("awardType", awardType)
      .input("xpAmount", xpAmount)
      .query(`
        INSERT INTO dbo.DailyXPAwards (UserID, AwardType, AwardDate, XPAwarded)
        VALUES (@userId, @awardType, CAST(GETDATE() AS DATE), @xpAmount)
      `);
  } catch (error) {
    // Unique constraint violation means already awarded - that's OK
    if (!error.message.includes("UQ_DailyXP_UserTypeDate")) {
      throw error;
    }
  }
}

/**
 * Award daily sign-in XP (10 XP)
 * Only awards once per day
 */
async function awardDailySignIn(userId) {
  const pool = getPool();

  try {
    // Check if already signed in today
    const existingResult = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT 1 FROM dbo.DailySignIn
        WHERE UserID = @userId AND SignInDate = CAST(GETDATE() AS DATE)
      `);

    if (existingResult.recordset.length > 0) {
      return { awarded: false, reason: "Already signed in today" };
    }

    // Record sign-in
    await pool
      .request()
      .input("userId", userId)
      .query(`
        INSERT INTO dbo.DailySignIn (UserID, SignInDate, XPAwarded)
        VALUES (@userId, CAST(GETDATE() AS DATE), 1)
      `);

    // Update login streak
    await updateStreak(userId, "login", pool);

    // Award XP
    const result = await awardXP(
      userId,
      XP_VALUES.DAILY_SIGNIN,
      "Daily sign-in",
      null,
      pool
    );

    // Also update UserRewardProgress for daily_signin so UI shows as completed
    try {
      // Get the daily_signin reward ID
      const rewardDef = await pool
        .request()
        .query(`
          SELECT RewardID FROM dbo.RewardDefinitions
          WHERE RewardKey = 'daily_signin' AND IsActive = 1
        `);

      if (rewardDef.recordset.length > 0) {
        const rewardId = rewardDef.recordset[0].RewardID;

        // Check if progress record exists
        const progressCheck = await pool
          .request()
          .input("userId", userId)
          .input("rewardId", rewardId)
          .query(`
            SELECT ProgressID FROM dbo.UserRewardProgress
            WHERE UserID = @userId AND RewardID = @rewardId
          `);

        if (progressCheck.recordset.length === 0) {
          // Create progress record marked as completed and claimed
          await pool
            .request()
            .input("userId", userId)
            .input("rewardId", rewardId)
            .query(`
              INSERT INTO dbo.UserRewardProgress
                (UserID, RewardID, CurrentProgress, IsCompleted, IsClaimed, CompletedAt, ClaimedAt)
              VALUES
                (@userId, @rewardId, 1, 1, 1, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET())
            `);
        } else {
          // Update existing progress as completed and claimed
          await pool
            .request()
            .input("userId", userId)
            .input("rewardId", rewardId)
            .query(`
              UPDATE dbo.UserRewardProgress
              SET CurrentProgress = 1, IsCompleted = 1, IsClaimed = 1,
                  CompletedAt = SYSDATETIMEOFFSET(), ClaimedAt = SYSDATETIMEOFFSET()
              WHERE UserID = @userId AND RewardID = @rewardId
            `);
        }
      }
    } catch (progressError) {
      // Don't fail the whole operation if progress update fails
      logger.warn("Failed to update daily_signin progress:", progressError.message);
    }

    return {
      awarded: true,
      ...result,
    };
  } catch (error) {
    logger.error("awardDailySignIn error:", error.message);
    return { awarded: false, error: error.message };
  }
}

/**
 * Award workout completion XP (50 or 75 XP for custom)
 */
async function awardWorkoutComplete(userId, isCustomRoutine = false) {
  const pool = getPool();
  const awardType = isCustomRoutine ? "custom_routine" : "workout_complete";
  const xpAmount = isCustomRoutine
    ? XP_VALUES.CUSTOM_ROUTINE
    : XP_VALUES.WORKOUT_COMPLETE;

  try {
    // Update workout streak
    await updateStreak(userId, "workout", pool);

    // Award XP
    const result = await awardXP(
      userId,
      xpAmount,
      isCustomRoutine ? "Custom routine completed" : "Workout completed",
      null,
      pool
    );

    // Check for daily combo after workout
    await checkDailyCombo(userId, pool);

    return result;
  } catch (error) {
    logger.error("awardWorkoutComplete error:", error.message);
    throw error;
  }
}

/**
 * Award water logging XP (5 XP, once per day)
 */
async function awardWaterLog(userId) {
  const pool = getPool();

  try {
    if (await wasAwardedToday(userId, "water_log", pool)) {
      return { awarded: false, reason: "Already awarded today" };
    }

    await recordDailyAward(userId, "water_log", XP_VALUES.WATER_LOG, pool);

    // Update water streak
    await updateStreak(userId, "water", pool);

    const result = await awardXP(
      userId,
      XP_VALUES.WATER_LOG,
      "Water intake logged",
      null,
      pool
    );

    // Check for daily combo
    await checkDailyCombo(userId, pool);

    return { awarded: true, ...result };
  } catch (error) {
    logger.error("awardWaterLog error:", error.message);
    return { awarded: false, error: error.message };
  }
}

/**
 * Award sleep logging XP (5 XP, once per day)
 */
async function awardSleepLog(userId) {
  const pool = getPool();

  try {
    if (await wasAwardedToday(userId, "sleep_log", pool)) {
      return { awarded: false, reason: "Already awarded today" };
    }

    await recordDailyAward(userId, "sleep_log", XP_VALUES.SLEEP_LOG, pool);

    // Update sleep streak
    await updateStreak(userId, "sleep", pool);

    const result = await awardXP(
      userId,
      XP_VALUES.SLEEP_LOG,
      "Sleep logged",
      null,
      pool
    );

    // Check for daily combo
    await checkDailyCombo(userId, pool);

    return { awarded: true, ...result };
  } catch (error) {
    logger.error("awardSleepLog error:", error.message);
    return { awarded: false, error: error.message };
  }
}

/**
 * Award step goal XP (20 XP, once per day when reaching 10k)
 */
async function awardStepGoal(userId, steps) {
  const pool = getPool();

  if (steps < 10000) {
    return { awarded: false, reason: "Step goal not met" };
  }

  try {
    if (await wasAwardedToday(userId, "step_goal", pool)) {
      return { awarded: false, reason: "Already awarded today" };
    }

    await recordDailyAward(userId, "step_goal", XP_VALUES.STEP_GOAL, pool);

    const result = await awardXP(
      userId,
      XP_VALUES.STEP_GOAL,
      "Daily step goal achieved",
      null,
      pool
    );

    return { awarded: true, ...result };
  } catch (error) {
    logger.error("awardStepGoal error:", error.message);
    return { awarded: false, error: error.message };
  }
}

/**
 * Award form review XP (25 XP)
 */
async function awardFormReview(userId) {
  const pool = getPool();

  try {
    // Limit to once per session (use daily limit for simplicity)
    if (await wasAwardedToday(userId, "form_review", pool)) {
      return { awarded: false, reason: "Already awarded today" };
    }

    await recordDailyAward(userId, "form_review", XP_VALUES.FORM_REVIEW, pool);

    const result = await awardXP(
      userId,
      XP_VALUES.FORM_REVIEW,
      "AI form review completed",
      null,
      pool
    );

    return { awarded: true, ...result };
  } catch (error) {
    logger.error("awardFormReview error:", error.message);
    return { awarded: false, error: error.message };
  }
}

/**
 * Award personal record XP (50 XP)
 */
async function awardPersonalRecord(userId, exerciseName) {
  const pool = getPool();

  try {
    const result = await awardXP(
      userId,
      XP_VALUES.PERSONAL_RECORD,
      `Personal record set: ${exerciseName}`,
      null,
      pool
    );

    return { awarded: true, ...result };
  } catch (error) {
    logger.error("awardPersonalRecord error:", error.message);
    return { awarded: false, error: error.message };
  }
}

/**
 * Check and award daily combo bonus (workout + water + sleep in same day)
 */
async function checkDailyCombo(userId, pool) {
  try {
    // Check if already awarded combo today
    if (await wasAwardedToday(userId, "daily_combo", pool)) {
      return { awarded: false, reason: "Already awarded today" };
    }

    // Check if all three conditions met today
    const today = new Date().toISOString().split("T")[0];

    // Check for workout today
    const workoutResult = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT 1 FROM dbo.ExerciseExistence
        WHERE UserID = @userId
          AND Completed = 1
          AND CAST(WorkoutRoutineDate AS DATE) = CAST(GETDATE() AS DATE)
      `);

    // Check for water and sleep today
    const logsResult = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT WaterIntake, Sleep FROM dbo.DailyLogs
        WHERE UserID = @userId
          AND CAST(EffectiveDate AS DATE) = CAST(GETDATE() AS DATE)
      `);

    const hasWorkout = workoutResult.recordset.length > 0;
    const hasWater = logsResult.recordset.some(
      (r) => r.WaterIntake != null && r.WaterIntake > 0
    );
    const hasSleep = logsResult.recordset.some(
      (r) => r.Sleep != null && r.Sleep > 0
    );

    if (hasWorkout && hasWater && hasSleep) {
      await recordDailyAward(userId, "daily_combo", XP_VALUES.DAILY_COMBO, pool);

      const result = await awardXP(
        userId,
        XP_VALUES.DAILY_COMBO,
        "Daily combo bonus: workout + water + sleep",
        null,
        pool
      );

      return { awarded: true, ...result };
    }

    return {
      awarded: false,
      reason: "Combo conditions not met",
      conditions: { hasWorkout, hasWater, hasSleep },
    };
  } catch (error) {
    logger.error("checkDailyCombo error:", error.message);
    return { awarded: false, error: error.message };
  }
}

/**
 * Update user streak for a specific type
 */
async function updateStreak(userId, streakType, pool) {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Get current streak
    const streakResult = await pool
      .request()
      .input("userId", userId)
      .input("streakType", streakType)
      .query(`
        SELECT CurrentStreak, LastActivityDate, LongestStreak
        FROM dbo.UserStreaks
        WHERE UserID = @userId AND StreakType = @streakType
      `);

    if (streakResult.recordset.length === 0) {
      // Create new streak record
      await pool
        .request()
        .input("userId", userId)
        .input("streakType", streakType)
        .input("today", today)
        .query(`
          INSERT INTO dbo.UserStreaks (UserID, StreakType, CurrentStreak, LongestStreak, LastActivityDate)
          VALUES (@userId, @streakType, 1, 1, @today)
        `);
      return { streak: 1, isNew: true };
    }

    const { CurrentStreak, LastActivityDate, LongestStreak } =
      streakResult.recordset[0];
    const lastDate = LastActivityDate
      ? new Date(LastActivityDate).toISOString().split("T")[0]
      : null;

    // Same day - no change
    if (lastDate === today) {
      return { streak: CurrentStreak, updated: false };
    }

    // Check if consecutive day
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    let newStreak;
    if (lastDate === yesterdayStr) {
      // Consecutive day - increment streak
      newStreak = CurrentStreak + 1;
    } else {
      // Streak broken - reset to 1
      newStreak = 1;
    }

    const newLongest = Math.max(newStreak, LongestStreak);

    await pool
      .request()
      .input("userId", userId)
      .input("streakType", streakType)
      .input("newStreak", newStreak)
      .input("newLongest", newLongest)
      .input("today", today)
      .query(`
        UPDATE dbo.UserStreaks
        SET CurrentStreak = @newStreak,
            LongestStreak = @newLongest,
            LastActivityDate = @today
        WHERE UserID = @userId AND StreakType = @streakType
      `);

    return { streak: newStreak, longest: newLongest, updated: true };
  } catch (error) {
    logger.error("updateStreak error:", error.message);
    return { streak: 0, error: error.message };
  }
}

/**
 * Get user's current streaks
 */
async function getUserStreaks(userId) {
  const pool = getPool();

  try {
    const result = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT StreakType, CurrentStreak, LongestStreak, LastActivityDate
        FROM dbo.UserStreaks
        WHERE UserID = @userId
      `);

    const streaks = {};
    for (const row of result.recordset) {
      streaks[row.StreakType] = {
        current: row.CurrentStreak,
        longest: row.LongestStreak,
        lastActivity: row.LastActivityDate,
      };
    }

    return streaks;
  } catch (error) {
    logger.error("getUserStreaks error:", error.message);
    return {};
  }
}

module.exports = {
  XP_VALUES,
  awardXP,
  awardDailySignIn,
  awardWorkoutComplete,
  awardWaterLog,
  awardSleepLog,
  awardStepGoal,
  awardFormReview,
  awardPersonalRecord,
  checkDailyCombo,
  updateStreak,
  getUserStreaks,
};
