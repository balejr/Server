cd /home/site// routes/dataRoutes.js
const express = require('express');
const { getPool } = require('../config/db');
const { authenticateToken } = require('../middleware/authMiddleware');
const router = express.Router();

// -------------------- DAILY LOGS --------------------
// POST daily Log
router.post('/dailylog', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const {
      sleep, steps, heartrate, waterIntake, sleepQuality, stepsQuality,
      restingHeartRate, heartrateVariability, weight, effectiveDate
    } = req.body;

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

// GET daily log by ID
router.get('/dailylog/:logId', authenticateToken, async (req, res) => {
    const { logId } = req.params;

    try {
      const pool = getPool();
      const result = await pool.request()
        .input('logId', logId)
        .query('SELECT * FROM dbo.DailyLogs WHERE LogID = @logId');
      res.status(200).json(result.recordset[0]);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch daily log' });
    }
});

// GET all daily logs for specific user
router.get('/dailylogs', authenticateToken, async (req, res) => {
    const userId = req.user.userId;

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

// -------------------- EXERCISE EXISTENCE --------------------
// POST exercise instance
router.post('/exerciseexistence', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const {
    exercise, reps, sets, difficulty, date, note, rir, rpe,
    completed, weight = 0
  } = req.body;

  try {
    const pool = getPool();

    // const exerciseId = exercise.id;
    const exerciseName = exercise;
    const targetMuscle = exercise.target;
    const instructions = Array.isArray(exercise.instructions) ? exercise.instructions.join(' ') : exercise.instructions;
    const equipment = exercise.equipment;

      // Check if exercise already exists in dbo.Exercise
      const checkExercise = await pool.request()
      .input('name', exerciseName)
      .query(`SELECT ExerciseID FROM dbo.Exercise WHERE ExerciseName = @name`);

      let exerciseId;

      if (checkExercise.recordset.length > 0) {
        // ✅ Found existing exercise
        exerciseId = checkExercise.recordset[0].ExerciseID;
      } else {
        // 🆕 Insert new exercise
        const insertExercise = await pool.request()
          .input('name', exerciseName)
          .input('targetMuscle', targetMuscle)
          .input('instructions', instructions)
          .input('equipment', equipment)
          .query(`
            INSERT INTO dbo.Exercise (ExerciseName, TargetMuscle, Instructions, Equipment)
            OUTPUT INSERTED.ExerciseID
            VALUES (@name, @targetMuscle, @instructions, @equipment)
          `);
  
        exerciseId = insertExercise.recordset[0].ExerciseID;
      }

    // Insert exercise existence and get ID
    const result = await pool.request()
      .input('userId', userId)
      .input('exerciseId', exerciseId) 
       .input('reps', reps)
      .input('sets', sets)
      .input('difficulty', difficulty)
      .input('date', date)
      .input('note', note)
      .input('rir', rir)
      .input('rpe', rpe)
      .input('targetMuscle', targetMuscle)
      .input('instructions', instructions)
      .input('completed', completed)
      .query(`
        INSERT INTO dbo.ExerciseExistence
        (UserID, ExerciseID, Reps, Sets, Difficulty, Date, Note, RIR, RPE, TargetMuscle, Instructions, Completed)
        OUTPUT INSERTED.ExerciseExistenceID
        VALUES
        (@userId, @exerciseId, @reps, @sets, @difficulty, @date, @note, @rir, @rpe, @targetMuscle, @instructions, @completed)
      `);

    const insertedId = result.recordset[0].ExerciseExistenceID;
    const today = date;
    const load = reps * sets * weight;

    // Check if routine exists for today
    const routineQuery = await pool.request()
      .input('userId', userId)
      .input('date', today)
      .query(`SELECT * FROM dbo.WorkoutRoutine WHERE UserID = @userId AND WorkoutRoutineDate = @date`);

    if (routineQuery.recordset.length > 0) {
      // Routine exists, update it
      const routine = routineQuery.recordset[0];
      const instances = routine.ExerciseInstances ? routine.ExerciseInstances.split(',').map(s => s.trim()) : [];
      const updatedInstances = [...instances, insertedId].join(',');

      const equipmentList = routine.Equipment ? routine.Equipment.split(',').map(s => s.trim()) : [];
      const newEquipment = equipmentList.includes(equipment) ? equipmentList : [...equipmentList, equipment];

      const updatedLoad = (routine.Load || 0) + load;

      await pool.request()
        .input('id', routine.WorkoutRoutineID)
        .input('instances', updatedInstances)
        .input('equipment', newEquipment.join(','))
        .input('load', updatedLoad)
        .query(`
          UPDATE dbo.WorkoutRoutine
          SET ExerciseInstances = @instances,
              Equipment = @equipment,
              Load = @load
          WHERE WorkoutRoutineID = @id
        `);
    } else {
      // Routine doesn't exist, create one
      await pool.request()
        .input('userId', userId)
        .input('workoutName', targetMuscle)
        .input('exerciseInstances', insertedId.toString())
        .input('equipment', equipment)
        .input('duration', 0)
        .input('caloriesBurned', 0)
        .input('intensity', 0)
        .input('load', load)
        .input('durationLeft', 0)
        .input('completed', 0)
        .input('workoutRoutineDate', today)
        .query(`
          INSERT INTO dbo.WorkoutRoutine
          (UserID, WorkoutName, ExerciseInstances, Equipment, Duration, CaloriesBurned, Intensity, Load, DurationLeft, Completed, WorkoutRoutineDate)
          VALUES
          (@userId, @workoutName, @exerciseInstances, @equipment, @duration, @caloriesBurned, @intensity, @load, @durationLeft, @completed, @workoutRoutineDate)
        `);
    }

    res.status(200).json({ message: 'Exercise existence added successfully', id: insertedId });
  } catch (err) {
    console.error('ExerciseExistence POST Error:', err);
    res.status(500).json({ message: 'Failed to insert exercise existence' });
  }
});

// GET exercise instance
router.get('/exerciseexistence/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
      const pool = getPool();
      const result = await pool.request()
        .input('id', id)
        .query('SELECT * FROM dbo.ExerciseExistence WHERE ExerciseExistenceID = @id');
      res.status(200).json(result.recordset[0]);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch exercise existence' });
    }
});

