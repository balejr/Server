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
        SELECT 
          FirstName, 
          LastName, 
          FitnessGoal, 
          Age, 
          Weight, 
          Height, 
          Gender, 
          FitnessLevel, 
          ProfileImageUrl,
          DOB,
          HeightUnit,
          WeightUnit,
          Goals
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

// POST create/update profile with pre-assessment data (onboarding)
router.post('/profile', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const {
    dob,
    height,
    heightUnit,
    weight,
    weightUnit,
    goals
  } = req.body;

  try {
    // Validation: Age must be at least 13 years old
    if (dob) {
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      
      if (age < 13) {
        return res.status(400).json({ 
          error: 'Must be at least 13 years old to use FitNext.',
          field: 'dob'
        });
      }
      
      if (age > 120) {
        return res.status(400).json({ 
          error: 'Invalid birth date. Please check your entry.',
          field: 'dob'
        });
      }
    }

    // Validation: Height ranges
    if (height && heightUnit) {
      const heightNum = parseFloat(height);
      if (isNaN(heightNum)) {
        return res.status(400).json({ 
          error: 'Height must be a valid number.',
          field: 'height'
        });
      }
      
      if (heightUnit === 'cm' && (heightNum < 100 || heightNum > 250)) {
        return res.status(400).json({ 
          error: 'Height must be between 100-250 cm.',
          field: 'height'
        });
      }
      
      if (heightUnit === 'ft' && (heightNum < 3 || heightNum > 8)) {
        return res.status(400).json({ 
          error: 'Height must be between 3-8 ft.',
          field: 'height'
        });
      }
    }

    // Validation: Weight ranges
    if (weight && weightUnit) {
      const weightNum = parseFloat(weight);
      if (isNaN(weightNum)) {
        return res.status(400).json({ 
          error: 'Weight must be a valid number.',
          field: 'weight'
        });
      }
      
      if (weightUnit === 'kg' && (weightNum < 30 || weightNum > 300)) {
        return res.status(400).json({ 
          error: 'Weight must be between 30-300 kg.',
          field: 'weight'
        });
      }
      
      if (weightUnit === 'lbs' && (weightNum < 66 || weightNum > 660)) {
        return res.status(400).json({ 
          error: 'Weight must be between 66-660 lbs.',
          field: 'weight'
        });
      }
    }

    // Build dynamic UPDATE query based on provided fields
    const pool = getPool();
    const updateFields = [];
    const request = pool.request().input('userId', userId);

    if (dob !== undefined) {
      updateFields.push('DOB = @dob');
      request.input('dob', dob);
      
      // Also calculate and update Age field
      const birthDate = new Date(dob);
      const today = new Date();
      let calculatedAge = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        calculatedAge--;
      }
      updateFields.push('Age = @age');
      request.input('age', calculatedAge);
    }

    if (height !== undefined) {
      updateFields.push('Height = @height');
      request.input('height', height);
    }

    if (heightUnit !== undefined) {
      updateFields.push('HeightUnit = @heightUnit');
      request.input('heightUnit', heightUnit);
    }

    if (weight !== undefined) {
      updateFields.push('Weight = @weight');
      request.input('weight', weight);
    }

    if (weightUnit !== undefined) {
      updateFields.push('WeightUnit = @weightUnit');
      request.input('weightUnit', weightUnit);
    }

    if (goals !== undefined) {
      // Handle goals as array or comma-separated string
      const goalsString = Array.isArray(goals) ? goals.join(',') : goals;
      updateFields.push('Goals = @goals');
      request.input('goals', goalsString);
      
      // Also update the legacy FitnessGoal field for backward compatibility
      updateFields.push('FitnessGoal = @fitnessGoal');
      request.input('fitnessGoal', goalsString);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ 
        error: 'No profile data provided to update.',
        message: 'Please provide at least one field: dob, height, weight, or goals'
      });
    }

    const updateQuery = `
      UPDATE dbo.UserProfile
      SET ${updateFields.join(', ')}
      WHERE UserID = @userId
    `;

    await request.query(updateQuery);

    console.log(`✅ Profile updated for user ${userId}:`, { dob, height, heightUnit, weight, weightUnit, goals });

    res.status(200).json({ 
      message: 'Profile updated successfully',
      updated: {
        dob: dob !== undefined,
        height: height !== undefined,
        weight: weight !== undefined,
        goals: goals !== undefined
      }
    });
  } catch (error) {
    console.error('Profile Save Error:', error);
    res.status(500).json({ 
      message: 'Failed to save profile',
      error: error.message 
    });
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

module.exports = router;
