/**
 * Sleep Score Service
 *
 * Calculates sleep quality scores and tracks improvement over time.
 * Used for the "Sleep Master" badge (20% improvement over 1 week).
 */

const { getPool } = require("../config/db");
const logger = require("../utils/logger");
const { checkSleepMaster } = require("./badgeService");

// Sleep quality string to numeric mapping
const SLEEP_QUALITY_SCORES = {
  terrible: 10,
  poor: 25,
  fair: 50,
  good: 70,
  great: 85,
  excellent: 100,
};

// Optimal sleep hours (7-9 hours is ideal)
const OPTIMAL_SLEEP_MIN = 7;
const OPTIMAL_SLEEP_MAX = 9;

/**
 * Calculate sleep score from hours and quality
 * Score is 0-100 based on:
 * - 60% weight on sleep hours (optimal 7-9 hours)
 * - 40% weight on sleep quality rating
 *
 * @param {number} sleepHours - Hours slept
 * @param {string} sleepQuality - Quality rating (poor, fair, good, great, excellent)
 * @returns {number} - Sleep score 0-100
 */
function calculateSleepScore(sleepHours, sleepQuality) {
  if (!sleepHours || sleepHours <= 0) {
    return 0;
  }

  // Calculate hours component (60% of score)
  let hoursScore;
  if (sleepHours >= OPTIMAL_SLEEP_MIN && sleepHours <= OPTIMAL_SLEEP_MAX) {
    // Optimal range - full points
    hoursScore = 100;
  } else if (sleepHours < OPTIMAL_SLEEP_MIN) {
    // Under-sleep penalty
    hoursScore = Math.max(0, (sleepHours / OPTIMAL_SLEEP_MIN) * 100);
  } else {
    // Over-sleep penalty (less severe)
    const overHours = sleepHours - OPTIMAL_SLEEP_MAX;
    hoursScore = Math.max(50, 100 - overHours * 10);
  }

  // Calculate quality component (40% of score)
  const qualityLower = (sleepQuality || "").toLowerCase().trim();
  const qualityScore = SLEEP_QUALITY_SCORES[qualityLower] || 50; // Default to fair

  // Weighted combination
  const finalScore = hoursScore * 0.6 + qualityScore * 0.4;

  return Math.round(Math.min(100, Math.max(0, finalScore)));
}

/**
 * Get sleep scores for the past N days
 * @param {number} userId - User ID
 * @param {number} days - Number of days to look back
 * @returns {array} - Array of { date, score, hours, quality }
 */
async function getSleepHistory(userId, days = 14) {
  const pool = getPool();

  try {
    const result = await pool
      .request()
      .input("userId", userId)
      .input("days", days)
      .query(`
        SELECT
          CAST(EffectiveDate AS DATE) as date,
          Sleep as hours,
          SleepQuality as quality
        FROM dbo.DailyLogs
        WHERE UserID = @userId
          AND Sleep IS NOT NULL
          AND Sleep > 0
          AND EffectiveDate >= DATEADD(DAY, -@days, GETDATE())
        ORDER BY EffectiveDate DESC
      `);

    return result.recordset.map((row) => ({
      date: row.date,
      hours: row.hours,
      quality: row.quality,
      score: calculateSleepScore(row.hours, row.quality),
    }));
  } catch (error) {
    logger.error("getSleepHistory error:", error.message);
    return [];
  }
}

/**
 * Calculate average sleep score for a period
 * @param {array} sleepData - Array from getSleepHistory
 * @returns {number} - Average score or 0 if no data
 */
function calculateAverageScore(sleepData) {
  if (!sleepData || sleepData.length === 0) {
    return 0;
  }

  const totalScore = sleepData.reduce((sum, day) => sum + day.score, 0);
  return Math.round(totalScore / sleepData.length);
}

/**
 * Get weekly sleep improvement percentage
 * Compares current week average to previous week average
 * @param {number} userId - User ID
 * @returns {object} - Improvement data
 */
