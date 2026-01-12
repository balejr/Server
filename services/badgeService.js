/**
 * Badge Service
 *
 * Handles badge/achievement progress tracking and awarding.
 * Uses existing Achievements and UserAchievements tables.
 *
 * Badges:
 * - Consistency King: 30-day workout streak
 * - Hydration Hero: 7 consecutive water logging days
 * - Sleep Master: 20% sleep score improvement over 1 week
 * - Step Slayer: 100,000 steps in one week
 * - Record Breaker: 5 personal records in one month
 */

const { getPool } = require("../config/db");
const logger = require("../utils/logger");
const { awardXP } = require("./xpEventService");
const { getMonthlyPRCount } = require("./prService");

// Badge XP rewards
const BADGE_XP = {
  consistency_king: 200,
  hydration_hero: 75,
  sleep_master: 100,
  step_slayer: 150,
  record_breaker: 125,
};

/**
 * Get all badges with user progress
 * @param {number} userId - User ID
 * @returns {array} - Badges with progress info
 */
async function getUserBadges(userId) {
  const pool = getPool();

  try {
    // Get all badges with user progress
    const result = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT
          a.AchievementID as badgeId,
          a.Title as name,
          a.Description as description,
          a.Category as category,
          a.Type as type,
          a.GoalValue as requiredValue,
          a.Icon as icon,
          COALESCE(ua.CurrentValue, 0) as currentProgress,
          COALESCE(ua.IsCompleted, 0) as isEarned,
          ua.CompletedDate as earnedAt
        FROM dbo.Achievements a
        LEFT JOIN dbo.UserAchievements ua ON a.AchievementID = ua.AchievementID AND ua.UserID = @userId
        WHERE a.IsActive = 1
        ORDER BY a.Category, a.Title
      `);

    return result.recordset.map((badge) => {
      // Get XP reward from BADGE_XP map using badge type/name
      // Convert name to snake_case key format (e.g., "Consistency King" -> "consistency_king")
      const badgeKey = badge.name?.toLowerCase().replace(/\s+/g, '_');
      const xpReward = BADGE_XP[badgeKey] || 50; // Default to 50 XP if not found

      return {
        badgeId: badge.badgeId,
        name: badge.name,
        description: badge.description,
        category: badge.category,
        type: badge.type,
        requiredValue: badge.requiredValue,
        icon: badge.icon,
        currentProgress: badge.currentProgress,
        progressPercent: Math.min(
          100,
          Math.round((badge.currentProgress / badge.requiredValue) * 100)
        ),
        isEarned: badge.isEarned === 1 || badge.isEarned === true,
        earnedAt: badge.earnedAt,
        xpReward: xpReward,
      };
    });
  } catch (error) {
    logger.error("getUserBadges error:", error.message);
    return [];
  }
}

/**
 * Update badge progress
 * @param {number} userId - User ID
 * @param {string} badgeName - Badge title to update
 * @param {number} newProgress - New progress value
 * @returns {object} - Update result
 */
async function updateBadgeProgress(userId, badgeName, newProgress) {
  const pool = getPool();

  try {
    // Get badge ID
    const badgeResult = await pool
      .request()
      .input("badgeName", badgeName)
      .query(`
        SELECT AchievementID, GoalValue FROM dbo.Achievements
        WHERE Title = @badgeName AND IsActive = 1
      `);

    if (badgeResult.recordset.length === 0) {
      return { success: false, reason: "Badge not found" };
    }

    const { AchievementID, GoalValue } = badgeResult.recordset[0];
    const isCompleted = newProgress >= GoalValue;

    // Check if user already has this badge
    const existingResult = await pool
      .request()
      .input("userId", userId)
      .input("badgeId", AchievementID)
      .query(`
        SELECT UserAchievementID, IsCompleted FROM dbo.UserAchievements
        WHERE UserID = @userId AND AchievementID = @badgeId
      `);

    if (existingResult.recordset.length === 0) {
      // Create new progress record
      await pool
        .request()
        .input("userId", userId)
        .input("badgeId", AchievementID)
        .input("progress", newProgress)
        .input("isCompleted", isCompleted)
        .input("completedDate", isCompleted ? new Date() : null)
        .query(`
          INSERT INTO dbo.UserAchievements
            (UserID, AchievementID, CurrentValue, IsCompleted, CompletedDate)
          VALUES
            (@userId, @badgeId, @progress, @isCompleted, @completedDate)
        `);
    } else {
      const wasCompleted = existingResult.recordset[0].IsCompleted;

      // Only update if not already completed
      if (!wasCompleted) {
        await pool
          .request()
          .input("id", existingResult.recordset[0].UserAchievementID)
          .input("progress", newProgress)
          .input("isCompleted", isCompleted)
          .input("completedDate", isCompleted ? new Date() : null)
          .query(`
            UPDATE dbo.UserAchievements
            SET CurrentValue = @progress,
                IsCompleted = @isCompleted,
                CompletedDate = CASE WHEN @isCompleted = 1 THEN @completedDate ELSE CompletedDate END,
                LastModified = SYSDATETIME()
            WHERE UserAchievementID = @id
          `);
      }
    }

    // If just completed, award XP
    if (
      isCompleted &&
      (!existingResult.recordset[0] ||
        !existingResult.recordset[0].IsCompleted)
    ) {
      const badgeKey = badgeName.toLowerCase().replace(/ /g, "_");
      const xpAmount = BADGE_XP[badgeKey] || 100;
      await awardXP(userId, xpAmount, `Badge earned: ${badgeName}`, null, pool);

      logger.info(`User ${userId} earned badge: ${badgeName}`);
      return {
        success: true,
        badgeEarned: true,
        badgeName,
        xpAwarded: xpAmount,
      };
    }

    return {
      success: true,
      badgeEarned: false,
      currentProgress: newProgress,
      requiredValue: GoalValue,
    };
  } catch (error) {
    logger.error("updateBadgeProgress error:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check Consistency King badge (30-day workout streak)
 */
async function checkConsistencyKing(userId) {
  const pool = getPool();

  try {
    // Get workout streak
    const result = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT CurrentStreak FROM dbo.UserStreaks
        WHERE UserID = @userId AND StreakType = 'workout'
      `);

    const streak = result.recordset[0]?.CurrentStreak || 0;
    return await updateBadgeProgress(userId, "Consistency King", streak);
  } catch (error) {
    logger.error("checkConsistencyKing error:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check Hydration Hero badge (7 consecutive water logging days)
 */
async function checkHydrationHero(userId) {
  const pool = getPool();

  try {
    // Get water streak
    const result = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT CurrentStreak FROM dbo.UserStreaks
        WHERE UserID = @userId AND StreakType = 'water'
      `);

    const streak = result.recordset[0]?.CurrentStreak || 0;
    return await updateBadgeProgress(userId, "Hydration Hero", streak);
  } catch (error) {
    logger.error("checkHydrationHero error:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check Sleep Master badge (20% sleep score improvement over 1 week)
 * Requires sleepScoreService
 */
async function checkSleepMaster(userId, improvementPercent) {
  try {
    return await updateBadgeProgress(userId, "Sleep Master", improvementPercent);
  } catch (error) {
    logger.error("checkSleepMaster error:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check Step Slayer badge (100,000 steps in one week)
 */
async function checkStepSlayer(userId) {
  const pool = getPool();

  try {
    // Get total steps in the last 7 days
    const result = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT COALESCE(SUM(Steps), 0) as totalSteps
        FROM dbo.DailyLogs
        WHERE UserID = @userId
          AND EffectiveDate >= DATEADD(DAY, -7, GETDATE())
      `);

    const totalSteps = result.recordset[0]?.totalSteps || 0;
    return await updateBadgeProgress(userId, "Step Slayer", totalSteps);
  } catch (error) {
    logger.error("checkStepSlayer error:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check Record Breaker badge (5 personal records in one month)
 */
async function checkRecordBreaker(userId) {
  try {
    const monthlyPRs = await getMonthlyPRCount(userId);
    return await updateBadgeProgress(userId, "Record Breaker", monthlyPRs);
  } catch (error) {
    logger.error("checkRecordBreaker error:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check all badges for a user
 * Called periodically or after relevant activities
 */
async function checkAllBadges(userId) {
  const results = {
    consistencyKing: await checkConsistencyKing(userId),
    hydrationHero: await checkHydrationHero(userId),
    stepSlayer: await checkStepSlayer(userId),
    recordBreaker: await checkRecordBreaker(userId),
    // Sleep Master is checked separately with improvement data
  };

  // Find any newly earned badges
  const newBadges = Object.entries(results)
    .filter(([_, r]) => r.badgeEarned)
    .map(([name, r]) => ({
      badge: name,
      xpAwarded: r.xpAwarded,
    }));

  return {
    checked: Object.keys(results).length,
    newBadges,
    details: results,
  };
}

/**
 * Get earned badges count
 */
async function getEarnedBadgesCount(userId) {
  const pool = getPool();

  try {
    const result = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT COUNT(*) as count
        FROM dbo.UserAchievements
        WHERE UserID = @userId AND IsCompleted = 1
      `);

    return result.recordset[0]?.count || 0;
  } catch (error) {
    logger.error("getEarnedBadgesCount error:", error.message);
    return 0;
  }
}

module.exports = {
  BADGE_XP,
  getUserBadges,
  updateBadgeProgress,
  checkConsistencyKing,
  checkHydrationHero,
  checkSleepMaster,
  checkStepSlayer,
  checkRecordBreaker,
  checkAllBadges,
  getEarnedBadgesCount,
};