// GET all exercise instances for specific user
router.get('/exerciseexistences', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    try {
      const pool = getPool();
      const result = await pool.request()
        .input('userId', userId)
        .query('SELECT * FROM dbo.ExerciseExistence WHERE UserID = @userId');
      res.status(200).json(result.recordset);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch exercise existences' });
    }
});

// GET all exercise instances for specific user and specific exercise
router.get('/exerciseexistence/user/:exerciseId', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { exerciseId } = req.params;
    try {
      const pool = getPool();
      const result = await pool.request()
        .input('userId', userId)
        .input('exerciseId', exerciseId)
        .query('SELECT * FROM dbo.ExerciseExistence WHERE UserID = @userId AND ExerciseID = @exerciseId');
      res.status(200).json(result.recordset);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch by user and exerciseId' });
    }
});

// GET all exercise instances for specific user on a specific date
router.get('/exerciseexistence/date/:date', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { date } = req.params;
    try {
      const pool = getPool();
      const result = await pool.request()
        .input('userId', userId)
        .input('date', date)
        .query('SELECT * FROM dbo.ExerciseExistence WHERE UserID = @userId AND Date = @date');
      res.status(200).json(result.recordset);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch by user and date' });
    }
});

// PATCH edit an exercise instance
router.patch('/exerciseexistence/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const fields = req.body;

    const pool = getPool();
    const request = pool.request().input('id', id);
    const updates = Object.keys(fields).map((key) => {
      request.input(key, fields[key]);
      return `${key} = @${key}`;
    }).join(', ');

    try {
      await request.query(`UPDATE dbo.ExerciseExistence SET ${updates} WHERE ExerciseExistenceID = @id`);
      res.status(200).json({ message: 'Exercise existence updated' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to update exercise existence' });
    }
});

// DELETE an exercise instance
// DELETE EXERCISE EXISTENCE AND REMOVE FROM ROUTINE
router.delete('/exerciseexistence/:id', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { id } = req.params;

    try {
      const pool = getPool();

      // Remove the existence ID from any linked WorkoutRoutine
      const routineQuery = await pool.request()
        .input('id', id)
        .query(`
          SELECT WorkoutRoutineID, ExerciseInstances FROM dbo.WorkoutRoutine
          WHERE ExerciseInstances LIKE '%${id}%'
        `);

      for (const routine of routineQuery.recordset) {
        const ids = routine.ExerciseInstances.split(',').map(i => i.trim()).filter(i => i !== id);
        await pool.request()
          .input('instances', ids.join(','))
          .input('routineId', routine.WorkoutRoutineID)
          .query(`
            UPDATE dbo.WorkoutRoutine SET ExerciseInstances = @instances WHERE WorkoutRoutineID = @routineId
          `);
      }

      await pool.request()
        .input('id', id)
        .query('DELETE FROM dbo.ExerciseExistence WHERE ExerciseExistenceID = @id');

      res.status(200).json({ message: 'Exercise existence deleted and routine updated' });
    } catch (err) {
      console.error('ExerciseExistence DELETE Error:', err);
      res.status(500).json({ message: 'Failed to delete exercise existence' });
    }
});

