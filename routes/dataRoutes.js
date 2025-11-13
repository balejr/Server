// cd /home/site// routes/dataRoutes.js
const express = require('express');
const axios = require('axios');
const mssql = require('mssql');
const { getPool } = require('../config/db');
const { authenticateToken } = require('../middleware/authMiddleware');
const router = express.Router();

// GET EXERCISES
// GET exercises from external API (proxy)
router.get('/exercises', authenticateToken, async (req, res) => {
  try {
    const response = await axios.get('https://exercisedb.p.rapidapi.com/exercises?limit=1000&offset=0', {
      headers: {
        'X-RapidAPI-Key': process.env.RAPID_API_KEY,
        'X-RapidAPI-Host': process.env.RAPID_API_HOST,
      },
    });

    // Optionally shape the data
    const exerciseList = response.data.map(item => ({
      id: item.id,
      name: item.name,
      bodypart: item.bodyPart,
      target: item.target,
      equipment: item.equipment,
      gifURL: item.gifUrl,
      secondaryMuscles: item.secondaryMuscles,
      instructions: item.instructions
    }));

    res.status(200).json(exerciseList);
  } catch (error) {
    console.error('Failed to fetch exercises:', error);
    res.status(500).json({ message: 'Failed to fetch exercises' });
  }
});

// -------------------- DAILY LOGS --------------------
// POST daily Log
router.post('/dailylog', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const {
      sleep, steps, heartrate, waterIntake, sleepQuality, caloriesBurned,
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
        .input('caloriesBurned', caloriesBurned)
        .input('restingHeartRate', restingHeartRate)
        .input('heartrateVariability', heartrateVariability)
        .input('weight', weight)
        .input('effectiveDate', effectiveDate)
        .query(`
          INSERT INTO dbo.DailyLogs 
          (UserID, Sleep, Steps, Heartrate, WaterIntake, SleepQuality, caloriesBurned, RestingHeartrate, HeartrateVariability, Weight, EffectiveDate)
          VALUES 
           (@userId, @sleep, @steps, @heartrate, @waterIntake, @sleepQuality, @caloriesBurned, @restingHeartRate, @heartrateVariability, @weight, @effectiveDate)
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
        .query(`SELECT dl.* FROM dbo.DailyLogs dl
                INNER JOIN (SELECT MAX(LogId) AS LogId, EffectiveDate FROM dbo.DailyLogs 
                WHERE UserID = @userId
                GROUP BY EffectiveDate) dlx
                  ON dl.LogId = dlx.LogId
                `);

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
  let targetMuscleForRoutine = ''; // fallback if workoutName not provided
  let workoutNameForRoutine = '';
  

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
        status,
        completed,
        weight = 0,
        workoutName = ''
      } = item;

      const exerciseName = exercise.exerciseName || exercise.name;
      const sourceExerciseId = exercise.id;
      const targetMuscle = exercise.target || '';
      const instructions = Array.isArray(exercise.instructions)
        ? exercise.instructions.join(' ')
        : exercise.instructions || '';
      const equipment = exercise.equipment || '';
      const gifURL = exercise.gifURL || '';

      targetMuscleForRoutine = targetMuscleForRoutine || targetMuscle;
      workoutNameForRoutine = workoutNameForRoutine || workoutName || targetMuscle;

      allEquipment.add(equipment);
      today = today || date;

      // Check or insert into dbo.Exercise
      const checkExercise = await pool.request()
      .input('exerciseId', sourceExerciseId)
      .query(`SELECT MasterExerciseID FROM dbo.Exercise WHERE ExerciseId = @exerciseId`);
    

        console.log('gifURL being inserted:', gifURL);

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
          .input('imageURL', gifURL)
          .query(`
            INSERT INTO dbo.Exercise (ExerciseName, ExerciseId, TargetMuscle, Instructions, Equipment, ImageURL)
            OUTPUT INSERTED.MasterExerciseID
            VALUES (@name, @exerciseId, @targetMuscle, @instructions, @equipment, @imageURL)
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
        // .input('workoutName', targetMuscleForRoutine)
        .input('workoutName', workoutNameForRoutine)
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
        // .query(`SELECT ex.* , e.ExerciseName
        //         FROM dbo.ExerciseExistence ex
        //         INNER JOIN 
        //         (
        //         SELECT MAX(ee.ExerciseExistenceID) as ExerciseExistenceID, ee.UserId, ee.ExerciseID
        //         FROM dbo.ExerciseExistence ee
        //         INNER JOIN (SELECT UserId, MAX(FORMAT([Date], 'yyyy-MM-dd')) as [Date] 
        //             FROM dbo.ExerciseExistence 
        //             WHERE UserID = @userId
        //             AND CONVERT(date, [Date]) = @date
        //             GROUP BY UserId) eex
        //         ON ee.UserId = eex.UserId
        //         AND FORMAT(ee.[Date], 'yyyy-MM-dd') = eex.[Date]
        //         GROUP BY ee.UserId, ee.ExerciseID
        //         ) ey
        //         on ex.ExerciseExistenceID = ey.ExerciseExistenceID
        //         LEFT JOIN dbo.[Exercise] e 
        //         ON ex.ExerciseId = e.ExerciseId`)
        
        .query(`SELECT ee.*, e.ExerciseName FROM dbo.ExerciseExistence ee 
                LEFT JOIN dbo.[Exercise] e ON ee.ExerciseId = e.ExerciseId 
                WHERE ee.UserID = @userId AND CONVERT(date, ee.Date) = @date`);
                
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
      // Step 1: Set all existing mesocycles for this user to is_current = 0
    await pool.request()
        .input('userId', userId)
        .query(`
          UPDATE dbo.mesocycles
          SET is_current = 0
          WHERE UserId = @userId
        `);
      await pool.request()
        .input('userId', userId)
        .input('start_date', start_date)
        .input('end_date', end_date)
        .input('is_current', is_current)
        .input('created_date', created_date)
        .query(`
          INSERT INTO dbo.mesocycles (UserId, start_date, end_date, is_current, created_date)
          VALUES (@userId, @start_date, @end_date, CAST(@is_current AS BIT), CAST(@created_date AS DATETIME2))
        `);
      res.status(200).json({ message: 'Mesocycle added successfully' });

    } catch (err) {
      console.error('Server error inserting mesocycle:', err.message);
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
router.get('/mesocycles/date', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { start_date, end_date } = req.query; // ✅ Use query, not params

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Missing start_date or end_date' });
  }

  try {
    const pool = getPool();
    const result = await pool.request()
      .input('userId', userId)
      .input('start_date', start_date)
      .input('end_date', end_date)
      .query(`
        SELECT * FROM Mesocycles
        WHERE start_date >= @start_date AND end_date <= @end_date
        AND UserId = @userId
        AND is_current = 1
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
        .query(`
          UPDATE dbo.Microcycles
          SET is_current = 0
          WHERE UserId = @userId
        `);
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
//--------UNFINISED EXERCISES (Jump Back In) -------------------

// GET /api/exercises/unfinished/:userId
router.get('/exercises/unfinished/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('userId', userId)
      .query(`
        SELECT ex.* , e.ExerciseName
                FROM dbo.ExerciseExistence ex
                INNER JOIN 
                (
                SELECT MAX(ee.ExerciseExistenceID) as ExerciseExistenceID, ee.UserId, ee.ExerciseID
                FROM dbo.ExerciseExistence ee
                INNER JOIN (SELECT UserId, MAX(FORMAT([Date], 'yyyy-MM-dd')) as [Date] 
                    FROM dbo.ExerciseExistence 
                    WHERE UserID = @userId
                    GROUP BY UserId) eex
                ON ee.UserId = eex.UserId
                AND FORMAT(ee.[Date], 'yyyy-MM-dd') = eex.[Date]
                GROUP BY ee.UserId, ee.ExerciseID
                ) ey
                on ex.ExerciseExistenceID = ey.ExerciseExistenceID
                LEFT JOIN dbo.[Exercise] e 
                ON ex.ExerciseId = e.ExerciseId
                WHERE ex.STATUS IN ('not started', 'in progress', 'aborted')
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching unfinished exercises:', err);
    res.status(500).json({ message: 'Failed to fetch unfinished exercises' });
  }
});

//-------------Combined Meso and Micro ----------------------------
router.post('/mesocycle-with-microcycle', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const {
    mesocycleStart,
    mesocycleEnd,
    microcycleStart,
    microcycleEnd,
    is_current,
    created_date,
  } = req.body;

  try {
    const pool = getPool();

    // Step 1: Deactivate all previous mesocycles for the user
    await pool.request()
      .input('userId', userId)
      .query(`
        UPDATE dbo.mesocycles
        SET is_current = 0
        WHERE UserId = @userId
      `);

    // Step 2: Insert new mesocycle
    const mesoResult = await pool.request()
      .input('userId', userId)
      .input('start_date', mesocycleStart)
      .input('end_date', mesocycleEnd)
      .input('is_current', is_current)
      .input('created_date', created_date)
      .query(`
        INSERT INTO dbo.mesocycles (UserId, start_date, end_date, is_current, created_date)
        OUTPUT INSERTED.mesocycle_id
        VALUES (@userId, @start_date, @end_date, CAST(@is_current AS BIT), CAST(@created_date AS DATETIME2))
      `);

    const mesocycle_id = mesoResult.recordset[0]?.mesocycle_id;
    if (!mesocycle_id) {
      throw new Error("Mesocycle insertion failed, no ID returned.");
    }

    // Step 3: Deactivate all previous microcycles
    await pool.request()
      .input('userId', userId)
      .query(`
        UPDATE dbo.Microcycles
        SET is_current = 0
        WHERE UserId = @userId
      `);

    // Step 4: Insert new microcycle tied to the new mesocycle
    await pool.request()
      .input('userId', userId)
      .input('mesocycle_id', mesocycle_id)
      .input('start_date', microcycleStart)
      .input('end_date', microcycleEnd)
      .input('is_current', is_current)
      .input('created_date', created_date)
      .query(`
        INSERT INTO dbo.Microcycles (mesocycle_id, start_date, end_date, is_current, created_date, userID)
        VALUES (@mesocycle_id, @start_date, @end_date, CAST(@is_current AS BIT), CAST(@created_date AS DATETIME2), @userId)
      `);

    res.status(200).json({ message: 'Mesocycle and Microcycle added successfully', mesocycle_id });

  } catch (err) {
    console.error('Error in mesocycle-with-microcycle:', err.message);
    res.status(500).json({ message: 'Failed to insert mesocycle and microcycle', error: err.message });
  }
});

//-----------------------------Pevious Workout ------------------------------
// GET /api/exercises/previous/:userId
router.get('/exercises/previous-all/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('userId', userId)
      .query(`
        WITH LatestCompletedSets AS (
          SELECT 
            ee.ExerciseExistenceID,
            ee.ExerciseID,
            ee.UserID,
            ee.[Date],
            e.ExerciseName,
            ee.Weight,
            ee.Reps,
            ROW_NUMBER() OVER (
              PARTITION BY ee.UserID, ee.ExerciseID 
              ORDER BY ee.[Date] DESC, ee.ExerciseExistenceID DESC
            ) as SetNumber,
            RANK() OVER (
              PARTITION BY ee.UserID, ee.ExerciseID 
              ORDER BY ee.[Date] DESC
            ) as DateRank
          FROM dbo.ExerciseExistence ee
          INNER JOIN dbo.Exercise e ON ee.ExerciseID = e.ExerciseID
          WHERE ee.UserID = @userId
            AND ee.Status = 'completed'
        )
        SELECT 
          ExerciseName,
          Weight,
          Reps,
          SetNumber
        FROM LatestCompletedSets
        WHERE DateRank = 1
        ORDER BY ExerciseName, SetNumber
      `);

    // Group results by ExerciseName
    const grouped = {};
    result.recordset.forEach(row => {
      const key = row.ExerciseName.toLowerCase();
      if (!grouped[key]) grouped[key] = { sets: [] };
      grouped[key].sets.push({ weight: row.Weight, reps: row.Reps });
    });

    res.json(grouped);
  } catch (err) {
    console.error('Error fetching all previous exercises:', err);
    res.status(500).json({ message: 'Failed to fetch previous exercises' });
  }
});

