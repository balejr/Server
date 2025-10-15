// routes/workoutRoutes.js
const express = require("express");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * Generate a unique plan ID
 * @param {number} userId - User ID
 * @returns {string} Unique plan ID
 */
const generatePlanId = (userId) => {
  const timestamp = Date.now();
  return `plan_${userId}_${timestamp}`;
};

/**
 * Save workout plan to database
 * @param {string} planId - Unique plan ID
 * @param {number} userId - User ID
 * @param {string} chatSessionId - Chat session ID
 * @param {Object} structuredResponse - Full LLM response object
 * @returns {Promise<boolean>} Success status
 */
const saveWorkoutPlan = async (
  planId,
  userId,
  chatSessionId,
  structuredResponse
) => {
  try {
    const pool = getPool();

    // Extract the full plan object (contains goal and days)
    const planObject = structuredResponse.payload.plan;
    const summary = structuredResponse.payload.summary || {};

    // Create summary text from message
    const summaryText = `${structuredResponse.message.title} - ${structuredResponse.message.body}`;

    // Extract metadata - goal is in plan.goal, days is plan.days
    const goal = planObject.goal || summary.goal || null;
    const daysArray = planObject.days || [];
    const daysPerWeek = summary.daysPerWeek || daysArray.length;
    const durationWeeks = summary.durationWeeks || null;
    const split = summary.split || extractSplitFromDays(daysArray);

    // Convert ONLY the days array to JSON string (goal is stored in separate column)
    const planDataJson = JSON.stringify(daysArray);

    // Insert workout plan
    const result = await pool
      .request()
      .input("planId", planId)
      .input("userId", userId)
      .input("chatSessionId", chatSessionId)
      .input("planData", planDataJson)
      .input("summary", summaryText)
      .input("goal", goal)
      .input("daysPerWeek", daysPerWeek)
      .input("durationWeeks", durationWeeks)
      .input("split", split).query(`
      INSERT INTO dbo.AIWorkoutPlans (
        PlanID, UserID, ChatSessionID, PlanData, Summary, 
        Goal, DaysPerWeek, DurationWeeks, Split, Status
      )
      VALUES (
        @planId, @userId, @chatSessionId, @planData, @summary,
        @goal, @daysPerWeek, @durationWeeks, @split, 'draft'
      )
    `);

    // Successfully saved - return true (logging will be done in chatbotRoutes.js)
    return true;
  } catch (error) {
    // Log error and throw it so it can be handled in chatbotRoutes.js
    console.error("❌ Error saving workout plan to database:", {
      message: error.message,
      code: error.code,
      state: error.state,
      planId: planId,
    });
    throw error; // Throw the error so it can be caught in chatbotRoutes.js
  }
};

/**
 * Extract split type from workout days
 * @param {Array} days - Array of workout days
 * @returns {string} Split type (e.g., "Push-Pull-Legs")
 */
const extractSplitFromDays = (days) => {
  if (!days || days.length === 0) return null;

  const labels = days.map((day) => day.label).filter((label) => label);

  // Common split patterns
  if (
    labels.some((label) => label.toLowerCase().includes("push")) &&
    labels.some((label) => label.toLowerCase().includes("pull"))
  ) {
    return "Push-Pull";
  }

  if (
    labels.some((label) => label.toLowerCase().includes("push")) &&
    labels.some((label) => label.toLowerCase().includes("pull")) &&
    labels.some((label) => label.toLowerCase().includes("leg"))
  ) {
    return "Push-Pull-Legs";
  }

  if (
    labels.some((label) => label.toLowerCase().includes("upper")) &&
    labels.some((label) => label.toLowerCase().includes("lower"))
  ) {
    return "Upper-Lower";
  }

  if (labels.some((label) => label.toLowerCase().includes("full"))) {
    return "Full Body";
  }

  // Return the first few labels joined
  return labels.slice(0, 3).join("-");
};

/**
 * Get all workout plans for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} Array of workout plans
 */
const getUserWorkoutPlans = async (userId) => {
  try {
    const pool = getPool();

    const result = await pool.request().input("userId", userId).query(`
        SELECT 
          PlanID, Summary, Goal, DaysPerWeek, DurationWeeks, Split, 
          Status, CreatedDate, LastModified
        FROM dbo.AIWorkoutPlans 
        WHERE UserID = @userId AND IsActive = 1
        ORDER BY CreatedDate DESC
      `);

    return result.recordset;
  } catch (error) {
    console.error("Error getting user workout plans:", error);
    return [];
  }
};

/**
 * Get the most recent workout plan for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} Most recent workout plan or null
 */
const getMostRecentWorkoutPlan = async (userId) => {
  try {
    const pool = getPool();

    const result = await pool.request().input("userId", userId).query(`
        SELECT TOP 1 
          PlanID, PlanData, Summary, Goal, DaysPerWeek, 
          DurationWeeks, Split, Status, CreatedDate, LastModified
        FROM dbo.AIWorkoutPlans 
        WHERE UserID = @userId AND IsActive = 1
        ORDER BY CreatedDate DESC
      `);

    if (result.recordset.length === 0) {
      return null;
    }

    const plan = result.recordset[0];

    // Parse the plan data back to object
    try {
      plan.PlanData = JSON.parse(plan.PlanData);
    } catch (parseError) {
      console.error("Error parsing plan data:", parseError);
      plan.PlanData = [];
    }

    return plan;
  } catch (error) {
    console.error("Error getting most recent workout plan:", error);
    return null;
  }
};