// -------------------- WORKOUT ROUTINE --------------------
// POST a new workout routine
router.post('/workoutroutine', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const {
      workoutName, exerciseInstances, equipment, duration,
      caloriesBurned, intensity, load, durationLeft, completed, workoutRoutineDate
    } = req.body;

    try {
      const pool = getPool();
      await pool.request()
        .input('userId', userId)
        .input('workoutName', workoutName)
        .input('exerciseInstances', exerciseInstances) // comma-separated IDs
        .input('equipment', equipment)
        .input('duration', duration)
        .input('caloriesBurned', caloriesBurned)
        .input('intensity', intensity)
        .input('load', load)
        .input('durationLeft', durationLeft)
        .input('completed', completed)
        .input('workoutRoutineDate', workoutRoutineDate)
        .query(`
          INSERT INTO dbo.WorkoutRoutine
          (UserID, WorkoutName, ExerciseInstances, Equipment, Duration, CaloriesBurned, Intensity, Load, DurationLeft, Completed, WorkoutRoutineDate)
          VALUES
          (@userId, @workoutName, @exerciseInstances, @equipment, @duration, @caloriesBurned, @intensity, @load, @durationLeft, @completed, @workoutRoutineDate)
        `);

      res.status(200).json({ message: 'Workout routine added successfully' });
    } catch (err) {
      console.error('WorkoutRoutine POST Error:', err);
      res.status(500).json({ message: 'Failed to insert workout routine' });
    }
});

// GET a workout routine by ID
router.get('/workoutroutine/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
      const pool = getPool();
      const result = await pool.request()
        .input('id', id)
        .query('SELECT * FROM dbo.WorkoutRoutine WHERE WorkoutRoutineID = @id');
      res.status(200).json(result.recordset[0]);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch workout routine' });
    }
});

// GET all workout routines for a specific user
router.get('/workoutroutines', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    try {
      const pool = getPool();
      const result = await pool.request()
        .input('userId', userId)
        .query('SELECT * FROM dbo.WorkoutRoutine WHERE UserID = @userId');
      res.status(200).json(result.recordset);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch workout routines' });
    }
});

// GET all workout routines for specific user on a specific date
router.get('/workoutroutines/date/:date', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { date } = req.params;
    try {
      const pool = getPool();
      const result = await pool.request()
        .input('userId', userId)
        .input('date', date)
        .query('SELECT * FROM dbo.WorkoutRoutine WHERE UserID = @userId AND WorkoutRoutineDate = @date');
      res.status(200).json(result.recordset);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch workout routines by date' });
    }
});

// GET all exercise instances for a specific workout routine
router.get('/workoutroutine/exerciseinstances/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
      const pool = getPool();
      const routineResult = await pool.request()
        .input('id', id)
        .query('SELECT ExerciseInstances FROM dbo.WorkoutRoutine WHERE WorkoutRoutineID = @id');

      const instanceIds = routineResult.recordset[0]?.ExerciseInstances?.split(',') || [];
      if (instanceIds.length === 0) return res.status(200).json([]);

      const placeholders = instanceIds.map((_, i) => `@id${i}`).join(',');
      const request = pool.request();
      instanceIds.forEach((val, i) => request.input(`id${i}`, parseInt(val)));

      const result = await request.query(`
        SELECT * FROM dbo.ExerciseExistence WHERE ExerciseExistenceID IN (${placeholders})
      `);

      res.status(200).json(result.recordset);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch exercise instances from workout routine' });
    }
});

// PATCH edit a workout routine
router.patch('/workoutroutine/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const fields = req.body;
    const pool = getPool();
    const request = pool.request().input('id', id);
    const updates = Object.keys(fields).map((key) => {
      request.input(key, fields[key]);
      return `${key} = @${key}`;
    }).join(', ');

    try {
      await request.query(`UPDATE dbo.WorkoutRoutine SET ${updates} WHERE WorkoutRoutineID = @id`);
      res.status(200).json({ message: 'Workout routine updated successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to update workout routine' });
    }
});

// DELETE a workout routine
router.delete('/workoutroutine/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
      const pool = getPool();
      await pool.request()
        .input('id', id)
        .query('DELETE FROM dbo.WorkoutRoutine WHERE WorkoutRoutineID = @id');
      res.status(200).json({ message: 'Workout routine deleted successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to delete workout routine' });
    }
});