//-------- EXERCISE History  -------------------

// GET /api/exercises/unfinished/:userId
router.get('/exercises/history/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('userId', userId)
      .query(`
              SELECT DISTINCT ex.ExerciseId, e.ExerciseName, ImageURL
              FROM dbo.ExerciseExistence ex
              LEFT JOIN dbo.[Exercise] e 
              ON ex.ExerciseId = e.ExerciseId
              WHERE UserId = @userId
              AND Status IN ('Completed')
              and e.ExerciseName is not NULL
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching completed exercises:', err);
    res.status(500).json({ message: 'Failed to fetch completed exercises' });
  }
});



// // PAYMENTS


// // POST 
// router.post('/payments', authenticateToken, async (req, res) => {
//     const userId = req.user.userId;
//     const status = "pending";
//     const { payments_id, plan, amount} = req.body; //currency, paymentMethod, created_date}

//     try {
//       const pool = getPool();
//       await pool.request()
//         .input('payments_id', payments_id)
//         .input('plan', plan)
//         .input('amount', amount)
//         // .input('currency', currency)
//         // .input('paymentMethod', paymentMethod)
//         // .input('created_date', created_date)
//         // .input('status', status)
//         .query(`
//           INSERT INTO dbo.payments (payments_id, plan, amount)
//           VALUES (@payments_id, @plan, @amount)
//         `);
//         // INSERT INTO dbo.payments (payments_id, plan, amount, currency, paymentMethod, created_date, status)
//         //   VALUES (@payments_id, @plan, @amount, @currency, @paymentMethod, @created_date, @status)
//       res.status(200).json({ message: 'Payment added successfully' });
//     } catch (err) {
//       res.status(500).json({ message: 'Failed to insert Payment' });
//     }
// });

// POST /payments
// router.post('/payments', authenticateToken, async (req, res) => {
//   const userId = req.user.userId;
//   const status = "pending";
//   const {plan, amount, currency, paymentMethod, created_date } = req.body;

//   try {
//     const pool = getPool();

//     await pool.request()
//       .input('userId', userId)
//       .input('plan', plan)
//       .input('amount', amount)
//       .input('currency', currency || 'USD') // default currency
//       .input('paymentMethod', paymentMethod || 'unknown')
//       .input('created_date', created_date || new Date())
//       .input('status', status)
//       .query(`
//         INSERT INTO dbo.payments 
//         (userId, [plan], amount, currency, paymentMethod, created_date, status)
//         VALUES (@userId, @plan, @amount, @currency, @paymentMethod, @created_date, @status)
//       `);

//     res.status(200).json({ message: 'Payment added successfully' });
//   } catch (err) {
//     console.error('Insert Payment Error:', err);
//     res.status(500).json({
//     message: 'Failed to insert payment',
//     sqlMessage: err.originalError?.info?.message || err.message,
//     stack: err.stack
//   });
// }
// });
  


// module.exports = router;


// Safe initialization that won't crash the app
let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('Stripe initialized');
  } else {
    console.warn('STRIPE_SECRET_KEY not set - Stripe features disabled');
  }
} catch (err) {
  console.error('Failed to initialize Stripe:', err);
  // Don't crash - just log the error
}

