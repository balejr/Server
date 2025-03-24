// routes/userRoutes.js
const express = require('express');
const { getPool } = require('../config/db');
const { authenticateToken } = require('../middleware/authMiddleware');
const bcrypt = require('bcrypt');

const router = express.Router();

// POST user profile/ create Account (linked to existing UserID)
router.post('/account', async (req, res) => {
  const { username, password, userId } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const pool = getPool();

    await pool.request()
      .input('username', username)
      .input('password', hashedPassword)
      .input('userId', userId)
      .input('createDate', new Date())
      .query(`
        INSERT INTO dbo.Account (UserName, Password, UserID, CreateDt)
        VALUES (@username, @password, @userId, @createDate)
      `);

    res.status(200).json({ message: 'Account created successfully' });
  } catch (error) {
    console.error('Create Account Error:', error);
    res.status(500).json({ message: 'Failed to create account' });
  }
});

// GET User Profile
router.get('/profile', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();
    const result = await pool.request()
      .input('userId', userId)
      .query(`
        SELECT Name, EmailAddr, FitnessGoal, Weight, Height, Gender,
               FitnessLevel, Age, ProfileImageUrl, CreateDate
        FROM dbo.[User]
        WHERE UserID = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(result.recordset[0]);
  } catch (error) {
    console.error('Fetch Profile Error:', error);
    res.status(500).json({ message: 'Failed to fetch user profile' });
  }
});

// EDIT User Profile
router.patch('/profile', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const {
    name, emailAddress, fitnessGoal, weight, height,
    gender, fitnessLevel, age, profileImageURL
  } = req.body;

  try {
    const pool = getPool();
    await pool.request()
      .input('userId', userId)
      .input('name', name)
      .input('emailAddress', emailAddress)
      .input('fitnessGoal', fitnessGoal)
      .input('weight', weight)
      .input('height', height)
      .input('gender', gender)
      .input('fitnessLevel', fitnessLevel)
      .input('age', age)
      .input('profileImageURL', profileImageURL)
      .query(`
        UPDATE dbo.[User]
        SET Name = @name,
            EmailAddr = @emailAddress,
            FitnessGoal = @fitnessGoal,
            Weight = @weight,
            Height = @height,
            Gender = @gender,
            FitnessLevel = @fitnessLevel,
            Age = @age,
            ProfileImageUrl = @profileImageURL
        WHERE UserID = @userId
      `);

    res.status(200).json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update Profile Error:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

module.exports = router;
