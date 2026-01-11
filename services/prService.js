/**
 * Personal Records Service
 *
 * Handles detection, recording, and retrieval of personal records.
 * Integrates with XP awarding when PRs are set.
 */

const { getPool } = require("../config/db");
const logger = require("../utils/logger");
const { awardPersonalRecord } = require("./xpEventService");

/**
 * Check if a new exercise entry is a personal record and record it
 * @param {number} userId - User ID
 * @param {string} exerciseId - Exercise ID from ExerciseDB
 * @param {string} exerciseName - Exercise name
 * @param {number} weight - Weight lifted
 * @param {number} reps - Number of reps (optional, for volume calculation)
 * @param {number} exerciseExistenceId - The exercise log ID
 * @returns {object} - PR result with isNewPR flag
 */
async function checkAndRecordPR(
  userId,
  exerciseId,
  exerciseName,
  weight,
  reps = 1,
  exerciseExistenceId = null
) {
  const pool = getPool();

  try {
    if (!weight || weight <= 0) {
      return { isNewPR: false, reason: "No weight provided" };
    }

    // Get current PR for this exercise
    const currentPRResult = await pool
      .request()
      .input("userId", userId)
      .input("exerciseId", exerciseId)
      .query(`
        SELECT TOP 1 RecordValue, RecordID
        FROM dbo.PersonalRecords
        WHERE UserID = @userId
          AND ExerciseID = @exerciseId
          AND RecordType = 'weight'
        ORDER BY RecordValue DESC
      `);

    const currentPR = currentPRResult.recordset[0];
    const currentMax = currentPR?.RecordValue || 0;

    // Check if new weight beats current PR
    if (weight > currentMax) {
      // Insert new PR record
      await pool
        .request()
        .input("userId", userId)
        .input("exerciseId", exerciseId)
        .input("exerciseName", exerciseName)
        .input("recordValue", weight)
        .input("previousValue", currentMax > 0 ? currentMax : null)
        .input("exerciseExistenceId", exerciseExistenceId)
        .query(`
          INSERT INTO dbo.PersonalRecords
            (UserID, ExerciseID, ExerciseName, RecordType, RecordValue, PreviousValue, ExerciseExistenceID)
          VALUES
            (@userId, @exerciseId, @exerciseName, 'weight', @recordValue, @previousValue, @exerciseExistenceId)
        `);

      // Award XP for new PR
      const xpResult = await awardPersonalRecord(userId, exerciseName);

      logger.info(
        `New PR for user ${userId}: ${exerciseName} - ${weight}kg (previous: ${currentMax}kg)`
      );

      return {
        isNewPR: true,
        exerciseId,
        exerciseName,
        newRecord: weight,
        previousRecord: currentMax > 0 ? currentMax : null,
        improvement: currentMax > 0 ? weight - currentMax : null,
        xpAwarded: xpResult.awarded ? xpResult.xpAwarded : 0,
        leveledUp: xpResult.leveledUp || false,
      };
    }

    return {
      isNewPR: false,
      exerciseId,
      exerciseName,
      attemptedWeight: weight,
      currentRecord: currentMax,
      reason: "Weight does not exceed current PR",
    };
  } catch (error) {
    logger.error("checkAndRecordPR error:", error.message);
    return { isNewPR: false, error: error.message };
  }
}

/**
 * Get PR history for a user, optionally filtered by exercise
 * @param {number} userId - User ID
 * @param {string} exerciseId - Optional exercise ID filter
 * @param {number} limit - Max records to return
 * @returns {array} - List of PR records
 */
async function getPRHistory(userId, exerciseId = null, limit = 50) {
  const pool = getPool();

  try {
    let query = `
      SELECT TOP (@limit)
        RecordID, ExerciseID, ExerciseName, RecordType,
        RecordValue, PreviousValue, SetAt
      FROM dbo.PersonalRecords
      WHERE UserID = @userId
    `;

    if (exerciseId) {
      query += ` AND ExerciseID = @exerciseId`;
    }

    query += ` ORDER BY SetAt DESC`;

    const request = pool
      .request()
      .input("userId", userId)
      .input("limit", limit);

    if (exerciseId) {
      request.input("exerciseId", exerciseId);
    }

    const result = await request.query(query);

    return result.recordset.map((pr) => ({
      id: pr.RecordID,
      exerciseId: pr.ExerciseID,
      exerciseName: pr.ExerciseName,
      recordType: pr.RecordType,
      recordValue: pr.RecordValue,
      previousValue: pr.PreviousValue,
      improvement: pr.PreviousValue
        ? pr.RecordValue - pr.PreviousValue
        : null,
      setAt: pr.SetAt,
    }));
  } catch (error) {
    logger.error("getPRHistory error:", error.message);
    return [];
  }
}