// TEST endpoint - no auth required to verify requests reach Azure
router.get('/payments/test', (req, res) => {
  const timestamp = new Date().toISOString();
  process.stdout.write(`\n[${timestamp}] ✅ TEST ENDPOINT HIT!\n`);
  console.log(`[${timestamp}] ✅ TEST ENDPOINT HIT!`);
  res.json({ 
    success: true, 
    message: 'Azure backend is reachable!',
    timestamp,
    path: req.path,
    method: req.method
  });
});

// POST /api/data/payments/initialize
router.post('/payments/initialize', authenticateToken, async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📥 Payment initialization request received`);
  
  try {
    // Validate environment variables
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('[ERROR] STRIPE_SECRET_KEY missing on server');
      return res.status(500).json({ error: 'STRIPE_SECRET_KEY missing on server' });
    }

    if (!process.env.STRIPE_PRICE_ID) {
      console.error('[ERROR] STRIPE_PRICE_ID missing on server');
      return res.status(500).json({ 
        error: 'STRIPE_PRICE_ID missing on server. Please create a Stripe Product and Price first.' 
      });
    }

    const userId = req.user.userId;
    const { plan = 'premium', paymentMethod = 'stripe' } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get or create Stripe Customer
    let customer;
    const pool = getPool();
    
    // Check if user already has a customer_id in database
    if (pool) {
      try {
        const existingCustomer = await pool.request()
          .input('userId', mssql.Int, parseInt(userId, 10))
          .query(`SELECT customer_id FROM [dbo].[user_subscriptions] WHERE UserId = @userId AND customer_id IS NOT NULL`);
        
        if (existingCustomer.recordset.length > 0 && existingCustomer.recordset[0].customer_id) {
          console.log(`📝 Found existing customer_id: ${existingCustomer.recordset[0].customer_id}`);
          customer = await stripe.customers.retrieve(existingCustomer.recordset[0].customer_id);
        }
      } catch (dbErr) {
        console.warn('⚠️ Could not check for existing customer:', dbErr.message);
      }
    }

    // Create new customer if doesn't exist
    if (!customer) {
      console.log('🔄 Creating new Stripe Customer for user:', userId);
      customer = await stripe.customers.create({
        metadata: {
          userId: String(userId),
          plan: plan
        }
      });
      console.log('✅ Created Stripe Customer:', customer.id);
    }

    // Create Subscription with payment_behavior: 'default_incomplete'
    // This creates an incomplete subscription and returns a PaymentIntent for the first payment
    // Note: Apple Pay is automatically supported via PaymentIntent's automatic_payment_methods
    // It should NOT be included in payment_method_types for subscriptions
    console.log('🔄 Creating Stripe Subscription with Price ID:', process.env.STRIPE_PRICE_ID);
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: process.env.STRIPE_PRICE_ID }],
      payment_behavior: 'default_incomplete',
      payment_settings: { 
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card']
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        userId: String(userId),
        plan: plan,
        paymentMethod: paymentMethod
      }
    });

    console.log('✅ Created Stripe Subscription:', subscription.id);
    console.log('📋 Subscription status:', subscription.status);

    // Get PaymentIntent from latest_invoice with retry logic
    // Stripe may need time to create the PaymentIntent, especially if invoice is draft
    let paymentIntent = null;
    let latestInvoice = subscription.latest_invoice;
    const maxRetries = 3;
    const retryDelays = [500, 1000, 2000]; // Exponential backoff in milliseconds

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Step 1: Get invoice (retrieve if it's a string ID)
        if (typeof latestInvoice === 'string') {
          console.log(`📝 Attempt ${attempt + 1}: Retrieving invoice: ${latestInvoice}`);
          latestInvoice = await stripe.invoices.retrieve(latestInvoice, {
            expand: ['payment_intent']
          });
        }

        // Step 2: Check invoice status and finalize if needed
        if (latestInvoice && latestInvoice.status === 'draft') {
          console.log(`📝 Attempt ${attempt + 1}: Invoice is draft, finalizing...`);
          try {
            latestInvoice = await stripe.invoices.finalizeInvoice(latestInvoice.id, {
              expand: ['payment_intent']
            });
            console.log(`✅ Invoice finalized, status: ${latestInvoice.status}`);
          } catch (finalizeErr) {
            // Invoice might already be finalized or in a state that can't be finalized
            if (finalizeErr.code === 'invoice_already_finalized' || 
                finalizeErr.message?.includes('already finalized')) {
              console.log('📝 Invoice already finalized, retrieving latest state...');
              latestInvoice = await stripe.invoices.retrieve(latestInvoice.id, {
                expand: ['payment_intent']
              });
            } else {
              throw finalizeErr;
            }
          }
        }

        // Step 2b: Handle 'open' invoice without PaymentIntent
        // When invoice is 'open' but has no PaymentIntent, we need to create one manually
        if (latestInvoice && latestInvoice.status === 'open' && !latestInvoice.payment_intent) {
          console.log(`📝 Attempt ${attempt + 1}: Invoice is 'open' but has no PaymentIntent, creating one...`);
          try {
            // Get amount from invoice
            const amount = latestInvoice.amount_due;
            const currency = latestInvoice.currency || 'usd';
            
            // Create PaymentIntent for this invoice
            // Use automatic_payment_methods to support Apple Pay and other payment methods
            paymentIntent = await stripe.paymentIntents.create({
              amount: amount,
              currency: currency,
              customer: customer.id,
              automatic_payment_methods: { enabled: true },
              metadata: {
                userId: String(userId),
                subscriptionId: subscription.id,
                invoiceId: latestInvoice.id,
                plan: plan,
                paymentMethod: paymentMethod
              },
              description: `Subscription payment for ${plan} plan`
            });
            
            // Attach PaymentIntent to invoice by paying the invoice with it
            // Note: We can't directly attach, but we'll use it when confirming payment
            console.log(`✅ Created PaymentIntent for open invoice: ${paymentIntent.id}`);
          } catch (createErr) {
            console.error(`❌ Failed to create PaymentIntent for open invoice:`, createErr.message);
            // Continue to try retrieving PaymentIntent from invoice
          }
        }

        // Step 3: Get PaymentIntent from invoice (only if we haven't created one manually)
        if (!paymentIntent) {
          paymentIntent = latestInvoice?.payment_intent;
        }

        // Step 4: If PaymentIntent is a string ID, retrieve it
        if (typeof paymentIntent === 'string') {
          console.log(`📝 Attempt ${attempt + 1}: PaymentIntent is string ID, retrieving: ${paymentIntent}`);
          paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
        }

        // Step 5: Validate PaymentIntent has client_secret
        if (paymentIntent && paymentIntent.client_secret) {
          console.log(`✅ PaymentIntent retrieved on attempt ${attempt + 1}:`, paymentIntent.id);
          break; // Success, exit retry loop
        }

        // Step 6: If no PaymentIntent yet, retry with delay (except on last attempt)
        if (attempt < maxRetries) {
          const delay = retryDelays[attempt] || 2000;
          console.log(`⚠️ Attempt ${attempt + 1}: PaymentIntent not ready, retrying in ${delay}ms...`);
          console.log(`   Invoice status: ${latestInvoice?.status}, Invoice ID: ${latestInvoice?.id}`);
          
          // Also try refreshing the subscription to get latest invoice
          const refreshedSubscription = await stripe.subscriptions.retrieve(subscription.id, {
            expand: ['latest_invoice.payment_intent']
          });
          latestInvoice = refreshedSubscription.latest_invoice;
          
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (retryErr) {
        console.error(`❌ Attempt ${attempt + 1} error:`, retryErr.message);
        if (attempt === maxRetries) {
          throw retryErr; // Re-throw on final attempt
        }
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelays[attempt] || 2000));
      }
    }

    // Final validation
    if (!paymentIntent || !paymentIntent.client_secret) {
      // Log comprehensive debug information
      console.error('❌ PaymentIntent retrieval failed after all retries', {
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        invoiceId: latestInvoice?.id,
        invoiceStatus: latestInvoice?.status,
        invoiceAmountDue: latestInvoice?.amount_due,
        invoiceCurrency: latestInvoice?.currency,
        hasPaymentIntent: !!paymentIntent,
        paymentIntentId: paymentIntent?.id,
        paymentIntentStatus: paymentIntent?.status,
        hasClientSecret: !!paymentIntent?.client_secret,
        latestInvoicePaymentIntent: latestInvoice?.payment_intent
      });

      // Try one final approach: retrieve subscription again with full expansion
      try {
        console.log('🔄 Final attempt: Retrieving subscription with full expansion...');
        const finalSubscription = await stripe.subscriptions.retrieve(subscription.id, {
          expand: ['latest_invoice.payment_intent']
        });
        
        if (finalSubscription.latest_invoice) {
          const finalInvoice = typeof finalSubscription.latest_invoice === 'string'
            ? await stripe.invoices.retrieve(finalSubscription.latest_invoice, { expand: ['payment_intent'] })
            : finalSubscription.latest_invoice;
          
          if (finalInvoice.payment_intent) {
            paymentIntent = typeof finalInvoice.payment_intent === 'string'
              ? await stripe.paymentIntents.retrieve(finalInvoice.payment_intent)
              : finalInvoice.payment_intent;
          }
        }
      } catch (finalErr) {
        console.error('❌ Final retrieval attempt failed:', finalErr.message);
      }

      // If still no PaymentIntent, return detailed error
      if (!paymentIntent || !paymentIntent.client_secret) {
        return res.status(500).json({ 
          error: 'Failed to create payment intent',
          details: 'PaymentIntent was not created with the subscription. This may be a temporary Stripe issue.',
          subscriptionId: subscription.id,
          invoiceId: latestInvoice?.id,
          invoiceStatus: latestInvoice?.status,
          suggestion: 'Please try again in a moment. If the issue persists, contact support.'
        });
      }
    }

    console.log('✅ PaymentIntent retrieved successfully:', paymentIntent.id);
    console.log('✅ Client secret available');

    res.status(200).json({ 
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      subscriptionId: subscription.id,
      customerId: customer.id,
      status: subscription.status
    });
  } catch (err) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] ❌ Initialize subscription error:`, err);
    res.status(500).json({
      error: 'Failed to initialize subscription',
      message: err?.message || 'Stripe subscription creation failed'
    });
  }
});

