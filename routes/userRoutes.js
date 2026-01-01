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
          Goals,
          OnboardingData
        FROM dbo.UserProfile
        WHERE UserID = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Parse OnboardingData if it exists
    const profile = result.recordset[0];
    if (profile.OnboardingData) {
      try {
        profile.OnboardingData = JSON.parse(profile.OnboardingData);
      } catch (e) {
        // Keep as string if parsing fails
      }
    }

    res.status(200).json(profile);
  } catch (error) {
    console.error('Get Profile Error:', error);
    res.status(500).json({ message: 'Failed to get user profile' });
  }
});

// POST create/update profile with pre-assessment data (onboarding)
router.post('/profile', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const {
    // Basic fields
    dob,
    height,
    heightUnit,
    weight,
    weightUnit,
    goals,
    gender,
    // Enhanced onboarding fields
    experienceLevel,
    activityLevel,
    motivation,
    injuries,
    injuryNotes,
    daysPerWeek,
    sessionDuration,
    preferredTime,
    equipment,
    workoutLocation,
    trainingStyle,
    sleepQuality,
    stressLevel
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

    if (gender !== undefined) {
      updateFields.push('Gender = @gender');
      request.input('gender', gender);
    }

    if (experienceLevel !== undefined) {
      updateFields.push('FitnessLevel = @fitnessLevel');
      request.input('fitnessLevel', experienceLevel);
    }

    // Store enhanced onboarding data as JSON in OnboardingData column
    const enhancedData = {};
    if (activityLevel !== undefined) enhancedData.activityLevel = activityLevel;
    if (motivation !== undefined) enhancedData.motivation = motivation;
    if (injuries !== undefined) enhancedData.injuries = injuries;
    if (injuryNotes !== undefined) enhancedData.injuryNotes = injuryNotes;
    if (daysPerWeek !== undefined) enhancedData.daysPerWeek = daysPerWeek;
    if (sessionDuration !== undefined) enhancedData.sessionDuration = sessionDuration;
    if (preferredTime !== undefined) enhancedData.preferredTime = preferredTime;
    if (equipment !== undefined) enhancedData.equipment = equipment;
    if (workoutLocation !== undefined) enhancedData.workoutLocation = workoutLocation;
    if (trainingStyle !== undefined) enhancedData.trainingStyle = trainingStyle;
    if (sleepQuality !== undefined) enhancedData.sleepQuality = sleepQuality;
    if (stressLevel !== undefined) enhancedData.stressLevel = stressLevel;

    if (Object.keys(enhancedData).length > 0) {
      updateFields.push('OnboardingData = @onboardingData');
      request.input('onboardingData', JSON.stringify(enhancedData));
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

    // Profile updated successfully

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

// ========== PRE-WORKOUT ASSESSMENT ==========

// POST save pre-workout assessment
router.post('/preworkout', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { feeling, waterIntake, sleepQuality, sleepHours, recoveryStatus, workoutPlanId } = req.body;

  // Validate feeling values
  const validFeelings = ['Good', 'Average', 'Bad', 'Unsure'];
  if (feeling && !validFeelings.includes(feeling)) {
    return res.status(400).json({ 
      error: 'Invalid feeling value',
      message: `Feeling must be one of: ${validFeelings.join(', ')}`
    });
  }

  // Validate waterIntake values
  const validWaterIntakes = ['<50oz', '50-70oz', '70-90oz', '90oz+'];
  if (waterIntake && !validWaterIntakes.includes(waterIntake)) {
    return res.status(400).json({ 
      error: 'Invalid water intake value',
      message: `Water intake must be one of: ${validWaterIntakes.join(', ')}`
    });
  }

  // Validate sleepQuality (0-4 scale)
  if (sleepQuality !== undefined && sleepQuality !== null) {
    const qualityNum = parseInt(sleepQuality);
    if (isNaN(qualityNum) || qualityNum < 0 || qualityNum > 4) {
      return res.status(400).json({ 
        error: 'Invalid sleep quality value',
        message: 'Sleep quality must be a number between 0 and 4'
      });
    }
  }

  // Validate sleepHours values
  const validSleepHours = ['<6', '6-7', '7-8', '8-9', '9+'];
  if (sleepHours && !validSleepHours.includes(sleepHours)) {
    return res.status(400).json({ 
      error: 'Invalid sleep hours value',
      message: `Sleep hours must be one of: ${validSleepHours.join(', ')}`
    });
  }

  // Validate recoveryStatus values
  const validRecoveryStatuses = ['Not Recovered', 'Sore', 'Well-Recovered'];
  if (recoveryStatus && !validRecoveryStatuses.includes(recoveryStatus)) {
    return res.status(400).json({ 
      error: 'Invalid recovery status value',
      message: `Recovery status must be one of: ${validRecoveryStatuses.join(', ')}`
    });
  }

  try {
    const pool = getPool();
    
    await pool.request()
      .input('userId', userId)
      .input('workoutPlanId', workoutPlanId || null)
      .input('feeling', feeling)
      .input('waterIntake', waterIntake)
      .input('sleepQuality', sleepQuality)
      .input('sleepHours', sleepHours)
      .input('recoveryStatus', recoveryStatus)
      .query(`
        INSERT INTO [dbo].[PreWorkoutAssessment]
        (UserID, WorkoutPlanID, Feeling, WaterIntake, SleepQuality, SleepHours, RecoveryStatus, CreatedAt)
        VALUES
        (@userId, @workoutPlanId, @feeling, @waterIntake, @sleepQuality, @sleepHours, @recoveryStatus, GETDATE())
      `);

    res.status(200).json({ success: true, message: 'Pre-workout assessment saved successfully' });
  } catch (error) {
    console.error('Save Pre-Workout Assessment Error:', error);
    if (error.message && error.message.includes('Invalid object name')) {
      return res.status(500).json({ 
        error: 'Database table missing', 
        message: 'Please run MIGRATION_PREWORKOUT.sql to create the PreWorkoutAssessment table.' 
      });
    }
    res.status(500).json({ 
      error: 'Failed to save pre-workout assessment',
      message: error.message 
    });
  }
});

// GET latest pre-workout assessment for user
router.get('/preworkout/latest', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();
    
    const result = await pool.request()
      .input('userId', userId)
      .query(`
        SELECT TOP 1 
          AssessmentID,
          UserID,
          WorkoutPlanID,
          Feeling,
          WaterIntake,
          SleepQuality,
          SleepHours,
          RecoveryStatus,
          CreatedAt
        FROM [dbo].[PreWorkoutAssessment]
        WHERE UserID = @userId
        ORDER BY CreatedAt DESC
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'No pre-workout assessment found' });
    }

    res.status(200).json(result.recordset[0]);
  } catch (error) {
    console.error('Get Pre-Workout Assessment Error:', error);
    res.status(500).json({ 
      error: 'Failed to get pre-workout assessment',
      message: error.message 
    });
  }
});

module.exports = router;
// Deployment trigger: Wed Dec 31 18:04:55 PST 2025
