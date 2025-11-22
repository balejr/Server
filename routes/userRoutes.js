// routes/userRoutes.js
const express = require('express');
const { getPool } = require('../config/db');
const { authenticateToken } = require('../middleware/authMiddleware');
const bcrypt = require('bcrypt');

const router = express.Router();

// GET user profile
router.get('/profile', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();
    const result = await pool.request()
      .input('userId', userId)
      .query(`
        SELECT FirstName, LastName, FitnessGoal, Age, Weight, Height, Gender, FitnessLevel, ProfileImageUrl
        FROM dbo.UserProfile
        WHERE UserID = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(result.recordset[0]);
  } catch (error) {
    console.error('Get Profile Error:', error);
    res.status(500).json({ message: 'Failed to get user profile' });
  }
});

// PATCH update user profile
router.patch('/profile', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const {
    firstName,
    lastName,
    fitnessGoal,
    age,
    weight,
    height,
    gender,
    fitnessLevel
  } = req.body;

  try {
    const pool = getPool();
    await pool.request()
      .input('userId', userId)
      .input('firstName', firstName)
      .input('lastName', lastName)
      .input('fitnessGoal', fitnessGoal)
      .input('age', age)
      .input('weight', weight)
      .input('height', height)
      .input('gender', gender)
      .input('fitnessLevel', fitnessLevel)
      .query(`
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

    res.status(200).json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Profile Update Error:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// DELETE user profile
router.delete('/profile', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();

    await pool.request()
      .input('userId', userId)
      .query(`DELETE FROM dbo.UserLogin WHERE UserID = @userId`);

    await pool.request()
      .input('userId', userId)
      .query(`DELETE FROM dbo.UserProfile WHERE UserID = @userId`);

    res.status(200).json({ message: 'User profile deleted successfully' });
  } catch (error) {
    console.error('Profile Delete Error:', error);
    res.status(500).json({ message: 'Failed to delete user profile' });
  }
});

// ---------- OURA ----------
router.get("/oura/userinfo", async (req, res) => {
  try {
    const pool = await sql.connect(config);

    // Example: always using userId = 1
    const tokenResp = await pool.request()
      .input("userId", sql.Int, 1)
      .query("SELECT accessToken FROM OuraTokens WHERE userId = @userId");

    if (tokenResp.recordset.length === 0)
      return res.status(401).json({ message: "Oura not connected" });

    const token = tokenResp.recordset[0].accessToken;

    const userInfo = await getUserInfo(token);

    res.json(userInfo);
  } catch (err) {
    console.error("User Info Error:", err);
    res.status(500).json({ error: "Could not fetch user info" });
  }
});

module.exports = router;