// POST /api/data/payments/confirm
router.post('/payments/confirm', authenticateToken, async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'STRIPE_SECRET_KEY missing on server' });
    }

    const { paymentIntentId, subscriptionId } = req.body || {};
    
    if (!paymentIntentId && !subscriptionId) {
      return res.status(400).json({ error: 'paymentIntentId or subscriptionId required' });
    }

    let subscription;
    let paymentIntent;

    // Primary path: retrieve subscription if subscriptionId provided
    if (subscriptionId) {
      console.log(`📝 Retrieving subscription: ${subscriptionId}`);
      subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['latest_invoice.payment_intent']
      });
      
      // Get PaymentIntent from latest invoice
      paymentIntent = subscription.latest_invoice?.payment_intent;
      
      // If paymentIntent is a string ID, retrieve it
      if (typeof paymentIntent === 'string') {
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
      }
      
      // If paymentIntentId was provided separately, use it to verify
      if (paymentIntentId && paymentIntent?.id !== paymentIntentId) {
        console.log(`⚠️ PaymentIntent mismatch. Using provided paymentIntentId: ${paymentIntentId}`);
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        // Note: When PaymentIntent succeeds, Stripe automatically pays the associated invoice
        // If we manually created the PaymentIntent, Stripe will still handle invoice payment
        // We don't need to manually pay the invoice - Stripe handles it via webhooks
        // The subscription status will be updated automatically when invoice is paid
      }
    } else if (paymentIntentId) {
      // Fallback: retrieve PaymentIntent and find associated subscription
      console.log(`📝 Retrieving PaymentIntent: ${paymentIntentId}`);
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      
      // Try to find subscription from PaymentIntent metadata
      if (paymentIntent.metadata?.subscriptionId) {
        subscription = await stripe.subscriptions.retrieve(paymentIntent.metadata.subscriptionId, {
          expand: ['latest_invoice.payment_intent']
        });
      } else {
        // Search by customer for incomplete subscriptions
        const customerId = paymentIntent.customer;
        if (customerId) {
          const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            limit: 1,
            status: 'incomplete'
          });
          if (subscriptions.data.length > 0) {
            subscription = subscriptions.data[0];
          }
        }
      }
    }

    // Return subscription details if available, otherwise PaymentIntent details
    if (subscription) {
      // Get amount and currency from subscription price
      const price = subscription.items.data[0]?.price;
      const amount = price?.unit_amount || paymentIntent?.amount || 0;
      const currency = price?.currency || paymentIntent?.currency || 'usd';
      
      res.status(200).json({ 
        id: subscription.id,
        status: subscription.status, // active, trialing, past_due, canceled, incomplete, etc.
        paymentIntentId: paymentIntent?.id || paymentIntentId,
        amount: amount,
        currency: currency,
        customerId: subscription.customer,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        paymentIntentStatus: paymentIntent?.status
      });
    } else if (paymentIntent) {
      // Fallback: return PaymentIntent details only
      res.status(200).json({ 
        id: paymentIntent.id, 
        status: paymentIntent.status, 
        amount: paymentIntent.amount, 
        currency: paymentIntent.currency,
        paymentIntentId: paymentIntent.id,
        paymentIntentStatus: paymentIntent.status
      });
    } else {
      return res.status(404).json({ 
        error: 'Subscription or PaymentIntent not found' 
      });
    }
  } catch (err) {
    console.error('Confirm subscription error:', err);
    res.status(500).json({
      error: 'Failed to confirm subscription',
      message: err?.message || 'Stripe confirm failed'
    });
  }
});

