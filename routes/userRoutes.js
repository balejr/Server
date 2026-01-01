// routes/userRoutes.js
const express = require("express");
const mssql = require("mssql");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");
const { requireMFA } = require("../middleware/mfaMiddleware");
const bcrypt = require("bcrypt");

const router = express.Router();

// GET user profile
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
    console.error("Get Profile Error:", error);
    res.status(500).json({ message: "Failed to get user profile" });
  }
});

// PATCH update user profile
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
    console.error("Profile Update Error:", error);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

// DELETE user profile - requires MFA if enabled, cleans up all user data
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
        console.error("Transaction rollback error:", rollbackError);
      }
      console.error("Profile Delete Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete account",
      });
    }
  }
);

module.exports = router;
