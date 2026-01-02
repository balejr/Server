// routes/userRoutes.js
const express = require("express");
const mssql = require("mssql");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");
const { requireMFA } = require("../middleware/mfaMiddleware");
const bcrypt = require("bcrypt");

const logger = require("../utils/logger");

const router = express.Router();

/**
 * @swagger
 * /user/profile:
 *   get:
 *     summary: Get user profile
 *     description: Retrieve the current user's profile information
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Profile data retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfile'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: User not found
 */
router.get("/profile", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();
    const result = await pool.request().input("userId", userId).query(`
        SELECT FirstName, LastName, FitnessGoal, Age, Weight, Height, Gender, FitnessLevel, ProfileImageUrl
        FROM dbo.UserProfile
        WHERE UserID = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(result.recordset[0]);
  } catch (error) {
    logger.error("Get Profile Error", { error: error.message });
    res.status(500).json({ message: "Failed to get user profile" });
  }
});

/**
 * @swagger
 * /user/profile:
 *   patch:
 *     summary: Update user profile
 *     description: Update the current user's profile information
 *     tags: [User]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProfileRequest'
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         description: Failed to update profile
 */
router.patch("/profile", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const {
    firstName,
    lastName,
    fitnessGoal,
    age,
    weight,
    height,
    gender,
    fitnessLevel,
  } = req.body;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("userId", userId)
      .input("firstName", firstName)
      .input("lastName", lastName)
      .input("fitnessGoal", fitnessGoal)
      // Convert empty strings to null for numeric columns to prevent SQL conversion errors
      .input("age", age === '' ? null : age)
      .input("weight", weight === '' ? null : weight)
      .input("height", height === '' ? null : height)
      .input("gender", gender)
      .input("fitnessLevel", fitnessLevel).query(`
        UPDATE dbo.UserProfile
        SET FirstName = @firstName,
            LastName = @lastName,
            FitnessGoal = @fitnessGoal,
            Age = @age,
            Weight = @weight,
            Height = @height,
            Gender = @gender,
            FitnessLevel = @fitnessLevel
        WHERE UserID = @userId
      `);

    res.status(200).json({ message: "Profile updated successfully" });
  } catch (error) {
    logger.error("Profile Update Error", { error: error.message });
    res.status(500).json({ message: "Failed to update profile" });
  }
});

/**
 * @swagger
 * /user/profile:
 *   delete:
 *     summary: Delete user account
 *     description: Permanently delete user account and all associated data. Requires MFA verification if enabled.
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Account deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: MFA verification required
 *       500:
 *         description: Failed to delete account
 */
router.delete(
  "/profile",
  authenticateToken,
  requireMFA("delete_account"),
  async (req, res) => {
    const userId = req.user.userId;
    const pool = getPool();
    const transaction = new mssql.Transaction(pool);

    try {
      await transaction.begin();

      // Delete from all related tables (order matters due to foreign keys)
      // Child tables first, parent tables last
      const tablesToClean = [
        "OTPVerifications",
        "PasswordResets",
        "ChatMessages",
        "ChatbotSession",
        "DailyLogs",
        "DailySummary",
        "ExerciseExistence",
        "WorkoutRoutine",
        "WorkoutHistory",
        "UserUsage",
        "UserAchievements",
        "subscription_transactions",
        "user_subscriptions",
        "payments",
        "AIWorkoutPlans",
        "microcycles",
        "mesocycles",
        "OnboardingProfile",
        "PreWorkoutAssessment",
        "DeviceData",
        "OuraTokens",
        "UserLogin",
        "UserProfile", // Delete last (other tables may reference this)
      ];

      for (const table of tablesToClean) {
        const deleteRequest = new mssql.Request(transaction);
        await deleteRequest
          .input("userId", userId)
          .query(`DELETE FROM dbo.${table} WHERE UserID = @userId`);
      }

      await transaction.commit();
      res.status(200).json({
        success: true,
        message: "Account and all data deleted successfully",
      });
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        logger.error("Transaction rollback error", { error: rollbackError.message });
      }
      logger.error("Profile Delete Error", { error: error.message });
      res.status(500).json({
        success: false,
        message: "Failed to delete account",
      });
    }
  }
);

module.exports = router;