// Helper function to update subscription in database
// Supports both Subscription-based (new) and PaymentIntent-based (legacy) subscriptions
async function updateSubscriptionInDatabase(userId, subscriptionStatus, plan, paymentIntentId, paymentMethod, subscriptionId, customerId, currentPeriodStart, currentPeriodEnd) {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY missing on server');
  }

  if (!stripe) {
    throw new Error('Stripe not initialized - check STRIPE_SECRET_KEY configuration');
  }

  console.log(`🔄 Processing subscription update for user ${userId}, plan: ${plan}`);
  console.log(`   subscriptionId: ${subscriptionId || 'N/A'}, paymentIntentId: ${paymentIntentId || 'N/A'}`);

  let subscription;
  let paymentIntent;
  let amount = 9.99; // Default amount
  let currency = 'USD';
  let paymentStatus = 'pending';
  let finalPaymentMethod = paymentMethod || 'stripe';

  // If subscriptionId is provided, retrieve subscription (new flow)
  if (subscriptionId) {
    console.log(`📝 Retrieving Stripe Subscription: ${subscriptionId}`);
    subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice.payment_intent']
    });
    
    // Get payment intent from latest invoice or retrieve separately if paymentIntentId provided
    paymentIntent = subscription.latest_invoice?.payment_intent;
    
    // If paymentIntentId was provided, retrieve it to get accurate status
    if (paymentIntentId) {
      console.log(`📝 Retrieving PaymentIntent for status check: ${paymentIntentId}`);
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } else if (typeof paymentIntent === 'string') {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
    }
    
    // If PaymentIntent succeeded, refresh subscription to get updated status
    // Stripe may need a moment to update subscription status after PaymentIntent succeeds
    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      console.log(`📝 PaymentIntent status: ${paymentIntent.status}, refreshing subscription...`);
      // Wait a moment for Stripe to process
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Refresh subscription to get latest status
      subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['latest_invoice.payment_intent']
      });
      console.log(`📝 Refreshed subscription status: ${subscription.status}`);
    }
    
    // Extract subscription details (use refreshed status)
    subscriptionStatus = subscription.status;
    customerId = subscription.customer;
    
    // If PaymentIntent succeeded but subscription is still incomplete, update to active
    // This handles the case where Stripe hasn't updated subscription status yet
    if (paymentIntent && paymentIntent.status === 'succeeded' && subscriptionStatus === 'incomplete') {
      console.log(`⚠️ PaymentIntent succeeded but subscription still incomplete, updating to active`);
      subscriptionStatus = 'active';
    }
    
    // Safely convert period dates - check if they exist and are valid
    if (subscription.current_period_start && typeof subscription.current_period_start === 'number') {
      currentPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
    } else {
      currentPeriodStart = null;
    }
    
    if (subscription.current_period_end && typeof subscription.current_period_end === 'number') {
      currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
    } else {
      currentPeriodEnd = null;
    }
    
    // Get amount and currency from subscription price
    if (subscription.items.data.length > 0) {
      const price = subscription.items.data[0].price;
      amount = price.unit_amount / 100;
      currency = price.currency.toUpperCase();
    }
    
    // Map payment intent status to payment status
    if (paymentIntent) {
      if (!paymentIntentId) {
        paymentIntentId = paymentIntent.id;
      }
      
      switch (paymentIntent.status) {
        case 'succeeded':
          paymentStatus = 'succeeded';
          break;
        case 'processing':
          paymentStatus = 'pending';
          break;
        case 'requires_payment_method':
        case 'requires_confirmation':
        case 'requires_action':
          paymentStatus = 'pending';
          break;
        case 'canceled':
          paymentStatus = 'canceled';
          break;
        case 'payment_failed':
          paymentStatus = 'failed';
          break;
        default:
          paymentStatus = 'pending';
      }
      finalPaymentMethod = paymentIntent.metadata?.paymentMethod || paymentMethod || 'stripe';
    }
  } else if (paymentIntentId) {
    // Legacy flow: retrieve payment intent only
    console.log(`📝 Retrieving PaymentIntent (legacy): ${paymentIntentId}`);
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    amount = paymentIntent.amount / 100;
    currency = paymentIntent.currency.toUpperCase();
    
    // Map payment intent status
    switch (paymentIntent.status) {
      case 'succeeded':
        paymentStatus = 'succeeded';
        break;
      case 'processing':
        paymentStatus = 'pending';
        break;
      case 'requires_payment_method':
      case 'requires_confirmation':
      case 'requires_action':
        paymentStatus = 'pending';
        break;
      case 'canceled':
        paymentStatus = 'canceled';
        break;
      case 'payment_failed':
        paymentStatus = 'failed';
        break;
      default:
        paymentStatus = 'pending';
    }
    finalPaymentMethod = paymentIntent.metadata?.paymentMethod || paymentMethod || 'stripe';
  } else {
    throw new Error('Either subscriptionId or paymentIntentId must be provided');
  }

  // Capitalize plan name
  const capitalizedPlan = plan === 'premium' ? 'Premium' : plan === 'free' ? 'Free' : plan.charAt(0).toUpperCase() + plan.slice(1);

  // Convert userId to integer
  const userIdInt = parseInt(userId, 10);
  if (isNaN(userIdInt)) {
    throw new Error(`Invalid userId: ${userId} - must be a number`);
  }

  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection not available');
  }

  // Use transaction to ensure atomicity
  const transaction = new mssql.Transaction(pool);

  try {
    await transaction.begin();
    console.log('📝 Transaction started');

    // Map subscription status to determine if user should be Premium
    // active, trialing = Premium; canceled, past_due, incomplete = check payment status
    const isActive = subscriptionStatus === 'active' || subscriptionStatus === 'trialing';
    const shouldBePremium = isActive && plan === 'premium';

    // 1. Update UserProfile.UserType and track changes
    // First, get current UserType to detect changes
    const currentUserTypeRequest = new mssql.Request(transaction);
    const currentUserTypeResult = await currentUserTypeRequest
      .input('userId', mssql.Int, userIdInt)
      .query(`SELECT UserType FROM dbo.UserProfile WHERE UserID = @userId`);
    
    const currentUserType = currentUserTypeResult.recordset[0]?.UserType || 'Free';
    const newUserType = shouldBePremium ? 'Premium' : 
                       (subscriptionStatus === 'canceled' || subscriptionStatus === 'past_due') ? 'Free' : currentUserType;
    
    // Only update if UserType is actually changing
    const userTypeChanged = currentUserType !== newUserType;
    
    if (shouldBePremium) {
      if (userTypeChanged) {
        console.log(`📝 Step 1: Updating UserProfile.UserType from '${currentUserType}' to 'Premium' for user ${userIdInt}`);
        const userProfileRequest = new mssql.Request(transaction);
        await userProfileRequest
          .input('userId', mssql.Int, userIdInt)
          .query(`UPDATE dbo.UserProfile SET UserType = 'Premium', UserTypeChangedDate = SYSDATETIMEOFFSET() WHERE UserID = @userId`);
        console.log(`✅ Step 1 complete: UserProfile updated to Premium, UserTypeChangedDate set`);
      } else {
        console.log(`📝 Step 1: UserProfile.UserType already 'Premium' for user ${userIdInt}, preserving UserTypeChangedDate`);
        // UserType unchanged, don't update UserTypeChangedDate
      }
    } else if (subscriptionStatus === 'canceled' || subscriptionStatus === 'past_due') {
      // Downgrade to Free if subscription is canceled or past due
      if (userTypeChanged) {
        console.log(`📝 Step 1: Downgrading UserProfile.UserType from '${currentUserType}' to 'Free' for user ${userIdInt}`);
        const userProfileRequest = new mssql.Request(transaction);
        await userProfileRequest
          .input('userId', mssql.Int, userIdInt)
          .query(`UPDATE dbo.UserProfile SET UserType = 'Free', UserTypeChangedDate = SYSDATETIMEOFFSET() WHERE UserID = @userId`);
        console.log(`✅ Step 1 complete: UserProfile downgraded to Free, UserTypeChangedDate updated`);
      } else {
        console.log(`📝 Step 1: UserProfile.UserType already 'Free' for user ${userIdInt}, preserving UserTypeChangedDate`);
        // UserType unchanged, don't update UserTypeChangedDate
      }
    } else {
      console.log(`📝 Step 1: UserProfile.UserType remains '${currentUserType}' for user ${userIdInt}, no update needed`);
    }

    // 2. Upsert user_subscriptions table
    console.log(`📝 Step 2: Upserting [dbo].[user_subscriptions] for user ${userIdInt}`);
    const checkSubRequest = new mssql.Request(transaction);
    const existingSub = await checkSubRequest
      .input('userId', mssql.Int, userIdInt)
      .query(`SELECT UserId FROM [dbo].[user_subscriptions] WHERE UserId = @userId`);

    if (existingSub.recordset.length > 0) {
      console.log(`📝 Step 2a: Updating existing subscription`);
      // Build UPDATE query with available fields
      const updateFields = [
        '[plan] = @plan',
        'status = @status',
        'updated_at = SYSDATETIMEOFFSET()'
      ];
      
      if (subscriptionId) {
        updateFields.push('subscription_id = @subscriptionId');
      }
      if (customerId) {
        updateFields.push('customer_id = @customerId');
      }
      if (currentPeriodStart) {
        updateFields.push('current_period_start = @currentPeriodStart');
      }
      if (currentPeriodEnd) {
        updateFields.push('current_period_end = @currentPeriodEnd');
      }
      if (paymentIntentId) {
        updateFields.push('payment_intent_id = @paymentIntentId');
      }
      
      const updateQuery = `UPDATE [dbo].[user_subscriptions] SET ${updateFields.join(', ')} WHERE UserId = @userId`;
      
      const updateRequest = new mssql.Request(transaction);
      updateRequest.input('userId', mssql.Int, userIdInt);
      updateRequest.input('plan', mssql.NVarChar(32), capitalizedPlan);
      updateRequest.input('status', mssql.NVarChar(32), subscriptionStatus);
      
      if (subscriptionId) updateRequest.input('subscriptionId', mssql.NVarChar(128), subscriptionId);
      if (customerId) updateRequest.input('customerId', mssql.NVarChar(128), customerId);
      if (currentPeriodStart) updateRequest.input('currentPeriodStart', mssql.DateTimeOffset, currentPeriodStart);
      if (currentPeriodEnd) updateRequest.input('currentPeriodEnd', mssql.DateTimeOffset, currentPeriodEnd);
      if (paymentIntentId) updateRequest.input('paymentIntentId', mssql.NVarChar(128), paymentIntentId);
      
      await updateRequest.query(updateQuery);
    } else {
      console.log(`📝 Step 2b: Inserting new subscription`);
      const insertFields = ['UserId', '[plan]', 'status', 'started_at', 'updated_at'];
      const insertValues = ['@userId', '@plan', '@status', 'SYSDATETIMEOFFSET()', 'SYSDATETIMEOFFSET()'];
      
      if (subscriptionId) {
        insertFields.push('subscription_id');
        insertValues.push('@subscriptionId');
      }
      if (customerId) {
        insertFields.push('customer_id');
        insertValues.push('@customerId');
      }
      if (currentPeriodStart) {
        insertFields.push('current_period_start');
        insertValues.push('@currentPeriodStart');
      }
      if (currentPeriodEnd) {
        insertFields.push('current_period_end');
        insertValues.push('@currentPeriodEnd');
      }
      if (paymentIntentId) {
        insertFields.push('payment_intent_id');
        insertValues.push('@paymentIntentId');
      }
      
      const insertQuery = `INSERT INTO [dbo].[user_subscriptions] (${insertFields.join(', ')}) VALUES (${insertValues.join(', ')})`;
      
      const insertRequest = new mssql.Request(transaction);
      insertRequest.input('userId', mssql.Int, userIdInt);
      insertRequest.input('plan', mssql.NVarChar(32), capitalizedPlan);
      insertRequest.input('status', mssql.NVarChar(32), subscriptionStatus);
      
      if (subscriptionId) insertRequest.input('subscriptionId', mssql.NVarChar(128), subscriptionId);
      if (customerId) insertRequest.input('customerId', mssql.NVarChar(128), customerId);
      if (currentPeriodStart) insertRequest.input('currentPeriodStart', mssql.DateTimeOffset, currentPeriodStart);
      if (currentPeriodEnd) insertRequest.input('currentPeriodEnd', mssql.DateTimeOffset, currentPeriodEnd);
      if (paymentIntentId) insertRequest.input('paymentIntentId', mssql.NVarChar(128), paymentIntentId);
      
      await insertRequest.query(insertQuery);
    }
    console.log(`✅ Step 2 complete: user_subscriptions updated`);

    // 3. Insert payment record (if paymentIntentId exists and not already recorded)
    if (paymentIntentId) {
      console.log(`📝 Step 3: Checking if payment already exists for payment_intent_id: ${paymentIntentId}`);
      const checkPaymentRequest = new mssql.Request(transaction);
      const existingPayment = await checkPaymentRequest
        .input('paymentIntentId', mssql.VarChar(128), paymentIntentId)
        .query(`SELECT payment_intent_id FROM [dbo].[payments] WHERE payment_intent_id = @paymentIntentId`);

      if (existingPayment.recordset.length > 0) {
        console.log(`⚠️ Payment already exists, skipping insert`);
      } else {
        console.log(`📝 Step 3: Inserting payment record with status: "${paymentStatus}"`);
        const paymentRequest = new mssql.Request(transaction);
        await paymentRequest
          .input('userId', mssql.Int, userIdInt)
          .input('plan', mssql.VarChar(32), capitalizedPlan)
          .input('amount', mssql.Decimal(10, 2), amount)
          .input('currency', mssql.VarChar(3), currency)
          .input('paymentMethod', mssql.VarChar(32), finalPaymentMethod)
          .input('paymentIntentId', mssql.VarChar(128), paymentIntentId)
          .input('status', mssql.VarChar(32), paymentStatus)
          .query(`INSERT INTO [dbo].[payments] (UserId, [plan], amount, currency, paymentMethod, payment_intent_id, status, created_date, confirmed_date) VALUES (@userId, @plan, @amount, @currency, @paymentMethod, @paymentIntentId, @status, GETDATE(), GETDATE())`);
        console.log(`✅ Step 3 complete: Payment recorded`);
      }
    }

    // Commit transaction
    await transaction.commit();
    console.log('✅ Transaction committed');

    console.log(`✅ All steps complete: Subscription updated for user ${userIdInt}: ${capitalizedPlan} - ${subscriptionStatus}`);
    console.log(`   Payment: ${currency} ${amount}, Status: ${paymentStatus}`);

    return { 
      ok: true, 
      userId: userIdInt, 
      subscriptionStatus, 
      plan: capitalizedPlan, 
      paymentIntentId: paymentIntentId || null,
      subscriptionId: subscriptionId || null,
      customerId: customerId || null
    };
  } catch (dbErr) {
    // Rollback transaction on error
    try {
      await transaction.rollback();
      console.log('❌ Transaction rolled back');
    } catch (rollbackErr) {
      console.error('❌ Error rolling back transaction:', rollbackErr.message);
    }
    
    console.error('❌ Database error:', dbErr.message);
    console.error('❌ Error code:', dbErr.code);
    if (dbErr.originalError) {
      console.error('❌ Original error:', dbErr.originalError.message);
    }
    throw dbErr;
  }
}