/**
 * Get current PRs for all exercises (latest record per exercise)
 * @param {number} userId - User ID
 * @returns {array} - List of current PRs by exercise
 */
async function getCurrentPRs(userId) {
  const pool = getPool();

  try {
    const result = await pool
      .request()
      .input("userId", userId)
      .query(`
        WITH RankedPRs AS (
          SELECT
            ExerciseID, ExerciseName, RecordType, RecordValue, SetAt,
            ROW_NUMBER() OVER (
              PARTITION BY ExerciseID, RecordType
              ORDER BY RecordValue DESC
            ) as rn
          FROM dbo.PersonalRecords
          WHERE UserID = @userId
        )
        SELECT ExerciseID, ExerciseName, RecordType, RecordValue, SetAt
        FROM RankedPRs
        WHERE rn = 1
        ORDER BY ExerciseName
      `);

    return result.recordset.map((pr) => ({
      exerciseId: pr.ExerciseID,
      exerciseName: pr.ExerciseName,
      recordType: pr.RecordType,
      recordValue: pr.RecordValue,
      setAt: pr.SetAt,
    }));
  } catch (error) {
    logger.error("getCurrentPRs error:", error.message);
    return [];
  }
}

/**
 * Get count of PRs set in the current month
 * Used for "Record Breaker" badge (5 PRs in one month)
 * @param {number} userId - User ID
 * @returns {number} - Count of PRs this month
 */
async function getMonthlyPRCount(userId) {
  const pool = getPool();

  try {
    const result = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT COUNT(*) as prCount
        FROM dbo.PersonalRecords
        WHERE UserID = @userId
          AND SetAt >= DATEADD(DAY, 1, EOMONTH(GETDATE(), -1))
          AND SetAt < DATEADD(DAY, 1, EOMONTH(GETDATE()))
      `);

    return result.recordset[0]?.prCount || 0;
  } catch (error) {
    logger.error("getMonthlyPRCount error:", error.message);
    return 0;
  }
}

/**
 * Get recent PRs (for dashboard display)
 * @param {number} userId - User ID
 * @param {number} limit - Number of recent PRs
 * @returns {array} - Recent PRs
 */
async function getRecentPRs(userId, limit = 5) {
  const pool = getPool();

  try {
    const result = await pool
      .request()
      .input("userId", userId)
      .input("limit", limit)
      .query(`
        SELECT TOP (@limit)
          ExerciseID, ExerciseName, RecordValue, PreviousValue, SetAt
        FROM dbo.PersonalRecords
        WHERE UserID = @userId
        ORDER BY SetAt DESC
      `);

    return result.recordset.map((pr) => ({
      exerciseId: pr.ExerciseID,
      exerciseName: pr.ExerciseName,
      recordValue: pr.RecordValue,
      previousValue: pr.PreviousValue,
      improvement: pr.PreviousValue
        ? pr.RecordValue - pr.PreviousValue
        : null,
      setAt: pr.SetAt,
    }));
  } catch (error) {
    logger.error("getRecentPRs error:", error.message);
    return [];
  }
}

/**
 * Get PR for a specific exercise
 * @param {number} userId - User ID
 * @param {string} exerciseId - Exercise ID
 * @returns {object|null} - Current PR or null
 */
async function getExercisePR(userId, exerciseId) {
  const pool = getPool();

  try {
    const result = await pool
      .request()
      .input("userId", userId)
      .input("exerciseId", exerciseId)
      .query(`
        SELECT TOP 1
          RecordValue, PreviousValue, SetAt
        FROM dbo.PersonalRecords
        WHERE UserID = @userId AND ExerciseID = @exerciseId AND RecordType = 'weight'
        ORDER BY RecordValue DESC
      `);

    if (result.recordset.length === 0) {
      return null;
    }

    const pr = result.recordset[0];
    return {
      recordValue: pr.RecordValue,
      previousValue: pr.PreviousValue,
      setAt: pr.SetAt,
    };
  } catch (error) {
    logger.error("getExercisePR error:", error.message);
    return null;
  }
}

module.exports = {
  checkAndRecordPR,
  getPRHistory,
  getCurrentPRs,
  getMonthlyPRCount,
  getRecentPRs,
  getExercisePR,
};
