// routes/usageRoutes.js
const express = require("express");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");

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

// Check usage limit function
const checkUsageLimit = async (userId) => {
  try {
    const pool = getPool();

    // Get user type
    const userResult = await pool.request().input("userId", userId).query(`
        SELECT UserType FROM dbo.UserProfile WHERE UserID = @userId
      `);

    const userType = userResult.recordset[0]?.UserType || "free";
    const weeklyLimit = userType === "premium" ? 100 : 5;

    // Get current week's usage
    const weekStart = getWeekStart();

    const usageResult = await pool
      .request()
      .input("userId", userId)
      .input("weekStart", weekStart).query(`
        SELECT MessageCount, WeekStart 
        FROM dbo.UserUsage 
        WHERE UserID = @userId 
        AND WeekStart = @weekStart
      `);

    const usage = usageResult.recordset[0];

    if (!usage) {
      // No usage record exists for this week, user has full limit
      return { remaining: weeklyLimit, used: 0, weekStart: weekStart };
    }

    const remaining = Math.max(0, weeklyLimit - usage.MessageCount);
    return { remaining, used: usage.MessageCount, weekStart: weekStart };
  } catch (error) {
    console.error("Error checking usage limit:", error);
    return { remaining: 0, used: 0, weekStart: null };
  }
};

// Increment usage function
const incrementUsage = async (userId) => {
  try {
    const pool = getPool();
    const weekStart = getWeekStart();

    // First, try to update existing record
    const updateResult = await pool
      .request()
      .input("userId", userId)
      .input("weekStart", weekStart).query(`
        UPDATE dbo.UserUsage 
        SET MessageCount = MessageCount + 1
        WHERE UserID = @userId AND WeekStart = @weekStart
      `);

    // If no rows were updated, insert a new record
    if (updateResult.rowsAffected[0] === 0) {
      try {
        const insertResult = await pool
          .request()
          .input("userId", userId)
          .input("weekStart", weekStart).query(`
            INSERT INTO dbo.UserUsage (UserID, MessageCount, WeekStart)
            VALUES (@userId, 1, @weekStart)
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
              SET MessageCount = MessageCount + 1
              WHERE UserID = @userId AND WeekStart = @weekStart
            `);
        } else {
          throw insertError;
        }
      }
    } else {
    }

    return true;
  } catch (error) {
    console.error("Error incrementing usage:", error);
    return false;
  }
};

// Get usage information endpoint
router.get("/usage", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const usage = await checkUsageLimit(userId);

    // Get user type
    const pool = getPool();
    const userResult = await pool.request().input("userId", userId).query(`
        SELECT UserType FROM dbo.UserProfile WHERE UserID = @userId
      `);

    const userType = userResult.recordset[0]?.UserType || "free";
    const weeklyLimit = userType === "premium" ? 100 : 5;

    res.json({
      success: true,
      usage: {
        remaining: usage.remaining,
        used: usage.used,
        limit: weeklyLimit,
        user_type: userType,
        week_start: usage.weekStart,
      },
    });
  } catch (error) {
    console.error("Get usage error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve usage information",
    });
  }
});

// Reset usage for testing (admin only)
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
    console.error("Reset usage error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset usage",
    });
  }
});

// Get all usage history for user
router.get("/usage/history", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();
    const result = await pool.request().input("userId", userId).query(`
        SELECT WeekStart, MessageCount, CreateDate
        FROM dbo.UserUsage 
        WHERE UserID = @userId
        ORDER BY WeekStart DESC
      `);

    res.json({
      success: true,
      usage_history: result.recordset,
    });
  } catch (error) {
    console.error("Get usage history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve usage history",
    });
  }
});

module.exports = { router, checkUsageLimit, incrementUsage };