// POST /api/data/users/updateSubscription
router.post('/users/updateSubscription', authenticateToken, async (req, res) => {
  console.log('🚀 updateSubscription endpoint called');
  console.log('📥 Request body:', JSON.stringify(req.body));
  console.log('👤 User from token:', req.user?.userId);
  
  try {
    const userId = req.user.userId || req.body.userId;
    const { 
      subscriptionStatus = 'active', 
      plan = 'premium', 
      paymentIntentId, 
      paymentMethod = 'stripe',
      subscriptionId,
      customerId,
      currentPeriodStart,
      currentPeriodEnd
    } = req.body || {};
    
    console.log(`📋 Parsed: userId=${userId}, plan=${plan}, status=${subscriptionStatus}`);
    console.log(`   subscriptionId=${subscriptionId || 'N/A'}, paymentIntentId=${paymentIntentId || 'N/A'}`);
    
    if (!userId) {
      console.error('❌ Missing userId');
      return res.status(400).json({ error: 'userId is required' });
    }
    
    // Require either subscriptionId or paymentIntentId (for backward compatibility)
    if (!subscriptionId && !paymentIntentId) {
      console.error('❌ Missing subscriptionId or paymentIntentId');
      return res.status(400).json({ error: 'subscriptionId or paymentIntentId is required' });
    }

    console.log('🔄 Calling updateSubscriptionInDatabase...');
    const result = await updateSubscriptionInDatabase(
      userId, 
      subscriptionStatus, 
      plan, 
      paymentIntentId, 
      paymentMethod,
      subscriptionId,
      customerId,
      currentPeriodStart,
      currentPeriodEnd
    );
    console.log('✅ updateSubscriptionInDatabase completed successfully');
    return res.json(result);
  } catch (err) {
    console.error('❌ updateSubscription error:', err.message);
    console.error('❌ Error stack:', err.stack);
    console.error('❌ Error code:', err.code);
    
    if (err.code === 'EREQUEST') {
      return res.status(500).json({ 
        error: 'Database error', 
        message: err.message,
        details: 'Check if tables exist and schema is correct'
      });
    }
    
    return res.status(500).json({ 
      error: 'Failed to update subscription',
      message: err.message 
    });
  }
});

