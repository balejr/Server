// routes/dataRoutes.js
const express = require('express');
const { getPool } = require('../config/db');
const { authenticateToken } = require('../middleware/authMiddleware');
const router = express.Router();

// -------------------- DAILY LOGS --------------------
// POST daily Log
router.post('/dailylog', authenticateToken, async (req, res) => {
    const {
        sleep, steps, heartrate, waterIntake, sleepQuality, stepsQuality,
        restingHeartRate, heartrateVariability, weight, effectiveDate
    } = req.body;

    const userId = req.user.userId;

    try {
        const pool = getPool();
        await pool.request()
        .input('userId', userId)
        .input('sleep', sleep)
        .input('steps', steps)
        .input('heartrate', heartrate)
        .input('waterIntake', waterIntake)
        .input('sleepQuality', sleepQuality)
        .input('stepsQuality', stepsQuality)
        .input('restingHeartRate', restingHeartRate)
        .input('heartrateVariability', heartrateVariability)
        .input('weight', weight)
        .input('effectiveDate', effectiveDate)
        .query(`
            INSERT INTO dbo.DailyLogs 
            (UserID, Sleep, Steps, Heartrate, WaterIntake, SleepQuality, StepsQuality, RestingHeartrate, HeartrateVariability, Weight, EffectiveDate)
            VALUES 
            (@userId, @sleep, @steps, @heartrate, @waterIntake, @sleepQuality, @stepsQuality, @restingHeartRate, @heartrateVariability, @weight, @effectiveDate)
        `);
        res.status(200).json({ message: 'Daily log added successfully' });
    } catch (err) {
        console.error('DailyLog POST Error:', err);
        res.status(500).json({ message: 'Failed to insert daily log' });
    }
});

// GET all daily logs for specific user
router.get('/dailylog/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const tokenUserId = req.user.userId;

    if (parseInt(userId) !== tokenUserId) {
        return res.status(403).json({ message: 'Unauthorized access' });
    }

    try {
        const pool = getPool();
        const result = await pool.request()
        .input('userId', userId)
        .query('SELECT * FROM dbo.DailyLogs WHERE UserID = @userId');
        res.status(200).json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch daily logs' });
    }
});