// -------------------- MESOCYCLES --------------------
// POST a mesocycle
router.post('/mesocycle', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { start_date, end_date, is_current, created_date } = req.body;

    try {
      const pool = getPool();
      await pool.request()
        .input('userId', userId)
        .input('start_date', start_date)
        .input('end_date', end_date)
        .input('is_current', is_current)
        .input('created_date', created_date)
        .query(`
          INSERT INTO dbo.Mesocycles (UserId, start_date, end_date, is_current, created_date)
          VALUES (@userId, @start_date, @end_date, @is_current, @created_date)
        `);
      res.status(200).json({ message: 'Mesocycle added successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to insert mesocycle' });
    }
});

// GET all users mesocycles
router.get('/mesocycles', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    try {
      const pool = getPool();
      const result = await pool.request()
        .input('userId', userId)
        .query('SELECT * FROM dbo.Mesocycles WHERE UserId = @userId');
      res.status(200).json(result.recordset);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch mesocycles' });
    }
});

// EDIT specific mesocycle
router.patch('/mesocycle/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const fields = req.body;
    const pool = getPool();
    const request = pool.request().input('id', id);
    const updates = Object.keys(fields).map((key) => {
      request.input(key, fields[key]);
      return `${key} = @${key}`;
    }).join(', ');

    try {
      await request.query(`UPDATE dbo.Mesocycles SET ${updates} WHERE mesocycle_id = @id`);
      res.status(200).json({ message: 'Mesocycle updated successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to update mesocycle' });
    }
});

// DELETE a mesocycle
router.delete('/mesocycle/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    await pool.request()
      .input('id', id)
      .query('DELETE FROM dbo.Mesocycles WHERE mesocycle_id = @id');
    res.status(200).json({ message: 'Mesocycle deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete mesocycle' });
  }
});

// -------------------- MICROCYCLES --------------------
// POST a microcycle
router.post('/microcycle', authenticateToken, async (req, res) => {
    const { mesocycle_id, week_number, start_date, end_date, is_current, created_at } = req.body;

    try {
      const pool = getPool();
      await pool.request()
        .input('mesocycle_id', mesocycle_id)
        .input('week_number', week_number)
        .input('start_date', start_date)
        .input('end_date', end_date)
        .input('is_current', is_current)
        .input('created_at', created_at)
        .query(`
          INSERT INTO dbo.Microcycles (mesocycle_id, week_number, start_date, end_date, is_current, created_at)
          VALUES (@mesocycle_id, @week_number, @start_date, @end_date, @is_current, @created_at)
        `);
      res.status(200).json({ message: 'Microcycle added successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to insert microcycle' });
    }
});

// GET all microcyles by user
router.get('/microcycles', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    try {
      const pool = getPool();
      const result = await pool.request()
        .input('userId', userId)
        .query(`
          SELECT m.* FROM dbo.Microcycles m
          INNER JOIN dbo.Mesocycles ms ON m.mesocycle_id = ms.mesocycle_id
          WHERE ms.UserId = @userId
        `);
      res.status(200).json(result.recordset);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch microcycles' });
    }
});

// GET all microcycles within a mesocycle
router.get('/microcycles/:mesocycle_id', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { mesocycle_id } = req.params;
    try {
      const pool = getPool();
      const result = await pool.request()
        .input('userId', userId)
        .input('mesocycle_id', mesocycle_id)
        .query(`
          SELECT m.* FROM dbo.Microcycles m
          INNER JOIN dbo.Mesocycles ms ON m.mesocycle_id = ms.mesocycle_id
          WHERE ms.UserId = @userId AND m.mesocycle_id = @mesocycle_id
        `);
      res.status(200).json(result.recordset);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch microcycles for mesocycle' });
    }
});

// PATCH edit a specific microcycle
router.patch('/microcycle/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const fields = req.body;
    const pool = getPool();
    const request = pool.request().input('id', id);
    const updates = Object.keys(fields).map((key) => {
      request.input(key, fields[key]);
      return `${key} = @${key}`;
    }).join(', ');

    try {
      await request.query(`UPDATE dbo.Microcycles SET ${updates} WHERE microcycle_id = @id`);
      res.status(200).json({ message: 'Microcycle updated successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to update microcycle' });
    }
});

// DELETE a specific microcyle
router.delete('/microcycle/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
      const pool = getPool();
      await pool.request()
        .input('id', id)
        .query('DELETE FROM dbo.Microcycles WHERE microcycle_id = @id');
      res.status(200).json({ message: 'Microcycle deleted successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to delete microcycle' });
    }
});

module.exports = router;