// GET /api/data/users/subscription/status
// Get current subscription status for the authenticated user
router.get('/users/subscription/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not available' });
    }

    // Get subscription data from user_subscriptions table
    const subscriptionRequest = pool.request();
    subscriptionRequest.input('userId', mssql.Int, parseInt(userId, 10));
    
    const subscriptionResult = await subscriptionRequest.query(`
      SELECT 
        [plan],
        status,
        current_period_start,
        current_period_end,
        subscription_id,
        customer_id,
        started_at,
        updated_at
      FROM [dbo].[user_subscriptions]
      WHERE UserId = @userId
    `);

    // Get UserType from UserProfile
    const userProfileRequest = pool.request();
    userProfileRequest.input('userId', mssql.Int, parseInt(userId, 10));
    
    const userProfileResult = await userProfileRequest.query(`
      SELECT UserType, UserTypeChangedDate
      FROM [dbo].[UserProfile]
      WHERE UserID = @userId
    `);

    const subscription = subscriptionResult.recordset[0];
    const userProfile = userProfileResult.recordset[0];

    // If no subscription record exists, return Free plan
    if (!subscription) {
      return res.json({
        plan: userProfile?.UserType || 'Free',
        status: 'inactive',
        currentPeriodEnd: null,
        currentPeriodStart: null,
        nextBillingDate: null,
        hasActiveSubscription: false
      });
    }

    // Format dates for response
    let nextBillingDate = null;
    let currentPeriodStart = null;
    
    if (subscription.current_period_end) {
      // Handle both DATETIMEOFFSET and string formats
      const periodEnd = subscription.current_period_end instanceof Date 
        ? subscription.current_period_end 
        : new Date(subscription.current_period_end);
      nextBillingDate = periodEnd.toISOString();
    }
    
    if (subscription.current_period_start) {
      const periodStart = subscription.current_period_start instanceof Date 
        ? subscription.current_period_start 
        : new Date(subscription.current_period_start);
      currentPeriodStart = periodStart.toISOString();
    }

    return res.json({
      plan: subscription.plan || userProfile?.UserType || 'Free',
      status: subscription.status || 'inactive',
      currentPeriodEnd: nextBillingDate,
      currentPeriodStart: currentPeriodStart,
      nextBillingDate: nextBillingDate,
      subscriptionId: subscription.subscription_id || null,
      customerId: subscription.customer_id || null,
      hasActiveSubscription: subscription.status === 'active' || subscription.status === 'trialing',
      startedAt: subscription.started_at ? (subscription.started_at instanceof Date ? subscription.started_at.toISOString() : new Date(subscription.started_at).toISOString()) : null,
      updatedAt: subscription.updated_at ? (subscription.updated_at instanceof Date ? subscription.updated_at.toISOString() : new Date(subscription.updated_at).toISOString()) : null
    });
  } catch (err) {
    console.error('❌ Get subscription status error:', err.message);
    return res.status(500).json({
      error: 'Failed to get subscription status',
      message: err.message
    });
  }
});

// // POST /api/users/updateSubscription
// router.post('/users/updateSubscription', authenticateToken, async (req, res) => {
//   try {
//     const userId = req.user.userId;
//     const { subscriptionStatus = 'active', plan = 'premium', paymentIntentId } = req.body || {};

//     if (!userId) {
//       return res.status(400).json({ error: 'userId is required' });
//     }

