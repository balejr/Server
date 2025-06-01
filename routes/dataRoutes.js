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
  const { exerciseList } = req.body;

  if (!Array.isArray(exerciseList) || exerciseList.length === 0) {
    return res.status(400).json({ message: 'No exercises provided' });
  }

  const pool = getPool();
  const insertedIds = [];
  let totalLoad = 0;
  let allEquipment = new Set();
  let today = null;
  let targetMuscleForRoutine = '';

  try {
    for (const item of exerciseList) {
      const {
        exercise,
        reps,
        sets,
        difficulty,
        date,
        note = '',
        rir = 0,
        rpe = 0,
        status = 'Not started',
        completed = 0,
        weight = 0
      } = item;

      const exerciseName = exercise.exerciseName || exercise.name;
      const sourceExerciseId = exercise.id;
      const targetMuscle = exercise.target || '';
      const instructions = Array.isArray(exercise.instructions)
        ? exercise.instructions.join(' ')
        : exercise.instructions || '';
      const equipment = exercise.equipment || '';

      targetMuscleForRoutine = targetMuscleForRoutine || targetMuscle;
      allEquipment.add(equipment);
      today = today || date;

      // Check or insert into dbo.Exercise
      const checkExercise = await pool.request()
        .input('name', exerciseName)
        .query(`SELECT MasterExerciseID FROM dbo.Exercise WHERE ExerciseName = @name`);

      let MasterExerciseId;

      if (checkExercise.recordset.length > 0) {
        MasterExerciseId = checkExercise.recordset[0].MasterExerciseID;
      } else {
        const insertExercise = await pool.request()
          .input('name', exerciseName)
          .input('exerciseId', sourceExerciseId)
          .input('targetMuscle', targetMuscle)
          .input('instructions', instructions)
          .input('equipment', equipment)
          .query(`
            INSERT INTO dbo.Exercise (ExerciseName, ExerciseId, TargetMuscle, Instructions, Equipment)
            OUTPUT INSERTED.MasterExerciseID
            VALUES (@name, @exerciseId, @targetMuscle, @instructions, @equipment)
          `);
        MasterExerciseId = insertExercise.recordset[0].MasterExerciseID;
      }

      // Insert into dbo.ExerciseExistence
      const result = await pool.request()
        .input('userId', userId)
        .input('exerciseId', sourceExerciseId)
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
        .input('status', status)
        .input('weight', weight)
        .query(`
          INSERT INTO dbo.ExerciseExistence
          (UserID, ExerciseID, Reps, Sets, Difficulty, Date, Note, RIR, RPE, TargetMuscle, Instructions, Completed, Status, Weight)
          OUTPUT INSERTED.ExerciseExistenceID
          VALUES
          (@userId, @exerciseId, @reps, @sets, @difficulty, @date, @note, @rir, @rpe, @targetMuscle, @instructions, @completed, @status, @weight)
        `);

      const insertedId = result.recordset[0].ExerciseExistenceID;
      insertedIds.push(insertedId);
      totalLoad += reps * sets * weight;
    }

    // After loop: insert/update WorkoutRoutine
    const routineQuery = await pool.request()
      .input('userId', userId)
      .input('date', today)
      .query(`SELECT * FROM dbo.WorkoutRoutine WHERE UserID = @userId AND WorkoutRoutineDate = @date`);

    const newInstances = insertedIds.map(id => id.toString());

    if (routineQuery.recordset.length > 0) {
      // Update existing routine
      const routine = routineQuery.recordset[0];
      const instances = routine.ExerciseInstances ? routine.ExerciseInstances.split(',').map(s => s.trim()) : [];
      const updatedInstances = [...instances, ...newInstances].join(',');

      const equipmentList = routine.Equipment ? routine.Equipment.split(',').map(s => s.trim()) : [];
      const allNewEquipment = [...new Set([...equipmentList, ...Array.from(allEquipment)])];

      const updatedLoad = (routine.Load || 0) + totalLoad;

      await pool.request()
        .input('id', routine.WorkoutRoutineID)
        .input('instances', updatedInstances)
        .input('equipment', allNewEquipment.join(','))
        .input('load', updatedLoad)
        .query(`
          UPDATE dbo.WorkoutRoutine
          SET ExerciseInstances = @instances,
              Equipment = @equipment,
              Load = @load
          WHERE WorkoutRoutineID = @id
        `);
    } else {
      // Insert new routine
      await pool.request()
        .input('userId', userId)
        .input('workoutName', targetMuscleForRoutine)
        .input('exerciseInstances', newInstances.join(','))
        .input('equipment', Array.from(allEquipment).join(','))
        .input('duration', 0)
        .input('caloriesBurned', 0)
        .input('intensity', 0)
        .input('load', totalLoad)
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

    res.status(200).json({ message: 'Exercise existence(s) added successfully', ids: insertedIds });
  } catch (err) {
    console.error('ExerciseExistence POST Error:', err);
    res.status(500).json({ message: 'Failed to insert exercise existence', error: err.message });
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
        .query(`SELECT ex.* , e.ExerciseName
                FROM dbo.ExerciseExistence ex
                INNER JOIN 
                (
                SELECT MAX(ee.ExerciseExistenceID) as ExerciseExistenceID, ee.UserId, ee.ExerciseID
                FROM dbo.ExerciseExistence ee
                INNER JOIN (SELECT UserId, MAX(FORMAT([Date], 'yyyy-MM-dd')) as [Date] 
                    FROM dbo.ExerciseExistence 
                    WHERE UserID = @userId
                    AND CONVERT(date, [Date]) = @date
                    GROUP BY UserId) eex
                ON ee.UserId = eex.UserId
                AND FORMAT(ee.[Date], 'yyyy-MM-dd') = eex.[Date]
                GROUP BY ee.UserId, ee.ExerciseID
                ) ey
                on ex.ExerciseExistenceID = ey.ExerciseExistenceID
                LEFT JOIN dbo.[Exercise] e 
                ON ex.ExerciseId = e.ExerciseId`)
        // .query('SELECT ee.*, e.ExerciseName FROM dbo.ExerciseExistence ee LEFT JOIN dbo.[Exercise] e ON ee.ExerciseId = e.ExerciseId WHERE ee.UserID = @userId AND CONVERT(date, ee.Date) = @date');
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
        .query('SELECT * FROM dbo.Mesocycles WHERE UserId = @userId and is_current = 1');
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

// GET /mesocycles/by-dates?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
router.get('/mesocycle/by-dates', async (req, res) => {
  const { start_date, end_date } = req.query;
  const userId = req.user.userId;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Missing start_date or end_date' });
  }

  try {
    const pool = getPool();
    await pool.request()
      .input('userId', userId)
      .input('start_date', sql.Date, start_date)
      .input('end_date', sql.Date, end_date)
      .query(`
        SELECT * FROM Mesocycles
        WHERE start_date >= @start_date AND end_date <= @end_date
        AND UserId = @userId
      `);
    res.json(result.recordset);
  } catch (error) {
    console.error('Error fetching mesocycles by dates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// -------------------- MICROCYCLES --------------------
// POST a microcycle

router.post('/microcycle', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { mesocycle_id, start_date, end_date, is_current, created_date } = req.body;

    try {
      const pool = getPool();
      await pool.request()
        .input('userId', userId)
        .input('mesocycle_id', mesocycle_id)
        // .input('week_number', week_number)
        .input('start_date', start_date)
        .input('end_date', end_date)
        .input('is_current', is_current)
        .input('created_date', created_date)
        .query(`
          INSERT INTO dbo.Microcycles (mesocycle_id, start_date, end_date, is_current, created_date, userID)
          VALUES (@mesocycle_id, @start_date, @end_date, @is_current, @created_date, @userId)
        `);
      res.status(200).json({ message: 'Microcycle added successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to insert microcycle' , err});
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