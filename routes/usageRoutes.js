// routes/usageRoutes.js
const express = require("express");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");
const logger = require("../utils/logger");

const router = express.Router();

// Get current week's start date (Monday)
const getWeekStart = () => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday = 0, Monday = 1
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysToSubtract);
  weekStart.setHours(0, 0, 0, 0);

  // Convert to UTC midnight to match database format
  const utcWeekStart = new Date(
    Date.UTC(
      weekStart.getUTCFullYear(),
      weekStart.getUTCMonth(),
      weekStart.getUTCDate()
    )
  );

  return utcWeekStart;
};

// Check usage limit function with inquiry type differentiation
const checkUsageLimit = async (userId, inquiryType = "general") => {
  try {
    const pool = getPool();

    // Get user type
    const userResult = await pool.request().input("userId", userId).query(`
        SELECT UserType FROM dbo.UserProfile WHERE UserID = @userId
      `);

    const userType = userResult.recordset[0]?.UserType || "free";

    // Set limits based on user type and inquiry type
    let weeklyLimit;
    if (userType === "premium") {
      weeklyLimit = 100; // Premium users get 100 total inquiries
    } else {
      // Free users: 5 general + 3 workout inquiries per week
      if (inquiryType === "workout") {
        weeklyLimit = 3;
      } else {
        weeklyLimit = 5;
      }
    }

    // Get current week's usage
    const weekStart = getWeekStart();

    const usageResult = await pool
      .request()
      .input("userId", userId)
      .input("weekStart", weekStart).query(`
        SELECT GeneralInquiryCount, WorkoutInquiryCount, WeekStart 
        FROM dbo.UserUsage 
        WHERE UserID = @userId 
        AND WeekStart = @weekStart
      `);

    const usage = usageResult.recordset[0];

    if (!usage) {
      // No usage record exists for this week, user has full limit
      return { remaining: weeklyLimit, used: 0, weekStart: weekStart };
    }

    // Get the appropriate count based on inquiry type
    const usedCount =
      inquiryType === "workout"
        ? usage.WorkoutInquiryCount
        : usage.GeneralInquiryCount;

    const remaining = Math.max(0, weeklyLimit - usedCount);
    return { remaining, used: usedCount, weekStart: weekStart };
  } catch (error) {
    logger.error("Error checking usage limit", { error: error.message });
    return { remaining: 0, used: 0, weekStart: null };
  }
};

// Increment usage function with inquiry type differentiation
const incrementUsage = async (userId, inquiryType = "general") => {
  try {
    const pool = getPool();
    const weekStart = getWeekStart();

    // Determine which column to increment
    const columnName =
      inquiryType === "workout" ? "WorkoutInquiryCount" : "GeneralInquiryCount";

    // First, try to update existing record
    const updateResult = await pool
      .request()
      .input("userId", userId)
      .input("weekStart", weekStart).query(`
        UPDATE dbo.UserUsage 
        SET ${columnName} = ${columnName} + 1
        WHERE UserID = @userId AND WeekStart = @weekStart
      `);

    // If no rows were updated, insert a new record
    if (updateResult.rowsAffected[0] === 0) {
      try {
        const insertResult = await pool
          .request()
          .input("userId", userId)
          .input("weekStart", weekStart)
          .input("generalCount", inquiryType === "general" ? 1 : 0)
          .input("workoutCount", inquiryType === "workout" ? 1 : 0).query(`
            INSERT INTO dbo.UserUsage (UserID, GeneralInquiryCount, WorkoutInquiryCount, WeekStart)
            VALUES (@userId, @generalCount, @workoutCount, @weekStart)
          `);
      } catch (insertError) {
        // If insert fails due to duplicate, try update again
        if (insertError.number === 2627) {
          // UNIQUE constraint violation
          const retryUpdateResult = await pool
            .request()
            .input("userId", userId)
            .input("weekStart", weekStart).query(`
              UPDATE dbo.UserUsage 
              SET ${columnName} = ${columnName} + 1
              WHERE UserID = @userId AND WeekStart = @weekStart
            `);
        } else {
          throw insertError;
        }
      }
    }

    return true;
  } catch (error) {
    logger.error("Error incrementing usage", { error: error.message });
    return false;
  }
};