//     if (!paymentIntentId) {
//       return res.status(400).json({ error: 'paymentIntentId is required' });
//     }

//     const pool = getPool();

//     // Update payment record with payment_intent_id and status
//     await pool.request()
//       .input('userId', userId)
//       .input('paymentIntentId', paymentIntentId)
//       .input('status', subscriptionStatus === 'active' ? 'succeeded' : subscriptionStatus)
//       .query(`
//         UPDATE [dbo].[payments]
//         SET payment_intent_id = @paymentIntentId,
//             status = @status,
//             confirmed_date = GETDATE()
//         WHERE UserId = @userId 
//           AND payment_intent_id IS NULL
//           AND status = 'pending'
//         ORDER BY created_date DESC
//       `);

//     // Update UserProfile.UserType to 'Premium' when subscription is active
//     if (subscriptionStatus === 'active' && plan === 'premium') {
//       await pool.request()
//         .input('userId', userId)
//         .query(`
//           UPDATE [dbo].[UserProfile]
//           SET UserType = 'Premium'
//           WHERE UserID = @userId
//         `);
//     }

//     res.status(200).json({ 
//       ok: true, 
//       userId, 
//       subscriptionStatus, 
//       plan, 
//       paymentIntentId 
//     });
//   } catch (err) {
//     console.error('Update subscription error:', err);
//     res.status(500).json({
//       message: 'Failed to update subscription',
//       sqlMessage: err.originalError?.info?.message || err.message,
//       stack: err.stack
//     });
//   }
// });

// Stripe Webhook endpoint for subscription lifecycle events
// This endpoint does NOT use authenticateToken - Stripe signs webhooks with a secret
// Note: server.js must use express.raw() middleware for this route before express.json()
router.post('/webhooks/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('⚠️ STRIPE_WEBHOOK_SECRET not set - webhook verification skipped');
    // In development, you might want to skip verification
    // In production, always verify webhooks
  }

  let event;

  try {
    // req.body should be a Buffer if express.raw() middleware is configured correctly
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } else {
      // Development mode: parse without verification (NOT recommended for production)
      event = JSON.parse(rawBody.toString());
      console.warn('⚠️ Webhook verification skipped - development mode');
    }
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`📥 Webhook received: ${event.type}`);

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        {
          const subscription = event.data.object;
          const userId = subscription.metadata?.userId;
          
          if (!userId) {
            console.warn('⚠️ Subscription webhook missing userId in metadata');
            return res.json({ received: true });
          }

          console.log(`🔄 Processing subscription ${event.type} for user ${userId}`);
          
          // Update subscription in database
                  await updateSubscriptionInDatabase(
                    userId,
                    subscription.status,
                    subscription.metadata?.plan || 'premium',
                    subscription.latest_invoice?.payment_intent?.id || null,
                    subscription.metadata?.paymentMethod || 'stripe',
                    subscription.id,
                    subscription.customer,
                    subscription.current_period_start && typeof subscription.current_period_start === 'number' 
                      ? new Date(subscription.current_period_start * 1000).toISOString() 
                      : null,
                    subscription.current_period_end && typeof subscription.current_period_end === 'number'
                      ? new Date(subscription.current_period_end * 1000).toISOString()
                      : null
                  );
          
          console.log(`✅ Subscription ${event.type} processed successfully`);
        }
        break;

      case 'customer.subscription.deleted':
        {
          const subscription = event.data.object;
          const userId = subscription.metadata?.userId;
          
          if (!userId) {
            console.warn('⚠️ Subscription deletion webhook missing userId in metadata');
            return res.json({ received: true });
          }

          console.log(`🔄 Processing subscription deletion for user ${userId}`);
          
          // Update subscription status to canceled
                  await updateSubscriptionInDatabase(
                    userId,
                    'canceled',
                    subscription.metadata?.plan || 'premium',
                    null,
                    subscription.metadata?.paymentMethod || 'stripe',
                    subscription.id,
                    subscription.customer,
                    subscription.current_period_start && typeof subscription.current_period_start === 'number'
                      ? new Date(subscription.current_period_start * 1000).toISOString()
                      : null,
                    subscription.current_period_end && typeof subscription.current_period_end === 'number'
                      ? new Date(subscription.current_period_end * 1000).toISOString()
                      : null
                  );
          
          console.log(`✅ Subscription deletion processed successfully`);
        }
        break;

      case 'invoice.payment_succeeded':
        {
          const invoice = event.data.object;
          const subscriptionId = invoice.subscription;
          
          if (!subscriptionId) {
            console.warn('⚠️ Invoice payment_succeeded webhook missing subscription ID');
            return res.json({ received: true });
          }

          // Retrieve subscription to get userId
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const userId = subscription.metadata?.userId;
          
          if (!userId) {
            console.warn('⚠️ Invoice payment_succeeded webhook missing userId');
            return res.json({ received: true });
          }

          console.log(`🔄 Processing invoice payment succeeded for user ${userId}, subscription ${subscriptionId}`);
          
          // Update subscription - payment succeeded means subscription should be active
                  await updateSubscriptionInDatabase(
                    userId,
                    subscription.status,
                    subscription.metadata?.plan || 'premium',
                    invoice.payment_intent?.id || null,
                    subscription.metadata?.paymentMethod || 'stripe',
                    subscription.id,
                    subscription.customer,
                    subscription.current_period_start && typeof subscription.current_period_start === 'number'
                      ? new Date(subscription.current_period_start * 1000).toISOString()
                      : null,
                    subscription.current_period_end && typeof subscription.current_period_end === 'number'
                      ? new Date(subscription.current_period_end * 1000).toISOString()
                      : null
                  );
          
          console.log(`✅ Invoice payment succeeded processed successfully`);
        }
        break;

      case 'invoice.payment_failed':
        {
          const invoice = event.data.object;
          const subscriptionId = invoice.subscription;
          
          if (!subscriptionId) {
            console.warn('⚠️ Invoice payment_failed webhook missing subscription ID');
            return res.json({ received: true });
          }

          // Retrieve subscription to get userId
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const userId = subscription.metadata?.userId;
          
          if (!userId) {
            console.warn('⚠️ Invoice payment_failed webhook missing userId');
            return res.json({ received: true });
          }

          console.log(`🔄 Processing invoice payment failed for user ${userId}, subscription ${subscriptionId}`);
          
          // Update subscription status - payment failed might set status to past_due
                  await updateSubscriptionInDatabase(
                    userId,
                    subscription.status, // Could be 'past_due' or 'unpaid'
                    subscription.metadata?.plan || 'premium',
                    invoice.payment_intent?.id || null,
                    subscription.metadata?.paymentMethod || 'stripe',
                    subscription.id,
                    subscription.customer,
                    subscription.current_period_start && typeof subscription.current_period_start === 'number'
                      ? new Date(subscription.current_period_start * 1000).toISOString()
                      : null,
                    subscription.current_period_end && typeof subscription.current_period_end === 'number'
                      ? new Date(subscription.current_period_end * 1000).toISOString()
                      : null
                  );
          
          console.log(`✅ Invoice payment failed processed successfully`);
        }
        break;

      default:
        console.log(`ℹ️ Unhandled webhook event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('❌ Webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed', message: err.message });
  }
});

module.exports = router;