async function getWeeklySleepImprovement(userId) {
  const pool = getPool();

  try {
    // Get last 14 days of sleep data
    const history = await getSleepHistory(userId, 14);

    if (history.length < 7) {
      return {
        hasEnoughData: false,
        currentWeekAvg: 0,
        previousWeekAvg: 0,
        improvementPercent: 0,
        message: "Need at least 7 days of sleep data",
      };
    }

    // Split into current week (0-6 days ago) and previous week (7-13 days ago)
    const now = new Date();
    const currentWeekData = [];
    const previousWeekData = [];

    for (const entry of history) {
      const entryDate = new Date(entry.date);
      const daysAgo = Math.floor((now - entryDate) / (1000 * 60 * 60 * 24));

      if (daysAgo < 7) {
        currentWeekData.push(entry);
      } else if (daysAgo < 14) {
        previousWeekData.push(entry);
      }
    }

    if (currentWeekData.length < 3 || previousWeekData.length < 3) {
      return {
        hasEnoughData: false,
        currentWeekAvg: calculateAverageScore(currentWeekData),
        previousWeekAvg: calculateAverageScore(previousWeekData),
        improvementPercent: 0,
        message: "Need at least 3 days of data in each week",
      };
    }

    const currentWeekAvg = calculateAverageScore(currentWeekData);
    const previousWeekAvg = calculateAverageScore(previousWeekData);

    // Calculate improvement percentage
    let improvementPercent = 0;
    if (previousWeekAvg > 0) {
      improvementPercent = Math.round(
        ((currentWeekAvg - previousWeekAvg) / previousWeekAvg) * 100
      );
    }

    return {
      hasEnoughData: true,
      currentWeekAvg,
      previousWeekAvg,
      improvementPercent,
      currentWeekDays: currentWeekData.length,
      previousWeekDays: previousWeekData.length,
    };
  } catch (error) {
    logger.error("getWeeklySleepImprovement error:", error.message);
    return {
      hasEnoughData: false,
      error: error.message,
    };
  }
}

/**
 * Check and update Sleep Master badge progress
 * Called after sleep is logged
 * @param {number} userId - User ID
 * @returns {object} - Badge check result
 */
async function checkSleepMasterProgress(userId) {
  try {
    const improvement = await getWeeklySleepImprovement(userId);

    if (!improvement.hasEnoughData) {
      return {
        checked: false,
        reason: improvement.message || "Insufficient data",
      };
    }

    // Only count positive improvement for badge progress
    const progressValue = Math.max(0, improvement.improvementPercent);

    // Check badge (20% improvement required)
    const badgeResult = await checkSleepMaster(userId, progressValue);

    return {
      checked: true,
      improvementPercent: improvement.improvementPercent,
      currentWeekAvg: improvement.currentWeekAvg,
      previousWeekAvg: improvement.previousWeekAvg,
      badgeProgress: progressValue,
      badgeEarned: badgeResult.badgeEarned || false,
    };
  } catch (error) {
    logger.error("checkSleepMasterProgress error:", error.message);
    return { checked: false, error: error.message };
  }
}

/**
 * Get sleep stats summary for user
 * @param {number} userId - User ID
 * @returns {object} - Sleep statistics
 */
async function getSleepStats(userId) {
  const pool = getPool();

  try {
    const result = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT
          AVG(Sleep) as avgHours,
          MAX(Sleep) as maxHours,
          MIN(Sleep) as minHours,
          COUNT(*) as totalLogs
        FROM dbo.DailyLogs
        WHERE UserID = @userId
          AND Sleep IS NOT NULL
          AND Sleep > 0
          AND EffectiveDate >= DATEADD(DAY, -30, GETDATE())
      `);

    const stats = result.recordset[0];

    // Get average score
    const history = await getSleepHistory(userId, 30);
    const avgScore = calculateAverageScore(history);

    return {
      averageHours: stats.avgHours ? Math.round(stats.avgHours * 10) / 10 : 0,
      maxHours: stats.maxHours || 0,
      minHours: stats.minHours || 0,
      totalLogs: stats.totalLogs || 0,
      averageScore: avgScore,
      last30Days: history.length,
    };
  } catch (error) {
    logger.error("getSleepStats error:", error.message);
    return {
      averageHours: 0,
      maxHours: 0,
      minHours: 0,
      totalLogs: 0,
      averageScore: 0,
    };
  }
}

module.exports = {
  SLEEP_QUALITY_SCORES,
  calculateSleepScore,
  getSleepHistory,
  calculateAverageScore,
  getWeeklySleepImprovement,
  checkSleepMasterProgress,
  getSleepStats,
};