// EDIT an existing daily log
router.patch('/dailylog/:logId', authenticateToken, async (req, res) => {
    const { logId } = req.params;
    const fields = req.body;

    const pool = getPool();
    const request = pool.request().input('logId', logId);
    const updates = Object.keys(fields).map((key) => {
        request.input(key, fields[key]);
        return `${key} = @${key}`;
    }).join(', ');

    try {
        await request.query(`UPDATE dbo.DailyLogs SET ${updates} WHERE LogID = @logId`);
        res.status(200).json({ message: 'Daily log updated' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to update daily log' });
    }
});

// DELETE daily log by ID
router.delete('/dailylog/:logId', authenticateToken, async (req, res) => {
    const { logId } = req.params;
  
    try {
      const pool = getPool();
      await pool.request()
        .input('logId', logId)
        .query('DELETE FROM dbo.DailyLogs WHERE LogID = @logId');
  
      res.status(200).json({ message: 'Daily log deleted successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to delete daily log' });
    }
});

// -------------------- WORKOUT --------------------
// POST a new workout
router.post('/workout', authenticateToken, async (req, res) => {
    const {
      workoutName,
      equipment,
      secondaryMusc,
      targetMusc,
      instructions
    } = req.body;
  
    const userId = req.user.userId;
  
    try {
      const pool = getPool();
      await pool.request()
        .input('workoutName', workoutName)
        .input('userId', userId)
        .input('equipment', equipment)
        .input('secondaryMusc', secondaryMusc)
        .input('targetMusc', targetMusc)
        .input('instructions', instructions)
        .input('createDate', new Date())
        .query(`
          INSERT INTO dbo.Workout 
          (WorkoutName, UserID, Equipment, SecondaryMusc, TargetMusc, Instructions, CreateDate)
          VALUES (@workoutName, @userId, @equipment, @secondaryMusc, @targetMusc, @instructions, @createDate)
        `);
      res.status(200).json({ message: 'Workout added successfully' });
    } catch (err) {
      console.error('Workout Insert Error:', err);
      res.status(500).json({ message: 'Failed to insert workout' });
    }
  });

// GET a specific existing workout by ID
router.get('/workout/:workoutId', authenticateToken, async (req, res) => {
    const { workoutId } = req.params;
    try {
        const pool = getPool();
        const result = await pool.request()
        .input('workoutId', workoutId)
        .query('SELECT * FROM dbo.Workout WHERE WorkoutID = @workoutId');
        res.status(200).json(result.recordset[0]);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch workout' });
    }
});

// EDIT an existing workout by workout ID
router.patch('/workout/:workoutId', authenticateToken, async (req, res) => {
    const { workoutId } = req.params;
    const fields = req.body;

    const pool = getPool();
    const request = pool.request().input('workoutId', workoutId);
    const updates = Object.keys(fields).map((key) => {
        request.input(key, fields[key]);
        return `${key} = @${key}`;
    }).join(', ');

    try {
        await request.query(`UPDATE dbo.Workout SET ${updates} WHERE WorkoutID = @workoutId`);
        res.status(200).json({ message: 'Workout updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to update workout' });
    }
});

// DELETE workout by ID
router.delete('/workout/:workoutId', authenticateToken, async (req, res) => {
    const { workoutId } = req.params;
  
    try {
      const pool = getPool();
      await pool.request()
        .input('workoutId', workoutId)
        .query('DELETE FROM dbo.Workout WHERE WorkoutID = @workoutId');
  
      res.status(200).json({ message: 'Workout deleted successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to delete workout' });
    }
});

// -------------------- WORKOUT HISTORY --------------------
// POST a workout history instance
router.post('/workouthistory', authenticateToken, async (req, res) => {
    const {
      workoutId,
      workoutType,
      duration,
      caloriesBurned,
      sets,
      reps,
      intensity,
      load,
      completedInd,
      durationLeft
    } = req.body;
  
    const userId = req.user.userId;
  
    try {
      const pool = getPool();
      await pool.request()
        .input('workoutId', workoutId)
        .input('userId', userId)
        .input('workoutType', workoutType)
        .input('duration', duration)
        .input('caloriesBurned', caloriesBurned)
        .input('sets', sets)
        .input('reps', reps)
        .input('intensity', intensity)
        .input('load', load)
        .input('createDate', new Date())
        .input('completedInd', completedInd)
        .input('durationLeft', durationLeft)
        .query(`
          INSERT INTO dbo.WorkoutHistory 
          (WorkoutID, UserID, WorkoutType, Duration, CaloriesBurned, Sets, Reps, Intensity, Load, CreateDate, CompletedInd, DurationLeft)
          VALUES 
          (@workoutId, @userId, @workoutType, @duration, @caloriesBurned, @sets, @reps, @intensity, @load, @createDate, @completedInd, @durationLeft)
        `);
  
      res.status(200).json({ message: 'Workout history entry added successfully' });
    } catch (err) {
      console.error('WorkoutHistory POST Error:', err);
      res.status(500).json({ message: 'Failed to insert workout history' });
    }
  });

// GET all workout history for a specific user
router.get('/workouthistory/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const tokenUserId = req.user.userId;
  
    if (parseInt(userId) !== tokenUserId) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    try {
        const pool = getPool();
        const result = await pool.request()
        .input('userId', userId)
        .query('SELECT * FROM dbo.WorkoutHistory WHERE UserID = @userId ORDER BY CreateDate DESC');
        res.status(200).json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch workout history' });
    }
});

// EDIT a workout history instance by ID
router.patch('/workouthistory/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const fields = req.body;

  const pool = getPool();
  const request = pool.request().input('id', id);
  const updates = Object.keys(fields).map((key) => {
    request.input(key, fields[key]);
    return `${key} = @${key}`;
  }).join(', ');

  try {
    await request.query(`UPDATE dbo.WorkoutHistory SET ${updates} WHERE WorkoutHistoryID = @id`);
    res.status(200).json({ message: 'Workout history updated' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update workout history' });
  }
});

// DELETE workout history entry by ID
router.delete('/workouthistory/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
  
    try {
      const pool = getPool();
      await pool.request()
        .input('id', id)
        .query('DELETE FROM dbo.WorkoutHistory WHERE WorkoutHistoryID = @id');
  
      res.status(200).json({ message: 'Workout history deleted successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to delete workout history' });
    }
});
  

module.exports = router;