/**
 * @swagger
 * /usage/usage:
 *   get:
 *     summary: Get current usage stats
 *     description: Retrieve current week's API usage statistics for the authenticated user
 *     tags: [Usage]
 *     responses:
 *       200:
 *         description: Usage statistics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UsageStats'
 */
router.get("/usage", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    // Get user type and current week's usage
    const pool = getPool();
    const weekStart = getWeekStart();

    const userResult = await pool.request().input("userId", userId).query(`
        SELECT UserType FROM dbo.UserProfile WHERE UserID = @userId
      `);

    const userType = userResult.recordset[0]?.UserType || "free";

    // Get current week's usage from database
    const usageResult = await pool
      .request()
      .input("userId", userId)
      .input("weekStart", weekStart).query(`
        SELECT GeneralInquiryCount, WorkoutInquiryCount, WeekStart 
        FROM dbo.UserUsage 
        WHERE UserID = @userId 
        AND WeekStart = @weekStart
      `);

    const usage = usageResult.recordset[0];

    if (userType === "premium") {
      // Premium users have unified limits (100 total)
      const totalUsed = usage
        ? usage.GeneralInquiryCount + usage.WorkoutInquiryCount
        : 0;
      const totalRemaining = Math.max(0, 100 - totalUsed);

      res.json({
        success: true,
        usage: {
          general: {
            remaining: totalRemaining,
            used: usage ? usage.GeneralInquiryCount : 0,
            limit: 100,
          },
          workout: {
            remaining: totalRemaining,
            used: usage ? usage.WorkoutInquiryCount : 0,
            limit: 100,
          },
          user_type: userType,
          week_start: weekStart,
        },
      });
    } else {
      // Free users have separate limits for general and workout inquiries
      const generalUsed = usage ? usage.GeneralInquiryCount : 0;
      const workoutUsed = usage ? usage.WorkoutInquiryCount : 0;
      const generalRemaining = Math.max(0, 5 - generalUsed);
      const workoutRemaining = Math.max(0, 3 - workoutUsed);

      res.json({
        success: true,
        usage: {
          general: {
            remaining: generalRemaining,
            used: generalUsed,
            limit: 5,
          },
          workout: {
            remaining: workoutRemaining,
            used: workoutUsed,
            limit: 3,
          },
          user_type: userType,
          week_start: weekStart,
        },
      });
    }
  } catch (error) {
    logger.error("Get usage error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Failed to retrieve usage information",
    });
  }
});

/**
 * @swagger
 * /usage/usage/reset:
 *   post:
 *     summary: Reset usage (admin)
 *     description: Reset current week's usage counters for testing
 *     tags: [Usage]
 *     responses:
 *       200:
 *         description: Usage reset successfully
 */
router.post("/usage/reset", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();
    const weekStart = getWeekStart();

    // Delete current week's usage
    await pool.request().input("userId", userId).input("weekStart", weekStart)
      .query(`
        DELETE FROM dbo.UserUsage 
        WHERE UserID = @userId AND WeekStart = @weekStart
      `);

    res.json({
      success: true,
      message: "Usage reset successfully",
      week_start: weekStart,
    });
  } catch (error) {
    logger.error("Reset usage error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Failed to reset usage",
    });
  }
});

/**
 * @swagger
 * /usage/usage/history:
 *   get:
 *     summary: Get usage history
 *     description: Retrieve historical API usage data for the authenticated user
 *     tags: [Usage]
 *     responses:
 *       200:
 *         description: Usage history data
 */
router.get("/usage/history", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();
    const result = await pool.request().input("userId", userId).query(`
        SELECT WeekStart, GeneralInquiryCount, WorkoutInquiryCount, CreateDate
        FROM dbo.UserUsage 
        WHERE UserID = @userId
        ORDER BY WeekStart DESC
      `);

    res.json({
      success: true,
      usage_history: result.recordset,
    });
  } catch (error) {
    logger.error("Get usage history error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Failed to retrieve usage history",
    });
  }
});

module.exports = { router, checkUsageLimit, incrementUsage };