/**
 * Get specific workout plan by ID
 * @param {string} planId - Plan ID
 * @param {number} userId - User ID (for security)
 * @returns {Promise<Object|null>} Workout plan data or null
 */
const getWorkoutPlanById = async (planId, userId) => {
  try {
    const pool = getPool();

    const result = await pool
      .request()
      .input("planId", planId)
      .input("userId", userId).query(`
        SELECT PlanID, PlanData, Summary, Goal, DaysPerWeek, 
               DurationWeeks, Split, Status, CreatedDate, LastModified
        FROM dbo.AIWorkoutPlans 
        WHERE PlanID = @planId AND UserID = @userId AND IsActive = 1
      `);

    if (result.recordset.length === 0) {
      return null;
    }

    const plan = result.recordset[0];

    // Parse the plan data back to object
    try {
      plan.PlanData = JSON.parse(plan.PlanData);
    } catch (parseError) {
      console.error("Error parsing plan data:", parseError);
      plan.PlanData = {};
    }

    return plan;
  } catch (error) {
    console.error("Error getting workout plan by ID:", error);
    return null;
  }
};

/**
 * Update workout plan status
 * @param {string} planId - Plan ID
 * @param {number} userId - User ID
 * @param {string} status - New status (draft, saved, completed, archived)
 * @returns {Promise<boolean>} Success status
 */
const updateWorkoutPlanStatus = async (planId, userId, status) => {
  try {
    const pool = getPool();

    const validStatuses = ["draft", "saved", "completed", "archived"];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    const result = await pool
      .request()
      .input("planId", planId)
      .input("userId", userId)
      .input("status", status).query(`
        UPDATE dbo.AIWorkoutPlans 
        SET Status = @status, LastModified = GETDATE()
        WHERE PlanID = @planId AND UserID = @userId AND IsActive = 1
      `);

    return result.rowsAffected[0] > 0;
  } catch (error) {
    console.error("Error updating workout plan status:", error);
    return false;
  }
};

/**
 * Soft delete workout plan
 * @param {string} planId - Plan ID
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
const deleteWorkoutPlan = async (planId, userId) => {
  try {
    const pool = getPool();

    const result = await pool
      .request()
      .input("planId", planId)
      .input("userId", userId).query(`
        UPDATE dbo.AIWorkoutPlans 
        SET IsActive = 0, LastModified = GETDATE()
        WHERE PlanID = @planId AND UserID = @userId
      `);

    return result.rowsAffected[0] > 0;
  } catch (error) {
    console.error("Error deleting workout plan:", error);
    return false;
  }
};

// API Routes

/**
 * GET /api/workout/plans/recent
 * Get the most recent workout plan for the authenticated user
 */
router.get("/plans/recent", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const plan = await getMostRecentWorkoutPlan(userId);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "No workout plans found",
      });
    }

    res.json({
      success: true,
      plan: plan,
    });
  } catch (error) {
    console.error("Get most recent workout plan error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve most recent workout plan",
    });
  }
});

/**
 * GET /api/workout/plans
 * Get all workout plans for the authenticated user
 */
router.get("/plans", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const plans = await getUserWorkoutPlans(userId);

    res.json({
      success: true,
      plans: plans,
    });
  } catch (error) {
    console.error("Get workout plans error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve workout plans",
    });
  }
});

/**
 * GET /api/workout/plans/:planId
 * Get specific workout plan by ID
 */
router.get("/plans/:planId", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const planId = req.params.planId;

    const plan = await getWorkoutPlanById(planId, userId);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Workout plan not found",
      });
    }

    res.json({
      success: true,
      plan: plan,
    });
  } catch (error) {
    console.error("Get workout plan error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve workout plan",
    });
  }
});

/**
 * PUT /api/workout/plans/:planId/status
 * Update workout plan status
 */
router.put("/plans/:planId/status", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const planId = req.params.planId;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const success = await updateWorkoutPlanStatus(planId, userId, status);

    if (!success) {
      return res.status(404).json({
        success: false,
        message: "Workout plan not found or update failed",
      });
    }

    res.json({
      success: true,
      message: "Workout plan status updated successfully",
    });
  } catch (error) {
    console.error("Update workout plan status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update workout plan status",
    });
  }
});

/**
 * DELETE /api/workout/plans/:planId
 * Delete workout plan (soft delete)
 */
router.delete("/plans/:planId", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const planId = req.params.planId;

    const success = await deleteWorkoutPlan(planId, userId);

    if (!success) {
      return res.status(404).json({
        success: false,
        message: "Workout plan not found or delete failed",
      });
    }

    res.json({
      success: true,
      message: "Workout plan deleted successfully",
    });
  } catch (error) {
    console.error("Delete workout plan error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete workout plan",
    });
  }
});

module.exports = {
  router,
  generatePlanId,
  saveWorkoutPlan,
  getUserWorkoutPlans,
  getMostRecentWorkoutPlan,
  getWorkoutPlanById,
  updateWorkoutPlanStatus,
  deleteWorkoutPlan,
};
