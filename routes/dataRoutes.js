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

// ========== VALIDATION AND ERROR HANDLING HELPERS ==========

// Helper function for input validation
function validateUserId(userId) {
  if (!userId) {
    throw new Error('userId is required');
  }
  const userIdInt = parseInt(userId, 10);
  if (isNaN(userIdInt) || userIdInt <= 0) {
    throw new Error(`Invalid userId: ${userId} - must be a positive integer`);
  }
  return userIdInt;
}

function validateSubscriptionId(subscriptionId) {
  if (!subscriptionId) {
    throw new Error('subscriptionId is required');
  }
  if (typeof subscriptionId !== 'string' || !subscriptionId.startsWith('sub_')) {
    throw new Error(`Invalid subscriptionId format: ${subscriptionId} - must start with 'sub_'`);
  }
  return subscriptionId;
}

function validateCustomerId(customerId) {
  if (!customerId) {
    throw new Error('customerId is required');
  }
  if (typeof customerId !== 'string' || !customerId.startsWith('cus_')) {
    throw new Error(`Invalid customerId format: ${customerId} - must start with 'cus_'`);
  }
  return customerId;
}

function validatePaymentIntentId(paymentIntentId) {
  if (!paymentIntentId) {
    throw new Error('paymentIntentId is required');
  }
  if (typeof paymentIntentId !== 'string' || !paymentIntentId.startsWith('pi_')) {
    throw new Error(`Invalid paymentIntentId format: ${paymentIntentId} - must start with 'pi_'`);
  }
  return paymentIntentId;
}

function validateDateString(dateString, fieldName = 'date') {
  if (!dateString) {
    return null;
  }
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName} format: ${dateString} - must be a valid ISO date string`);
  }
  return date.toISOString();
}

// Standardized error response helper
function sendErrorResponse(res, statusCode, error, message, details = null) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ Error: ${error} - ${message}`);
  if (details && process.env.NODE_ENV !== 'production') {
    console.error(`   Details:`, details);
  }
  
  const response = {
    error: error,
    message: message,
    timestamp: timestamp
  };
  
  if (details && process.env.NODE_ENV !== 'production') {
    response.details = details;
  }
  
  return res.status(statusCode).json(response);
}

// ========== PAYMENT ENDPOINTS ==========

// POST /api/data/payments/initialize
router.post('/payments/initialize', authenticateToken, async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📥 Payment initialization request received`);
  
  try {
    // Validate environment variables
    if (!process.env.STRIPE_SECRET_KEY) {
      return sendErrorResponse(res, 500, 'Configuration Error', 'STRIPE_SECRET_KEY missing on server');
    }

    // Map billing intervals to Stripe Price IDs
    const priceIdMap = {
      monthly: process.env.STRIPE_PRICE_ID_MONTHLY || process.env.STRIPE_PRICE_ID,
      semi_annual: process.env.STRIPE_PRICE_ID_SEMI_ANNUAL,
      annual: process.env.STRIPE_PRICE_ID_ANNUAL
    };

    // Validate that at least monthly price ID exists
    if (!priceIdMap.monthly) {
      return sendErrorResponse(res, 500, 'Configuration Error', 
        'STRIPE_PRICE_ID_MONTHLY missing on server. Please configure Stripe Price IDs.');
    }

    // Validate userId
    const userId = req.user.userId;
    try {
      validateUserId(userId);
    } catch (validationErr) {
      return sendErrorResponse(res, 400, 'Validation Error', validationErr.message);
    }

    const { plan = 'premium', billingInterval = 'monthly', paymentMethod = 'stripe' } = req.body || {};
    
    // Validate billingInterval
    if (!['monthly', 'semi_annual', 'annual'].includes(billingInterval)) {
      return sendErrorResponse(res, 400, 'Validation Error', 
        'billingInterval must be one of: monthly, semi_annual, annual');
    }

    // Get the correct Price ID based on billing interval
    const priceId = priceIdMap[billingInterval];
    if (!priceId) {
      return sendErrorResponse(res, 500, 'Configuration Error', 
        `STRIPE_PRICE_ID_${billingInterval.toUpperCase()} missing on server`);
    }
    
    // Validate plan
    if (plan && typeof plan !== 'string') {
      return sendErrorResponse(res, 400, 'Validation Error', 'plan must be a string');
    }
    
    // Validate paymentMethod
    if (paymentMethod && typeof paymentMethod !== 'string') {
      return sendErrorResponse(res, 400, 'Validation Error', 'paymentMethod must be a string');
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
          const existingCustomerId = existingCustomer.recordset[0].customer_id;
          console.log(`📝 Found existing customer_id in database: ${existingCustomerId}`);
          
          // Try to retrieve customer from Stripe
          try {
            customer = await stripe.customers.retrieve(existingCustomerId);
            console.log(`✅ Retrieved existing Stripe Customer: ${customer.id}`);
            
            // Verify customer exists and is valid
            if (customer.deleted) {
              console.warn(`⚠️ Customer ${existingCustomerId} was deleted in Stripe, will create new one`);
              customer = null;
            } else {
              // Sync customer email/name with current user profile if changed
              if (pool) {
                try {
                  const userInfoRequest = pool.request();
                  userInfoRequest.input('userId', mssql.Int, parseInt(userId, 10));
                  // Join UserLogin (for email) with UserProfile (for name)
                  const userInfoResult = await userInfoRequest.query(`
                    SELECT 
                      UL.Email,
                      UP.FirstName,
                      UP.LastName
                    FROM [dbo].[UserLogin] UL
                    LEFT JOIN [dbo].[UserProfile] UP ON UL.UserID = UP.UserID
                    WHERE UL.UserID = @userId
                  `);
                  
                  if (userInfoResult.recordset.length > 0) {
                    const userInfo = userInfoResult.recordset[0];
                    const userEmail = userInfo.Email || null;
                    const firstName = userInfo.FirstName || '';
                    const lastName = userInfo.LastName || '';
                    const userName = `${firstName} ${lastName}`.trim() || null;
                    
                    // Check if email or name needs updating
                    const needsEmailUpdate = userEmail && customer.email !== userEmail;
                    const needsNameUpdate = userName && customer.name !== userName;
                    
                    if (needsEmailUpdate || needsNameUpdate) {
                      console.log(`🔄 Syncing customer ${customer.id} with updated user profile`);
                      const updateData = {};
                      if (needsEmailUpdate) {
                        updateData.email = userEmail;
                        console.log(`   📧 Updating email: ${customer.email} → ${userEmail}`);
                      }
                      if (needsNameUpdate) {
                        updateData.name = userName;
                        console.log(`   👤 Updating name: ${customer.name || 'not set'} → ${userName}`);
                      }
                      
                      customer = await stripe.customers.update(existingCustomerId, updateData);
                      console.log(`✅ Customer synced successfully`);
                    }
                  }
                } catch (syncErr) {
                  console.warn('⚠️ Could not sync customer with user profile:', syncErr.message);
                  // Continue with existing customer - sync failure is not critical
                }
              }
            }
          } catch (stripeErr) {
            // Customer doesn't exist in Stripe (might have been deleted)
            if (stripeErr.code === 'resource_missing' || stripeErr.statusCode === 404) {
              console.warn(`⚠️ Customer ${existingCustomerId} not found in Stripe (may have been deleted), will create new one`);
              customer = null;
            } else {
              // Other Stripe error - log and continue to create new customer
              console.error(`❌ Error retrieving customer from Stripe:`, stripeErr.message);
              customer = null;
            }
          }
        }
      } catch (dbErr) {
        console.warn('⚠️ Could not check for existing customer in database:', dbErr.message);
      }
    }

    // Create new customer if doesn't exist
    if (!customer) {
      console.log('🔄 Creating new Stripe Customer for user:', userId);
      try {
        // Retrieve user email from UserLogin and name from UserProfile for better Stripe dashboard visibility
        let userEmail = null;
        let userName = null;
        
        if (pool) {
          try {
            const userInfoRequest = pool.request();
            userInfoRequest.input('userId', mssql.Int, parseInt(userId, 10));
            // Join UserLogin (for email) with UserProfile (for name)
            const userInfoResult = await userInfoRequest.query(`
              SELECT 
                UL.Email,
                UP.FirstName,
                UP.LastName
              FROM [dbo].[UserLogin] UL
              LEFT JOIN [dbo].[UserProfile] UP ON UL.UserID = UP.UserID
              WHERE UL.UserID = @userId
            `);
            
            if (userInfoResult.recordset.length > 0) {
              const userInfo = userInfoResult.recordset[0];
              userEmail = userInfo.Email || null;
              const firstName = userInfo.FirstName || '';
              const lastName = userInfo.LastName || '';
              userName = `${firstName} ${lastName}`.trim() || null;
              
              console.log(`📧 Retrieved user email: ${userEmail || 'not found'}`);
              console.log(`👤 Retrieved user name: ${userName || 'not found'}`);
              
              if (!userEmail) {
                console.warn(`⚠️ No email found for user ${userId} in UserLogin table - customer will be created without email`);
              }
            } else {
              console.warn(`⚠️ No user found in database for userId ${userId} - customer will be created without email/name`);
            }
          } catch (profileErr) {
            console.error('❌ Error retrieving user info for customer creation:', profileErr.message);
            console.error('   Stack:', profileErr.stack);
            // Continue without email/name - customer will still be created
          }
        } else {
          console.warn('⚠️ Database pool not available - customer will be created without email/name');
        }
        
        // Build customer creation object
        const customerData = {
          metadata: {
            userId: String(userId),
            plan: plan
          }
        };
        
        // Add email if available (CRITICAL for Stripe dashboard visibility)
        // Stripe customers without email are harder to find in dashboard
        if (userEmail) {
          customerData.email = userEmail;
          console.log(`📧 Adding email to customer: ${userEmail}`);
        } else {
          console.warn(`⚠️ Creating customer WITHOUT email - customer may not appear in Stripe dashboard easily`);
        }
        
        // Add name if available (helps with Stripe dashboard visibility)
        if (userName) {
          customerData.name = userName;
          console.log(`👤 Adding name to customer: ${userName}`);
        }
        
        console.log(`🔄 Creating Stripe customer with data:`, {
          email: customerData.email || 'not set',
          name: customerData.name || 'not set',
          metadata: customerData.metadata
        });
        
        customer = await stripe.customers.create(customerData);
        console.log('✅ Created Stripe Customer:', customer.id);
        console.log('   Customer details:', {
          id: customer.id,
          email: customer.email || 'not set',
          name: customer.name || 'not set',
          created: customer.created,
          metadata: customer.metadata
        });
        
        // IMPORTANT: Save customer_id to database immediately after creation
        // This ensures customer appears in Stripe dashboard and is linked properly
        if (pool && customer.id) {
          try {
            const saveCustomerRequest = pool.request();
            saveCustomerRequest.input('userId', mssql.Int, parseInt(userId, 10));
            saveCustomerRequest.input('customerId', mssql.NVarChar(128), customer.id);
            
            // Check if user_subscriptions record exists
            const checkSub = await saveCustomerRequest.query(`
              SELECT UserId FROM [dbo].[user_subscriptions] WHERE UserId = @userId
            `);
            
            if (checkSub.recordset.length > 0) {
              // Update existing record
              await saveCustomerRequest.query(`
                UPDATE [dbo].[user_subscriptions] 
                SET customer_id = @customerId, updated_at = SYSDATETIMEOFFSET()
                WHERE UserId = @userId
              `);
              console.log(`✅ Saved customer_id ${customer.id} to existing user_subscriptions record`);
            } else {
              // Create new record with customer_id
              await saveCustomerRequest
                .input('plan', mssql.NVarChar(32), plan.charAt(0).toUpperCase() + plan.slice(1))
                .input('status', mssql.NVarChar(32), 'pending')
                .query(`
                  INSERT INTO [dbo].[user_subscriptions] (UserId, [plan], status, customer_id, started_at, updated_at)
                  VALUES (@userId, @plan, @status, @customerId, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET())
                `);
              console.log(`✅ Created user_subscriptions record with customer_id ${customer.id}`);
            }
          } catch (saveErr) {
            console.warn('⚠️ Could not save customer_id to database immediately:', saveErr.message);
            // Don't fail - customer_id will be saved when subscription is updated
          }
        }
      } catch (createErr) {
        console.error('❌ Failed to create Stripe Customer:', createErr.message);
        throw new Error(`Failed to create Stripe customer: ${createErr.message}`);
      }
    }
    
    // Final validation - ensure customer exists
    if (!customer || !customer.id) {
      throw new Error('Failed to get or create Stripe customer');
    }
    
    console.log(`✅ Using Stripe Customer: ${customer.id} for user ${userId}`);

    // Create Subscription with payment_behavior: 'default_incomplete'
    // This creates an incomplete subscription and returns a PaymentIntent for the first payment
    // Note: Apple Pay is enabled on the PaymentIntent, not in subscription payment_settings
    // Apple Pay support comes through PaymentIntent's automatic_payment_methods or payment_method_types
    console.log(`🔄 Creating Stripe Subscription with Price ID: ${priceId} (${billingInterval})`);
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { 
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'] // Only 'card' is valid here; Apple Pay enabled via PaymentIntent
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        userId: String(userId),
        plan: plan,
        billingInterval: billingInterval,
        paymentMethod: paymentMethod
      }
    });

    console.log('✅ Created Stripe Subscription:', subscription.id);
    console.log('📋 Subscription status:', subscription.status);
    console.log('📋 Subscription customer:', subscription.customer);
    console.log('📋 Customer ID being used:', customer.id);
    
    // Verify customer is properly linked to subscription
    const subscriptionCustomerId = typeof subscription.customer === 'string' 
      ? subscription.customer 
      : subscription.customer?.id;
    
    if (subscriptionCustomerId !== customer.id) {
      console.warn(`⚠️ Customer ID mismatch! Subscription customer: ${subscriptionCustomerId}, Expected: ${customer.id}`);
    } else {
      console.log(`✅ Customer ${customer.id} properly linked to subscription ${subscription.id}`);
    }

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
            // Use automatic_payment_methods to enable Apple Pay and other payment methods
            // CRITICAL: Use setup_future_usage to automatically attach payment method to customer
            paymentIntent = await stripe.paymentIntents.create({
              amount: amount,
              currency: currency,
              customer: customer.id,
              automatic_payment_methods: { enabled: true }, // Enables Apple Pay, Link, and other payment methods
              setup_future_usage: 'off_session', // Automatically attach payment method to customer when PaymentIntent succeeds
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
        
        // Step 4b: Update PaymentIntent to enable Apple Pay and setup_future_usage
        // Enable automatic_payment_methods to support Apple Pay and other payment methods
        if (paymentIntent) {
          try {
            const updateParams = {};
            if (!paymentIntent.setup_future_usage) {
              updateParams.setup_future_usage = 'off_session';
            }
            // Enable automatic payment methods (includes Apple Pay) if not already enabled
            if (!paymentIntent.automatic_payment_methods?.enabled && 
                !paymentIntent.payment_method_types?.includes('apple_pay')) {
              updateParams.automatic_payment_methods = { enabled: true };
            }
            
            if (Object.keys(updateParams).length > 0) {
              console.log(`🔄 Updating PaymentIntent ${paymentIntent.id} to enable Apple Pay and setup_future_usage...`);
              paymentIntent = await stripe.paymentIntents.update(paymentIntent.id, updateParams);
              console.log(`✅ PaymentIntent updated with Apple Pay support`);
            }
          } catch (updateErr) {
            console.warn('⚠️ Could not update PaymentIntent:', updateErr.message);
            // Continue - payment will still work
          }
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

    // Final verification: Ensure customer exists in Stripe
    try {
      const verifiedCustomer = await stripe.customers.retrieve(customer.id);
      if (verifiedCustomer.deleted) {
        throw new Error(`Customer ${customer.id} was deleted in Stripe`);
      }
      console.log(`✅ Verified customer exists in Stripe: ${customer.id}`);
    } catch (verifyErr) {
      console.error(`❌ Customer verification failed:`, verifyErr.message);
      throw new Error(`Customer ${customer.id} does not exist in Stripe: ${verifyErr.message}`);
    }

    res.status(200).json({ 
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      subscriptionId: subscription.id,
      customerId: customer.id,
      status: subscription.status,
      billingInterval: billingInterval,
      priceId: priceId
    });
  } catch (err) {
    return sendErrorResponse(res, 500, 'Initialization Failed', 
      err?.message || 'Stripe subscription creation failed', 
      err.stack);
  }
});

// POST /api/data/customer-portal/create-session
router.post('/customer-portal/create-session', authenticateToken, async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📥 Customer portal session request received`);
  
  try {
    const userId = req.user.userId || req.body.userId;
    
    // Validate userId
    try {
      validateUserId(userId);
    } catch (validationErr) {
      return sendErrorResponse(res, 400, 'Validation Error', validationErr.message);
    }

    const pool = getPool();
    if (!pool) {
      return sendErrorResponse(res, 500, 'Database Error', 'Database connection not available');
    }

    // Get customer_id from database
    const customerRequest = pool.request();
    customerRequest.input('userId', mssql.Int, parseInt(userId, 10));
    const customerResult = await customerRequest.query(`
      SELECT customer_id FROM [dbo].[user_subscriptions] 
      WHERE UserId = @userId AND customer_id IS NOT NULL
    `);

    if (!customerResult.recordset.length || !customerResult.recordset[0].customer_id) {
      return sendErrorResponse(res, 404, 'Not Found', 
        'No Stripe customer found for this user. Please complete a payment first.');
    }

    const customerId = customerResult.recordset[0].customer_id;

    // Create portal session
    // return_url should point back to your app's subscription status screen
    // For React Native, you can use a deep link or web URL
    const returnUrl = req.body.returnUrl || 'https://www.hpapogee.com/subscription-status';
    
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    console.log(`✅ Created customer portal session: ${session.id} for customer ${customerId}`);

    res.status(200).json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    console.error('❌ Customer portal session creation failed:', err);
    return sendErrorResponse(res, 500, 'Portal Error', 
      err?.message || 'Failed to create customer portal session');
  }
});

// POST /api/data/payments/confirm
router.post('/payments/confirm', authenticateToken, async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📥 Payment confirmation request received`);
  
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return sendErrorResponse(res, 500, 'Configuration Error', 'STRIPE_SECRET_KEY missing on server');
    }

    const { paymentIntentId, subscriptionId } = req.body || {};
    
    // Validate that at least one ID is provided
    if (!paymentIntentId && !subscriptionId) {
      return sendErrorResponse(res, 400, 'Validation Error', 
        'paymentIntentId or subscriptionId required');
    }
    
    // Validate format if provided
    if (paymentIntentId) {
      try {
        validatePaymentIntentId(paymentIntentId);
      } catch (validationErr) {
        return sendErrorResponse(res, 400, 'Validation Error', validationErr.message);
      }
    }
    
    if (subscriptionId) {
      try {
        validateSubscriptionId(subscriptionId);
      } catch (validationErr) {
        return sendErrorResponse(res, 400, 'Validation Error', validationErr.message);
      }
    }

    let subscription;
    let paymentIntent;

    // Primary path: retrieve subscription if subscriptionId provided
    if (subscriptionId) {
      console.log(`📝 Retrieving subscription: ${subscriptionId}`);
      subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['latest_invoice.payment_intent', 'latest_invoice.payment_intent.payment_method']
      });
      
      // Get PaymentIntent from latest invoice
      paymentIntent = subscription.latest_invoice?.payment_intent;
      
      // If paymentIntent is a string ID, retrieve it
      if (typeof paymentIntent === 'string') {
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent, {
          expand: ['payment_method', 'latest_charge'] // Expand payment_method and latest_charge for Apple Pay detection
        });
      } else if (paymentIntent && typeof paymentIntent === 'object' && !paymentIntent.payment_method) {
        // If PaymentIntent object doesn't have payment_method, retrieve with expansion
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent.id, {
          expand: ['payment_method', 'latest_charge'] // Expand latest_charge for Apple Pay detection
        });
      }
      
      // If paymentIntentId was provided separately, use it to verify
      if (paymentIntentId && paymentIntent?.id !== paymentIntentId) {
        console.log(`⚠️ PaymentIntent mismatch. Using provided paymentIntentId: ${paymentIntentId}`);
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: ['payment_method', 'latest_charge'] // Expand payment_method and latest_charge for Apple Pay detection
        });
        
        // Note: When PaymentIntent succeeds, Stripe automatically pays the associated invoice
        // If we manually created the PaymentIntent, Stripe will still handle invoice payment
        // We don't need to manually pay the invoice - Stripe handles it via webhooks
        // The subscription status will be updated automatically when invoice is paid
      }
    } else if (paymentIntentId) {
      // Fallback: retrieve PaymentIntent and find associated subscription
      console.log(`📝 Retrieving PaymentIntent: ${paymentIntentId}`);
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['payment_method', 'latest_charge'] // Expand payment_method and latest_charge for Apple Pay detection
      });
      
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
      // If PaymentIntent succeeded, refresh subscription to get updated status and billing dates
      // Stripe may need a moment to update subscription status and set billing dates after PaymentIntent succeeds
      if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
        console.log(`📝 PaymentIntent status: ${paymentIntent.status}, refreshing subscription to get billing dates...`);
        // Wait a moment for Stripe to process
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Refresh subscription to get latest status and billing dates
        try {
          subscription = await stripe.subscriptions.retrieve(subscription.id, {
            expand: ['latest_invoice.payment_intent', 'items.data.price']
          });
          console.log(`📝 Refreshed subscription status: ${subscription.status}`);
          if (subscription.current_period_end) {
            console.log(`✅ Subscription has billing dates: period_end=${new Date(subscription.current_period_end * 1000).toISOString()}`);
          } else {
            console.warn(`⚠️ Subscription still missing billing dates after refresh`);
          }
        } catch (refreshErr) {
          console.warn('⚠️ Could not refresh subscription (non-critical):', refreshErr.message);
          // Continue with original subscription data
        }
      }
      
      // Extract dates from subscription for response and database save
      let currentPeriodStart = null;
      let currentPeriodEnd = null;
      
      if (subscription.current_period_start && typeof subscription.current_period_start === 'number') {
        currentPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
      }
      
      if (subscription.current_period_end && typeof subscription.current_period_end === 'number') {
        currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
      }
      
      // Save subscription details to database (including dates) - run in background to avoid blocking response
      if (subscription.id && req.user?.userId) {
        (async () => {
          try {
            const customerId = typeof subscription.customer === 'string' 
              ? subscription.customer 
              : subscription.customer?.id;
            
            // Extract payment method ID if available
            let paymentMethodId = null;
            if (paymentIntent?.payment_method) {
              paymentMethodId = typeof paymentIntent.payment_method === 'string' 
                ? paymentIntent.payment_method 
                : paymentIntent.payment_method.id;
            }
            
            console.log(`💾 Saving subscription ${subscription.id} to database for user ${req.user.userId}...`);
            console.log(`   Billing dates: start=${currentPeriodStart || 'NULL'}, end=${currentPeriodEnd || 'NULL'}`);
            const billingInterval = subscription.metadata?.billingInterval || null;
            await updateSubscriptionInDatabase(
              req.user.userId,
              subscription.status,
              'premium', // Default plan
              paymentIntent?.id || paymentIntentId,
              paymentMethodId || 'stripe',
              subscription.id,
              customerId,
              currentPeriodStart,
              currentPeriodEnd,
              billingInterval
            );
            console.log(`✅ Subscription details saved to database`);
          } catch (saveErr) {
            console.warn('⚠️ Could not save subscription to database (non-critical):', saveErr.message);
            // Don't fail the response - subscription will be saved via /users/updateSubscription or webhook
          }
        })(); // Fire and forget - don't await
      }
      
      // If PaymentIntent succeeded, handle invoice payment and payment method attachment
      // Do these operations asynchronously after sending response to avoid timeout
      if (paymentIntent?.status === 'succeeded') {
        // Run these operations in background (don't await - send response first)
        (async () => {
          try {
            const customerId = typeof subscription.customer === 'string' 
              ? subscription.customer 
              : subscription.customer.id;
            
            // Extract payment method ID - handle both string ID and expanded object
            let paymentMethodId = null;
            if (paymentIntent.payment_method) {
              paymentMethodId = typeof paymentIntent.payment_method === 'string' 
                ? paymentIntent.payment_method 
                : paymentIntent.payment_method.id;
            }
            
            // IMPORTANT: Payment method attachment is handled automatically by Stripe
            // via 'setup_future_usage: off_session' on PaymentIntent and 'save_default_payment_method: on_subscription' on subscription.
            // When PaymentIntent succeeds with setup_future_usage, Stripe automatically attaches the payment method to the customer.
            
            // 1. Check if payment method is attached and set as default
            if (paymentMethodId && customerId) {
              try {
                // Wait a moment for Stripe to process the automatic attachment
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
                
                if (paymentMethod.customer === customerId) {
                  console.log(`✅ Payment method ${paymentMethodId} attached to customer ${customerId}`);
                  
                  // Set as default payment method for customer
                  try {
                    await stripe.customers.update(customerId, {
                      invoice_settings: {
                        default_payment_method: paymentMethodId
                      }
                    });
                    console.log(`✅ Payment method set as default for customer ${customerId}`);
                  } catch (updateErr) {
                    console.warn('⚠️ Could not set payment method as default:', updateErr.message);
                  }
                } else {
                  // Payment method not attached yet - this can happen if setup_future_usage didn't work
                  // Try to attach it manually (only if it wasn't used in a different PaymentIntent)
                  console.log(`ℹ️ Payment method ${paymentMethodId} not attached to customer ${customerId}`);
                  console.log(`   Attempting to attach...`);
                  
                  try {
                    await stripe.paymentMethods.attach(paymentMethodId, {
                      customer: customerId
                    });
                    console.log(`✅ Successfully attached payment method to customer`);
                    
                    // Set as default
                    await stripe.customers.update(customerId, {
                      invoice_settings: {
                        default_payment_method: paymentMethodId
                      }
                    });
                    console.log(`✅ Payment method set as default`);
                  } catch (attachErr) {
                    if (attachErr.message?.includes('previously used') || attachErr.message?.includes('may not be used again')) {
                      console.log(`ℹ️ Payment method was already used - Stripe will handle attachment automatically`);
                      console.log(`   This is expected with setup_future_usage - attachment happens asynchronously`);
                    } else {
                      console.warn('⚠️ Could not attach payment method:', attachErr.message);
                    }
                  }
                }
              } catch (retrieveErr) {
                console.warn('⚠️ Could not retrieve payment method:', retrieveErr.message);
              }
            }
            
            // 2. Pay invoice - Stripe should handle payment method attachment automatically
            if (subscription.latest_invoice) {
              try {
                const invoiceId = typeof subscription.latest_invoice === 'string' 
                  ? subscription.latest_invoice 
                  : subscription.latest_invoice.id;
                
                const invoice = await stripe.invoices.retrieve(invoiceId);
                
                if (invoice.status === 'open' || invoice.status === 'draft') {
                  console.log(`💳 Paying invoice ${invoiceId} after PaymentIntent succeeded...`);
                  
                  // Pay invoice - Stripe will use the default payment method or the one from PaymentIntent
                  // Since PaymentIntent already succeeded, invoice should be payable
                  try {
                    await stripe.invoices.pay(invoiceId);
                    console.log(`✅ Invoice ${invoiceId} marked as paid`);
                  } catch (payErr) {
                    // If invoice can't be paid (e.g., no payment method), log but don't fail
                    // The PaymentIntent already succeeded, so payment is complete
                    if (payErr.code === 'invoice_already_paid') {
                      console.log(`✅ Invoice already paid`);
                    } else if (payErr.message?.includes('payment_method')) {
                      console.log(`ℹ️ Invoice payment requires payment method - this is handled by Stripe automatically`);
                      console.log(`   PaymentIntent already succeeded, so payment is complete`);
                    } else {
                      console.warn('⚠️ Could not pay invoice (non-critical):', payErr.message);
                    }
                  }
                } else if (invoice.status === 'paid') {
                  console.log(`✅ Invoice ${invoiceId} already paid`);
                }
              } catch (invoiceErr) {
                console.warn('⚠️ Could not retrieve/pay invoice (non-critical):', invoiceErr.message);
              }
            }
          } catch (err) {
            console.warn('⚠️ Background payment operations error (non-critical):', err.message);
          }
        })(); // Fire and forget - don't await
      }
      
      // Get amount and currency from subscription price
      const price = subscription.items.data[0]?.price;
      const amount = price?.unit_amount || paymentIntent?.amount || 0;
      const currency = price?.currency || paymentIntent?.currency || 'usd';
      
      // Convert dates to ISO strings for response (already converted above)
      res.status(200).json({ 
        id: subscription.id,
        status: subscription.status, // active, trialing, past_due, canceled, incomplete, etc.
        paymentIntentId: paymentIntent?.id || paymentIntentId,
        amount: amount,
        currency: currency,
        customerId: subscription.customer,
        currentPeriodStart: currentPeriodStart || (subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null),
        currentPeriodEnd: currentPeriodEnd || (subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null),
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
    return sendErrorResponse(res, 500, 'Confirmation Failed', 
      err?.message || 'Stripe confirm failed', 
      err.stack);
  }
});

// Helper function to update subscription in database
// Supports both Subscription-based (new) and PaymentIntent-based (legacy) subscriptions
async function updateSubscriptionInDatabase(userId, subscriptionStatus, plan, paymentIntentId, paymentMethod, subscriptionId, customerId, currentPeriodStart, currentPeriodEnd, billingInterval = null) {
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
      expand: ['latest_invoice.payment_intent', 'latest_invoice.payment_intent.payment_method', 'items.data.price'] // Expand items and payment_method
    });
    
    // Get payment intent from latest invoice or retrieve separately if paymentIntentId provided
    paymentIntent = subscription.latest_invoice?.payment_intent;
    
    // If paymentIntent is expanded but doesn't have payment_method, retrieve it separately
    if (paymentIntent && typeof paymentIntent === 'object' && !paymentIntent.payment_method && paymentIntent.id) {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent.id, {
        expand: ['payment_method']
      });
    }
    
    // If paymentIntentId was provided, retrieve it to get accurate status
    if (paymentIntentId) {
      console.log(`📝 Retrieving PaymentIntent for status check: ${paymentIntentId}`);
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['payment_method', 'latest_charge'] // Expand payment_method and latest_charge for Apple Pay detection
      });
    } else if (typeof paymentIntent === 'string') {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent, {
        expand: ['payment_method', 'latest_charge'] // Expand payment_method and latest_charge for Apple Pay detection
      });
    }
    
    // If PaymentIntent succeeded OR if billing dates are missing, refresh subscription to get updated status and dates
    // Stripe may need a moment to update subscription status and set billing dates after PaymentIntent succeeds
    const needsRefresh = (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) ||
                         !currentPeriodStart || !currentPeriodEnd;
    
    if (needsRefresh && subscriptionId) {
      console.log(`📝 Refreshing subscription to get latest status and billing dates...`);
      // Wait a moment for Stripe to process
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Refresh subscription to get latest status and billing dates
      subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['latest_invoice.payment_intent', 'items.data.price']
      });
      console.log(`📝 Refreshed subscription status: ${subscription.status}`);
      
      // Update dates from refreshed subscription if they were missing
      if (!currentPeriodStart && subscription.current_period_start && typeof subscription.current_period_start === 'number') {
        currentPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
        console.log(`✅ Retrieved current_period_start from Stripe: ${currentPeriodStart}`);
      }
      if (!currentPeriodEnd && subscription.current_period_end && typeof subscription.current_period_end === 'number') {
        currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
        console.log(`✅ Retrieved current_period_end from Stripe: ${currentPeriodEnd}`);
      }
      
      // Explicitly pay invoice and attach payment method if PaymentIntent succeeded
      // These operations are important but shouldn't block the main flow
      if (paymentIntent.status === 'succeeded') {
        // Run these operations in background (don't await - continue with main flow)
        (async () => {
          try {
            // Extract payment method ID - handle both string ID and expanded object
            let paymentMethodId = null;
            if (paymentIntent.payment_method) {
              paymentMethodId = typeof paymentIntent.payment_method === 'string' 
                ? paymentIntent.payment_method 
                : paymentIntent.payment_method.id;
            }
            
            // IMPORTANT: Payment method attachment is handled automatically by Stripe
            // via 'setup_future_usage: off_session' on PaymentIntent and 'save_default_payment_method: on_subscription' on subscription.
            // When PaymentIntent succeeds with setup_future_usage, Stripe automatically attaches the payment method to the customer.
            
            // 1. Check if payment method is attached and set as default
            if (customerId && paymentMethodId) {
              try {
                // Wait a moment for Stripe to process the automatic attachment
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
                
                if (paymentMethod.customer === customerId) {
                  console.log(`✅ Payment method ${paymentMethodId} attached to customer ${customerId}`);
                  
                  // Set as default payment method for customer
                  try {
                    await stripe.customers.update(customerId, {
                      invoice_settings: {
                        default_payment_method: paymentMethodId
                      }
                    });
                    console.log(`✅ Payment method set as default for customer ${customerId}`);
                  } catch (updateErr) {
                    console.warn('⚠️ Could not set payment method as default:', updateErr.message);
                  }
                } else {
                  // Payment method not attached yet - this can happen if setup_future_usage didn't work
                  // Try to attach it manually (only if it wasn't used in a different PaymentIntent)
                  console.log(`ℹ️ Payment method ${paymentMethodId} not attached to customer ${customerId}`);
                  console.log(`   Attempting to attach...`);
                  
                  try {
                    await stripe.paymentMethods.attach(paymentMethodId, {
                      customer: customerId
                    });
                    console.log(`✅ Successfully attached payment method to customer`);
                    
                    // Set as default
                    await stripe.customers.update(customerId, {
                      invoice_settings: {
                        default_payment_method: paymentMethodId
                      }
                    });
                    console.log(`✅ Payment method set as default`);
                  } catch (attachErr) {
                    if (attachErr.message?.includes('previously used') || attachErr.message?.includes('may not be used again')) {
                      console.log(`ℹ️ Payment method was already used - Stripe will handle attachment automatically`);
                      console.log(`   This is expected with setup_future_usage - attachment happens asynchronously`);
                    } else {
                      console.warn('⚠️ Could not attach payment method:', attachErr.message);
                    }
                  }
                }
              } catch (retrieveErr) {
                console.warn('⚠️ Could not retrieve payment method:', retrieveErr.message);
              }
            }
            
            // 2. Pay invoice - Stripe should handle payment method attachment automatically
            if (subscription.latest_invoice) {
              try {
                const invoiceId = typeof subscription.latest_invoice === 'string' 
                  ? subscription.latest_invoice 
                  : subscription.latest_invoice.id;
                
                const invoice = await stripe.invoices.retrieve(invoiceId);
                
                if (invoice.status === 'open' || invoice.status === 'draft') {
                  console.log(`💳 Paying invoice ${invoiceId} after PaymentIntent succeeded...`);
                  
                  // Pay invoice - Stripe will use the default payment method or the one from PaymentIntent
                  // Since PaymentIntent already succeeded, invoice should be payable
                  try {
                    await stripe.invoices.pay(invoiceId);
                    console.log(`✅ Invoice ${invoiceId} marked as paid`);
                  } catch (payErr) {
                    // If invoice can't be paid (e.g., no payment method), log but don't fail
                    // The PaymentIntent already succeeded, so payment is complete
                    if (payErr.code === 'invoice_already_paid') {
                      console.log(`✅ Invoice already paid`);
                    } else if (payErr.message?.includes('payment_method')) {
                      console.log(`ℹ️ Invoice payment requires payment method - this is handled by Stripe automatically`);
                      console.log(`   PaymentIntent already succeeded, so payment is complete`);
                    } else {
                      console.warn('⚠️ Could not pay invoice (non-critical):', payErr.message);
                    }
                  }
                } else if (invoice.status === 'paid') {
                  console.log(`✅ Invoice ${invoiceId} already paid`);
                }
              } catch (invoiceErr) {
                console.warn('⚠️ Could not retrieve/pay invoice (non-critical):', invoiceErr.message);
              }
            }
          } catch (err) {
            console.warn('⚠️ Background payment operations error (non-critical):', err.message);
          }
        })(); // Fire and forget - don't await
      }
    }
    
    // Extract subscription details (use refreshed status)
    subscriptionStatus = subscription.status;
    // Always get customerId from subscription (source of truth)
    // Handle both string ID and expanded customer object
    const subscriptionCustomerId = typeof subscription.customer === 'string' 
      ? subscription.customer 
      : subscription.customer?.id || subscription.customer;
    
    // Use subscription's customerId if available, otherwise keep the passed value
    if (subscriptionCustomerId) {
      customerId = subscriptionCustomerId;
      console.log(`📝 Retrieved customerId from Stripe subscription: ${customerId}`);
    } else if (!customerId) {
      console.warn(`⚠️ No customerId found in subscription and none provided as parameter`);
    }
    
    // If PaymentIntent succeeded but subscription is still incomplete, update to active
    // This handles the case where Stripe hasn't updated subscription status yet
    if (paymentIntent && paymentIntent.status === 'succeeded' && subscriptionStatus === 'incomplete') {
      console.log(`⚠️ PaymentIntent succeeded but subscription still incomplete, updating to active`);
      subscriptionStatus = 'active';
    }
    
    // ALWAYS retrieve period dates from Stripe subscription (source of truth)
    // Override any passed-in dates with Stripe's authoritative values
    if (subscription.current_period_start && typeof subscription.current_period_start === 'number') {
      currentPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
      console.log(`📅 Retrieved current_period_start from Stripe: ${currentPeriodStart}`);
    } else {
      console.warn(`⚠️ Subscription ${subscriptionId} missing current_period_start in Stripe`);
      currentPeriodStart = currentPeriodStart || null; // Use passed value if Stripe doesn't have it
    }
    
    if (subscription.current_period_end && typeof subscription.current_period_end === 'number') {
      currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
      console.log(`📅 Retrieved current_period_end from Stripe: ${currentPeriodEnd}`);
    } else {
      console.warn(`⚠️ Subscription ${subscriptionId} missing current_period_end in Stripe`);
      currentPeriodEnd = currentPeriodEnd || null; // Use passed value if Stripe doesn't have it
    }
    
    // Retry logic: If dates are missing but subscription is active/trialing, refresh from Stripe
    if ((!currentPeriodStart || !currentPeriodEnd) && (subscriptionStatus === 'active' || subscriptionStatus === 'trialing')) {
      console.log(`🔄 Dates missing for active/trialing subscription, retrying after delay...`);
      await new Promise(resolve => setTimeout(resolve, 750)); // Wait 750ms
      
      try {
        const refreshedSubscription = await stripe.subscriptions.retrieve(subscriptionId);
        
        if (refreshedSubscription.current_period_start && typeof refreshedSubscription.current_period_start === 'number') {
          currentPeriodStart = new Date(refreshedSubscription.current_period_start * 1000).toISOString();
          console.log(`✅ Retrieved current_period_start after retry: ${currentPeriodStart}`);
        }
        
        if (refreshedSubscription.current_period_end && typeof refreshedSubscription.current_period_end === 'number') {
          currentPeriodEnd = new Date(refreshedSubscription.current_period_end * 1000).toISOString();
          console.log(`✅ Retrieved current_period_end after retry: ${currentPeriodEnd}`);
        }
      } catch (retryErr) {
        console.warn(`⚠️ Retry failed to get dates: ${retryErr.message}`);
      }
    }
    
    // If dates are still missing, log warning but continue (will be synced later via webhook or status endpoint)
    if (!currentPeriodStart || !currentPeriodEnd) {
      console.warn(`⚠️ Missing billing dates for subscription ${subscriptionId}. Status: ${subscription.status}`);
      console.warn(`   Dates will be synced later via webhook or status endpoint`);
    } else {
      console.log(`✅ Both billing dates available: start=${currentPeriodStart}, end=${currentPeriodEnd}`);
    }
    
    // Extract billingInterval from subscription metadata if not provided
    if (!billingInterval && subscription.metadata?.billingInterval) {
      billingInterval = subscription.metadata.billingInterval;
      console.log(`📝 Retrieved billingInterval from subscription metadata: ${billingInterval}`);
    }
    
    // Get amount and currency from subscription price
    let currentPriceId = null;
    if (subscription.items.data.length > 0) {
      const price = subscription.items.data[0].price;
      currentPriceId = price.id;
      amount = price.unit_amount / 100;
      currency = price.currency.toUpperCase();
    }
    
    // If billingInterval is still missing, derive it from the current price ID
    // This handles cases where users upgrade/downgrade in customer portal and metadata isn't updated
    if (!billingInterval && currentPriceId) {
      const priceIdMap = {
        [process.env.STRIPE_PRICE_ID_MONTHLY || process.env.STRIPE_PRICE_ID]: 'monthly',
        [process.env.STRIPE_PRICE_ID_SEMI_ANNUAL]: 'semi_annual',
        [process.env.STRIPE_PRICE_ID_ANNUAL]: 'annual'
      };
      
      billingInterval = priceIdMap[currentPriceId] || null;
      
      if (billingInterval) {
        console.log(`📝 Determined billingInterval from price ID ${currentPriceId}: ${billingInterval}`);
        
        // Update subscription metadata with correct billing interval to keep it in sync
        try {
          await stripe.subscriptions.update(subscription.id, {
            metadata: {
              ...subscription.metadata,
              billingInterval: billingInterval
            }
          });
          console.log(`✅ Updated subscription metadata with billingInterval: ${billingInterval}`);
        } catch (updateErr) {
          console.warn('⚠️ Could not update subscription metadata with billingInterval:', updateErr.message);
          // Continue - billingInterval will still be saved to database
        }
      } else {
        console.warn(`⚠️ Could not determine billingInterval from price ID ${currentPriceId} - price ID not found in mapping`);
      }
    }
    
      // Map payment intent status to payment status and detect payment method type
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
        
        // Detect payment method type from PaymentIntent's payment_method object and charge details
        // This ensures Apple Pay is properly detected even if metadata is missing
        if (paymentIntent.payment_method) {
          try {
            const pm = typeof paymentIntent.payment_method === 'string' 
              ? await stripe.paymentMethods.retrieve(paymentIntent.payment_method)
              : paymentIntent.payment_method;
            
            // Check if this was Apple Pay by looking at the charge's payment_method_details
            // Apple Pay shows up as type 'card' but has payment_method_details.card.wallet.type === 'apple_pay'
            let isApplePay = false;
            if (paymentIntent.latest_charge) {
              try {
                const charge = typeof paymentIntent.latest_charge === 'string'
                  ? await stripe.charges.retrieve(paymentIntent.latest_charge)
                  : paymentIntent.latest_charge;
                
                // Apple Pay is detected via charge.payment_method_details.card.wallet.type === 'apple_pay'
                if (charge.payment_method_details?.card?.wallet?.type === 'apple_pay') {
                  isApplePay = true;
                  console.log('🍎 Detected Apple Pay payment from charge details');
                }
              } catch (chargeErr) {
                console.warn('⚠️ Could not retrieve charge details for Apple Pay detection:', chargeErr.message);
              }
            }
            
            if (pm.type === 'card') {
              // Card payment - check if it was Apple Pay
              if (isApplePay) {
                finalPaymentMethod = 'apple_pay';
                console.log('✅ Payment method set to: apple_pay');
              } else {
                // Regular card payment - check metadata first, then use provided paymentMethod
                finalPaymentMethod = paymentIntent.metadata?.paymentMethod || paymentMethod || 'stripe';
                console.log('💳 Payment method set to:', finalPaymentMethod);
              }
            } else {
              // Other payment method types
              finalPaymentMethod = paymentIntent.metadata?.paymentMethod || paymentMethod || pm.type;
              console.log('💳 Payment method set to:', finalPaymentMethod);
            }
          } catch (pmErr) {
            console.warn('⚠️ Could not retrieve payment method details:', pmErr.message);
            // Fall back to metadata
            finalPaymentMethod = paymentIntent.metadata?.paymentMethod || paymentMethod || 'stripe';
          }
        } else {
          // No payment_method object, use metadata or provided value
          finalPaymentMethod = paymentIntent.metadata?.paymentMethod || paymentMethod || 'stripe';
        }
      }
  } else if (paymentIntentId) {
    // Legacy flow: retrieve payment intent only
    console.log(`📝 Retrieving PaymentIntent (legacy): ${paymentIntentId}`);
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['payment_method', 'latest_charge'] // Expand latest_charge for Apple Pay detection
    });
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
    
    // Detect payment method type from PaymentIntent's payment_method object and charge details
    // This ensures Apple Pay is properly detected even if metadata is missing
    if (paymentIntent.payment_method) {
      try {
        const pm = typeof paymentIntent.payment_method === 'string' 
          ? await stripe.paymentMethods.retrieve(paymentIntent.payment_method)
          : paymentIntent.payment_method;
        
        // Check if this was Apple Pay by looking at the charge's payment_method_details
        let isApplePay = false;
        if (paymentIntent.latest_charge) {
          try {
            const charge = typeof paymentIntent.latest_charge === 'string'
              ? await stripe.charges.retrieve(paymentIntent.latest_charge)
              : paymentIntent.latest_charge;
            
            if (charge.payment_method_details?.card?.wallet?.type === 'apple_pay') {
              isApplePay = true;
              console.log('🍎 Detected Apple Pay payment from charge details (legacy flow)');
            }
          } catch (chargeErr) {
            console.warn('⚠️ Could not retrieve charge details for Apple Pay detection:', chargeErr.message);
          }
        }
        
        if (pm.type === 'card') {
          // Card payment - check if it was Apple Pay
          if (isApplePay) {
            finalPaymentMethod = 'apple_pay';
            console.log('✅ Payment method set to: apple_pay (legacy flow)');
          } else {
            // Regular card payment - check metadata first
            finalPaymentMethod = paymentIntent.metadata?.paymentMethod || paymentMethod || 'stripe';
            console.log('💳 Payment method set to:', finalPaymentMethod, '(legacy flow)');
          }
        } else {
          finalPaymentMethod = paymentIntent.metadata?.paymentMethod || paymentMethod || pm.type;
          console.log('💳 Payment method set to:', finalPaymentMethod, '(legacy flow)');
        }
      } catch (pmErr) {
        console.warn('⚠️ Could not retrieve payment method details:', pmErr.message);
        finalPaymentMethod = paymentIntent.metadata?.paymentMethod || paymentMethod || 'stripe';
      }
    } else {
      finalPaymentMethod = paymentIntent.metadata?.paymentMethod || paymentMethod || 'stripe';
    }
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
    console.log(`   subscriptionId: ${subscriptionId || 'N/A'}, customerId: ${customerId || 'N/A'}`);
    console.log(`   currentPeriodStart: ${currentPeriodStart || 'N/A'}, currentPeriodEnd: ${currentPeriodEnd || 'N/A'}`);
    
    const checkSubRequest = new mssql.Request(transaction);
    const existingSub = await checkSubRequest
      .input('userId', mssql.Int, userIdInt)
      .query(`SELECT UserId, subscription_id, customer_id FROM [dbo].[user_subscriptions] WHERE UserId = @userId`);

    if (existingSub.recordset.length > 0) {
      console.log(`📝 Step 2a: Updating existing subscription`);
      const existingRecord = existingSub.recordset[0];
      console.log(`   Existing subscription_id: ${existingRecord.subscription_id || 'NULL'}`);
      console.log(`   Existing customer_id: ${existingRecord.customer_id || 'NULL'}`);
      
      // Build UPDATE query with available fields
      const updateFields = [
        '[plan] = @plan',
        'status = @status',
        'updated_at = SYSDATETIMEOFFSET()'
      ];
      
      // Always update subscription_id if provided (even if it's the same)
      if (subscriptionId) {
        updateFields.push('subscription_id = @subscriptionId');
      }
      // Always update customer_id if we have it (either from parameter or retrieved from Stripe)
      if (customerId) {
        updateFields.push('customer_id = @customerId');
        console.log(`   ✅ Will update customer_id to: ${customerId}`);
      } else {
        console.log(`   ⚠️ customerId is null/undefined, skipping customer_id update`);
      }
      // ALWAYS update billing dates if we have them (critical for next billing date display)
      if (currentPeriodStart) {
        updateFields.push('current_period_start = @currentPeriodStart');
        console.log(`   ✅ Will update current_period_start to: ${currentPeriodStart}`);
      } else {
        console.warn(`   ⚠️ currentPeriodStart is missing, skipping update`);
      }
      if (currentPeriodEnd) {
        updateFields.push('current_period_end = @currentPeriodEnd');
        console.log(`   ✅ Will update current_period_end to: ${currentPeriodEnd}`);
      } else {
        console.warn(`   ⚠️ currentPeriodEnd is missing, skipping update`);
      }
      if (paymentIntentId) {
        updateFields.push('payment_intent_id = @paymentIntentId');
      }
      if (billingInterval) {
        updateFields.push('billing_interval = @billingInterval');
        console.log(`   ✅ Will update billing_interval to: ${billingInterval}`);
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
      if (billingInterval) updateRequest.input('billingInterval', mssql.NVarChar(32), billingInterval);
      
      await updateRequest.query(updateQuery);
      console.log(`✅ Step 2a complete: Subscription updated`);
    } else {
      console.log(`📝 Step 2b: Inserting new subscription`);
      const insertFields = ['UserId', '[plan]', 'status', 'started_at', 'updated_at'];
      const insertValues = ['@userId', '@plan', '@status', 'SYSDATETIMEOFFSET()', 'SYSDATETIMEOFFSET()'];
      
      // Always include subscription_id and customer_id if available
      if (subscriptionId) {
        insertFields.push('subscription_id');
        insertValues.push('@subscriptionId');
        console.log(`   ✅ Including subscription_id: ${subscriptionId}`);
      }
      if (customerId) {
        insertFields.push('customer_id');
        insertValues.push('@customerId');
        console.log(`   ✅ Including customer_id: ${customerId}`);
      } else {
        console.log(`   ⚠️ customerId is null/undefined, subscription will be created without customer_id`);
      }
      // ALWAYS include billing dates if available (critical for next billing date display)
      if (currentPeriodStart) {
        insertFields.push('current_period_start');
        insertValues.push('@currentPeriodStart');
        console.log(`   ✅ Including current_period_start: ${currentPeriodStart}`);
      } else {
        console.warn(`   ⚠️ currentPeriodStart is missing, subscription will be created without billing start date`);
      }
      if (currentPeriodEnd) {
        insertFields.push('current_period_end');
        insertValues.push('@currentPeriodEnd');
        console.log(`   ✅ Including current_period_end: ${currentPeriodEnd}`);
      } else {
        console.warn(`   ⚠️ currentPeriodEnd is missing, subscription will be created without billing end date`);
      }
      if (paymentIntentId) {
        insertFields.push('payment_intent_id');
        insertValues.push('@paymentIntentId');
      }
      if (billingInterval) {
        insertFields.push('billing_interval');
        insertValues.push('@billingInterval');
        console.log(`   ✅ Including billing_interval: ${billingInterval}`);
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
      if (billingInterval) insertRequest.input('billingInterval', mssql.NVarChar(32), billingInterval);
      
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
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🚀 updateSubscription endpoint called`);
  console.log(`[${timestamp}] 📥 Request body:`, JSON.stringify(req.body));
  console.log(`[${timestamp}] 👤 User from token:`, req.user?.userId);
  
  try {
    const userId = req.user.userId || req.body.userId;
    
    // Validate userId
    try {
      validateUserId(userId);
    } catch (validationErr) {
      return sendErrorResponse(res, 400, 'Validation Error', validationErr.message);
    }
    
    const { 
      subscriptionStatus = 'active', 
      plan = 'premium', 
      paymentIntentId, 
      paymentMethod = 'stripe',
      subscriptionId,
      customerId,
      currentPeriodStart,
      currentPeriodEnd,
      billingInterval
    } = req.body || {};
    
    console.log(`[${timestamp}] 📋 Parsed: userId=${userId}, plan=${plan}, status=${subscriptionStatus}`);
    console.log(`[${timestamp}]    subscriptionId=${subscriptionId || 'N/A'}, paymentIntentId=${paymentIntentId || 'N/A'}`);
    
    // Require either subscriptionId or paymentIntentId (for backward compatibility)
    if (!subscriptionId && !paymentIntentId) {
      return sendErrorResponse(res, 400, 'Validation Error', 
        'subscriptionId or paymentIntentId is required');
    }
    
    // Validate IDs if provided
    if (subscriptionId) {
      try {
        validateSubscriptionId(subscriptionId);
      } catch (validationErr) {
        return sendErrorResponse(res, 400, 'Validation Error', validationErr.message);
      }
    }
    
    if (paymentIntentId) {
      try {
        validatePaymentIntentId(paymentIntentId);
      } catch (validationErr) {
        return sendErrorResponse(res, 400, 'Validation Error', validationErr.message);
      }
    }
    
    if (customerId) {
      try {
        validateCustomerId(customerId);
      } catch (validationErr) {
        return sendErrorResponse(res, 400, 'Validation Error', validationErr.message);
      }
    }
    
    // Validate dates if provided
    let validatedPeriodStart = null;
    let validatedPeriodEnd = null;
    
    if (currentPeriodStart) {
      try {
        validatedPeriodStart = validateDateString(currentPeriodStart, 'currentPeriodStart');
      } catch (validationErr) {
        return sendErrorResponse(res, 400, 'Validation Error', validationErr.message);
      }
    }
    
    if (currentPeriodEnd) {
      try {
        validatedPeriodEnd = validateDateString(currentPeriodEnd, 'currentPeriodEnd');
      } catch (validationErr) {
        return sendErrorResponse(res, 400, 'Validation Error', validationErr.message);
      }
    }

    // If subscriptionId is provided but dates are missing, refresh from Stripe
    if (subscriptionId && (!validatedPeriodStart || !validatedPeriodEnd)) {
      if (!process.env.STRIPE_SECRET_KEY || !stripe) {
        console.warn('⚠️ Stripe not initialized, cannot refresh subscription from Stripe');
      } else {
        try {
          console.log(`🔄 Refreshing subscription ${subscriptionId} from Stripe to get billing dates...`);
          const refreshedSubscription = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['items.data.price']
          });
          
          if (refreshedSubscription.current_period_start && typeof refreshedSubscription.current_period_start === 'number') {
            const refreshedStart = new Date(refreshedSubscription.current_period_start * 1000).toISOString();
            currentPeriodStart = refreshedStart;
            validatedPeriodStart = refreshedStart;
            console.log(`✅ Retrieved current_period_start from Stripe: ${currentPeriodStart}`);
          }
          
          if (refreshedSubscription.current_period_end && typeof refreshedSubscription.current_period_end === 'number') {
            const refreshedEnd = new Date(refreshedSubscription.current_period_end * 1000).toISOString();
            currentPeriodEnd = refreshedEnd;
            validatedPeriodEnd = refreshedEnd;
            console.log(`✅ Retrieved current_period_end from Stripe: ${currentPeriodEnd}`);
          }
          
          // Also update subscriptionStatus if it changed (e.g., from 'incomplete' to 'active')
          if (refreshedSubscription.status && refreshedSubscription.status !== subscriptionStatus) {
            subscriptionStatus = refreshedSubscription.status;
            console.log(`📝 Updated subscription status to: ${subscriptionStatus}`);
          }
          
          // Update customerId if missing
          if (!customerId && refreshedSubscription.customer) {
            customerId = typeof refreshedSubscription.customer === 'string' 
              ? refreshedSubscription.customer 
              : refreshedSubscription.customer.id;
            console.log(`📝 Retrieved customerId from Stripe: ${customerId}`);
          }
          
          // Extract billingInterval from subscription metadata if not provided
          if (!billingInterval && refreshedSubscription.metadata?.billingInterval) {
            billingInterval = refreshedSubscription.metadata.billingInterval;
            console.log(`📝 Retrieved billingInterval from Stripe subscription metadata: ${billingInterval}`);
          }
        } catch (refreshErr) {
          console.warn('⚠️ Could not refresh subscription from Stripe:', refreshErr.message);
          // Continue with provided dates (or null if not provided)
        }
      }
    }

    console.log(`[${timestamp}] 🔄 Calling updateSubscriptionInDatabase...`);
    console.log(`   Dates: start=${validatedPeriodStart || currentPeriodStart || 'NULL'}, end=${validatedPeriodEnd || currentPeriodEnd || 'NULL'}`);
    console.log(`   billingInterval: ${billingInterval || 'NULL'}`);
    const result = await updateSubscriptionInDatabase(
      userId, 
      subscriptionStatus, 
      plan, 
      paymentIntentId, 
      paymentMethod,
      subscriptionId,
      customerId,
      validatedPeriodStart || currentPeriodStart,
      validatedPeriodEnd || currentPeriodEnd,
      billingInterval
    );
    console.log(`[${timestamp}] ✅ updateSubscriptionInDatabase completed successfully`);
    return res.json(result);
  } catch (err) {
    if (err.code === 'EREQUEST') {
      return sendErrorResponse(res, 500, 'Database Error', 
        err.message, 
        'Check if tables exist and schema is correct');
    }
    
    return sendErrorResponse(res, 500, 'Update Failed', 
      err.message || 'Failed to update subscription', 
      err.stack);
  }
});

// GET /api/data/users/subscription/status
// Get current subscription status for the authenticated user
router.get('/users/subscription/status', authenticateToken, async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📥 Subscription status request received`);
  
  try {
    const userId = req.user.userId;
    
    // Validate userId
    try {
      validateUserId(userId);
    } catch (validationErr) {
      return sendErrorResponse(res, 400, 'Validation Error', validationErr.message);
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
        billing_interval,
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
    let billingInterval = subscription.billing_interval || null; // Initialize from database
    let needsBillingIntervalUpdate = false;
    
    // Always fetch from Stripe for active/trialing subscriptions to ensure we have the latest billing dates
    // This ensures billing dates are always up-to-date, even if database values exist
    const shouldFetchFromStripe = subscription.subscription_id && 
                                   (subscription.status === 'active' || subscription.status === 'trialing');
    
    if (shouldFetchFromStripe) {
      try {
        if (stripe && process.env.STRIPE_SECRET_KEY) {
          console.log(`📝 Fetching subscription details from Stripe: ${subscription.subscription_id} (status: ${subscription.status})`);
          const stripeSubscription = await stripe.subscriptions.retrieve(subscription.subscription_id, {
            expand: ['latest_invoice', 'items.data.price']
          });
          
          // Derive billing_interval from price ID if not in database or if it's incorrect
          
          if (stripeSubscription.items.data.length > 0) {
            const currentPriceId = stripeSubscription.items.data[0].price.id;
            const priceIdMap = {
              [process.env.STRIPE_PRICE_ID_MONTHLY || process.env.STRIPE_PRICE_ID]: 'monthly',
              [process.env.STRIPE_PRICE_ID_SEMI_ANNUAL]: 'semi_annual',
              [process.env.STRIPE_PRICE_ID_ANNUAL]: 'annual'
            };
            
            const derivedBillingInterval = priceIdMap[currentPriceId];
            
            if (derivedBillingInterval) {
              // If database billing_interval doesn't match current price, update it
              if (!billingInterval || billingInterval !== derivedBillingInterval) {
                console.log(`📝 Billing interval mismatch - DB: ${billingInterval || 'NULL'}, Stripe: ${derivedBillingInterval}`);
                billingInterval = derivedBillingInterval;
                needsBillingIntervalUpdate = true;
                
                // Also update Stripe metadata if it's missing or incorrect
                if (!stripeSubscription.metadata?.billingInterval || 
                    stripeSubscription.metadata.billingInterval !== derivedBillingInterval) {
                  try {
                    await stripe.subscriptions.update(stripeSubscription.id, {
                      metadata: {
                        ...stripeSubscription.metadata,
                        billingInterval: derivedBillingInterval
                      }
                    });
                    console.log(`✅ Updated Stripe subscription metadata with billingInterval: ${derivedBillingInterval}`);
                  } catch (metaErr) {
                    console.warn('⚠️ Could not update Stripe metadata:', metaErr.message);
                  }
                }
              }
            }
          }
          
          // First try to get dates from subscription object
          if (stripeSubscription.current_period_end) {
            nextBillingDate = new Date(stripeSubscription.current_period_end * 1000).toISOString();
            currentPeriodStart = stripeSubscription.current_period_start 
              ? new Date(stripeSubscription.current_period_start * 1000).toISOString()
              : null;
            
            console.log(`✅ Retrieved dates from Stripe subscription - period_end: ${nextBillingDate}, period_start: ${currentPeriodStart}`);
          } else {
            // Fallback: Try to get dates from latest invoice if subscription doesn't have them
            console.log(`⚠️ Stripe subscription missing billing dates, checking latest invoice...`);
            
            if (stripeSubscription.latest_invoice) {
              const invoiceId = typeof stripeSubscription.latest_invoice === 'string' 
                ? stripeSubscription.latest_invoice 
                : stripeSubscription.latest_invoice.id;
              
              try {
                const invoice = await stripe.invoices.retrieve(invoiceId);
                
                if (invoice.period_start && invoice.period_end) {
                  let periodStart = invoice.period_start;
                  let periodEnd = invoice.period_end;
                  
                  // If dates are the same (invalid for monthly subscription), calculate proper end date
                  if (periodStart === periodEnd) {
                    console.log(`⚠️ Invoice has same start/end dates, calculating monthly period_end from subscription...`);
                    
                    // Try to get billing interval from subscription items
                    if (stripeSubscription.items && stripeSubscription.items.data && stripeSubscription.items.data.length > 0) {
                      const price = stripeSubscription.items.data[0].price;
                      
                      // If price has interval, use it; otherwise default to 1 month
                      const interval = price?.recurring?.interval || 'month';
                      const intervalCount = price?.recurring?.interval_count || 1;
                      
                      // Calculate period_end based on interval
                      let secondsToAdd = 0;
                      if (interval === 'month') {
                        // Approximate: 30.44 days per month on average
                        secondsToAdd = intervalCount * 30.44 * 24 * 60 * 60;
                      } else if (interval === 'year') {
                        secondsToAdd = intervalCount * 365.25 * 24 * 60 * 60;
                      } else if (interval === 'week') {
                        secondsToAdd = intervalCount * 7 * 24 * 60 * 60;
                      } else if (interval === 'day') {
                        secondsToAdd = intervalCount * 24 * 60 * 60;
                      }
                      
                      periodEnd = periodStart + Math.round(secondsToAdd);
                      console.log(`   Calculated period_end: ${intervalCount} ${interval}(s) from period_start`);
                    } else {
                      // Fallback: add 1 month (30 days)
                      periodEnd = periodStart + (30 * 24 * 60 * 60);
                      console.log(`   Using fallback: 30 days from period_start`);
                    }
                  }
                  
                  currentPeriodStart = new Date(periodStart * 1000).toISOString();
                  nextBillingDate = new Date(periodEnd * 1000).toISOString();
                  
                  console.log(`✅ Retrieved dates from invoice - period_end: ${nextBillingDate}, period_start: ${currentPeriodStart}`);
                }
              } catch (invoiceErr) {
                console.warn(`⚠️ Could not retrieve invoice ${invoiceId}:`, invoiceErr.message);
              }
            }
            
            if (!nextBillingDate) {
              console.warn(`⚠️ Stripe subscription ${subscription.subscription_id} missing current_period_end and invoice dates unavailable`);
            }
          }
          
          // Save dates and billing_interval to database if we found them or if billing_interval needs update
          if (nextBillingDate || needsBillingIntervalUpdate) {
            try {
              const updateRequest = pool.request();
              updateRequest.input('userId', mssql.Int, parseInt(userId, 10));
              
              const updateFields = ['updated_at = SYSDATETIMEOFFSET()'];
              
              if (nextBillingDate) {
                updateRequest.input('periodEnd', mssql.DateTimeOffset, nextBillingDate);
                updateFields.push('current_period_end = @periodEnd');
              }
              
              if (currentPeriodStart) {
                updateRequest.input('periodStart', mssql.DateTimeOffset, currentPeriodStart);
                updateFields.push('current_period_start = @periodStart');
              }
              
              if (needsBillingIntervalUpdate && billingInterval) {
                updateRequest.input('billingInterval', mssql.NVarChar(32), billingInterval);
                updateFields.push('billing_interval = @billingInterval');
                console.log(`✅ Will update billing_interval to: ${billingInterval}`);
              }
              
              await updateRequest.query(`
                UPDATE [dbo].[user_subscriptions]
                SET ${updateFields.join(', ')}
                WHERE UserId = @userId
              `);
              
              if (nextBillingDate) {
                console.log(`✅ Synced subscription dates from Stripe to database`);
              }
              if (needsBillingIntervalUpdate) {
                console.log(`✅ Updated billing_interval in database to: ${billingInterval}`);
              }
            } catch (dbErr) {
              console.warn('⚠️ Could not save subscription data to database (non-critical):', dbErr.message);
              // Continue - data is still available for this response
            }
          }
        }
      } catch (stripeErr) {
        console.warn('⚠️ Could not fetch subscription from Stripe:', stripeErr.message);
        // Continue with database values (which may be null)
      }
    }
    
    // Use database values if Stripe fetch didn't work or wasn't needed
    // Also use database values if they're valid (not NULL and start != end)
    if (!nextBillingDate && subscription.current_period_end) {
      // Handle both DATETIMEOFFSET and string formats
      const periodEnd = subscription.current_period_end instanceof Date 
        ? subscription.current_period_end 
        : new Date(subscription.current_period_end);
      
      // Only use database value if it's valid (not the same as start date)
      const periodStart = subscription.current_period_start instanceof Date 
        ? subscription.current_period_start 
        : subscription.current_period_start 
          ? new Date(subscription.current_period_start)
          : null;
      
      // Check if dates are valid (not the same)
      if (!periodStart || periodEnd.getTime() !== periodStart.getTime()) {
        nextBillingDate = periodEnd.toISOString();
        console.log(`✅ Using database current_period_end: ${nextBillingDate}`);
      } else {
        console.warn(`⚠️ Database has invalid dates (start = end), skipping database value`);
      }
    }
    
    if (!currentPeriodStart && subscription.current_period_start) {
      const periodStart = subscription.current_period_start instanceof Date 
        ? subscription.current_period_start 
        : new Date(subscription.current_period_start);
      currentPeriodStart = periodStart.toISOString();
    }

    return res.json({
      plan: userProfile?.UserType || subscription.plan || 'Free', // Use UserType from UserProfile first, then fallback to subscription.plan
      status: subscription.status || 'inactive',
      currentPeriodEnd: nextBillingDate,
      currentPeriodStart: currentPeriodStart,
      nextBillingDate: nextBillingDate,
      subscriptionId: subscription.subscription_id || null,
      customerId: subscription.customer_id || null,
      billingInterval: billingInterval, // Include billing interval in response
      hasActiveSubscription: subscription.status === 'active' || subscription.status === 'trialing',
      startedAt: subscription.started_at ? (subscription.started_at instanceof Date ? subscription.started_at.toISOString() : new Date(subscription.started_at).toISOString()) : null,
      updatedAt: subscription.updated_at ? (subscription.updated_at instanceof Date ? subscription.updated_at.toISOString() : new Date(subscription.updated_at).toISOString()) : null
    });
  } catch (err) {
    return sendErrorResponse(res, 500, 'Status Retrieval Failed', 
      err.message || 'Failed to get subscription status', 
      err.stack);
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
          let subscription = event.data.object;
          const userId = subscription.metadata?.userId;
          
          if (!userId) {
            console.warn('⚠️ Subscription webhook missing userId in metadata');
            return res.json({ received: true });
          }

          console.log(`🔄 Processing subscription ${event.type} for user ${userId}`);
          
          // Retrieve subscription with expanded items to get price details
          // This ensures updateSubscriptionInDatabase can derive billingInterval from price ID if metadata is missing
          try {
            subscription = await stripe.subscriptions.retrieve(subscription.id, {
              expand: ['items.data.price', 'latest_invoice.payment_intent']
            });
            console.log(`📝 Retrieved subscription with expanded items for billingInterval derivation`);
          } catch (retrieveErr) {
            console.warn('⚠️ Could not retrieve subscription with expanded items:', retrieveErr.message);
            // Continue with event data object - updateSubscriptionInDatabase will try to retrieve it
          }
          
          // Update subscription in database
          // billingInterval will be derived from price ID if not in metadata
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
                      : null,
                    subscription.metadata?.billingInterval || null
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
                      : null,
                    subscription.metadata?.billingInterval || null
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

          // Retrieve subscription to get userId and price details
          const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['items.data.price']
          });
          const userId = subscription.metadata?.userId;
          
          if (!userId) {
            console.warn('⚠️ Invoice payment_succeeded webhook missing userId');
            return res.json({ received: true });
          }

          console.log(`🔄 Processing invoice payment succeeded for user ${userId}, subscription ${subscriptionId}`);
          
          // Update subscription - payment succeeded means subscription should be active
          // billingInterval will be derived from price ID if not in metadata
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
                      : null,
                    subscription.metadata?.billingInterval || null
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

          // Retrieve subscription to get userId and price details
          const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['items.data.price']
          });
          const userId = subscription.metadata?.userId;
          
          if (!userId) {
            console.warn('⚠️ Invoice payment_failed webhook missing userId');
            return res.json({ received: true });
          }

          console.log(`🔄 Processing invoice payment failed for user ${userId}, subscription ${subscriptionId}`);
          
          // Update subscription status - payment failed might set status to past_due
          // billingInterval will be derived from price ID if not in metadata
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
                      : null,
                    subscription.metadata?.billingInterval || null
                  );
          
          console.log(`✅ Invoice payment failed processed successfully`);
        }
        break;

      case 'payment_method.attached':
        {
          const paymentMethod = event.data.object;
          const customerId = paymentMethod.customer;
          
          if (!customerId) {
            console.warn('⚠️ payment_method.attached webhook missing customer ID');
            return res.json({ received: true });
          }

          console.log(`🔄 Processing payment method attached for customer ${customerId}`);
          
          // Get userId from customer metadata or database
          try {
            const customer = await stripe.customers.retrieve(customerId);
            const userId = customer.metadata?.userId;
            
            if (userId) {
              console.log(`✅ Payment method ${paymentMethod.id} attached to customer ${customerId} (user ${userId})`);
              // You can update your database here if needed to track payment methods
            } else {
              console.log(`ℹ️ Payment method attached but no userId in customer metadata`);
            }
          } catch (err) {
            console.warn('⚠️ Could not retrieve customer for payment_method.attached:', err.message);
          }
        }
        break;

      case 'payment_method.detached':
        {
          const paymentMethod = event.data.object;
          const customerId = paymentMethod.customer;
          
          console.log(`🔄 Processing payment method detached: ${paymentMethod.id} from customer ${customerId || 'N/A'}`);
          
          if (customerId) {
            try {
              const customer = await stripe.customers.retrieve(customerId);
              const userId = customer.metadata?.userId;
              
              if (userId) {
                console.log(`✅ Payment method ${paymentMethod.id} detached from customer ${customerId} (user ${userId})`);
                // You can update your database here if needed
              }
            } catch (err) {
              console.warn('⚠️ Could not retrieve customer for payment_method.detached:', err.message);
            }
          }
        }
        break;

      case 'customer.updated':
        {
          const customer = event.data.object;
          const userId = customer.metadata?.userId;
          
          if (!userId) {
            console.log(`ℹ️ customer.updated webhook - no userId in metadata, skipping database update`);
            return res.json({ received: true });
          }

          console.log(`🔄 Processing customer update for user ${userId}`);
          
          // Update customer information in database if needed
          // Note: Only update billing-related info, not authentication credentials
          const pool = getPool();
          if (pool) {
            try {
              // Sync email if it changed
              if (customer.email) {
                const updateRequest = pool.request();
                updateRequest.input('userId', mssql.Int, parseInt(userId, 10));
                updateRequest.input('customerId', mssql.NVarChar(128), customer.id);
                
                // Update customer_id in user_subscriptions if it exists
                await updateRequest.query(`
                  UPDATE [dbo].[user_subscriptions] 
                  SET customer_id = @customerId, updated_at = SYSDATETIMEOFFSET()
                  WHERE UserId = @userId
                `);
                
                console.log(`✅ Updated customer_id for user ${userId} in database`);
              }
            } catch (dbErr) {
              console.warn('⚠️ Could not update customer in database:', dbErr.message);
            }
          }
          
          console.log(`✅ Customer update processed for user ${userId}`);
        }
        break;

      case 'customer.tax_id.created':
        {
          const taxId = event.data.object;
          const customerId = taxId.customer;
          
          console.log(`🔄 Processing tax ID created for customer ${customerId}`);
          
          try {
            const customer = await stripe.customers.retrieve(customerId);
            const userId = customer.metadata?.userId;
            
            if (userId) {
              console.log(`✅ Tax ID ${taxId.id} created for customer ${customerId} (user ${userId})`);
              // You can store tax ID information in your database if needed
            }
          } catch (err) {
            console.warn('⚠️ Could not retrieve customer for tax_id.created:', err.message);
          }
        }
        break;

      case 'customer.tax_id.deleted':
        {
          const taxId = event.data.object;
          const customerId = taxId.customer;
          
          console.log(`🔄 Processing tax ID deleted for customer ${customerId}`);
          
          try {
            const customer = await stripe.customers.retrieve(customerId);
            const userId = customer.metadata?.userId;
            
            if (userId) {
              console.log(`✅ Tax ID ${taxId.id} deleted for customer ${customerId} (user ${userId})`);
              // You can update your database here if needed
            }
          } catch (err) {
            console.warn('⚠️ Could not retrieve customer for tax_id.deleted:', err.message);
          }
        }
        break;

      case 'customer.tax_id.updated':
        {
          const taxId = event.data.object;
          const customerId = taxId.customer;
          
          console.log(`🔄 Processing tax ID updated for customer ${customerId}`);
          
          try {
            const customer = await stripe.customers.retrieve(customerId);
            const userId = customer.metadata?.userId;
            
            if (userId) {
              console.log(`✅ Tax ID ${taxId.id} updated for customer ${customerId} (user ${userId})`);
              // You can update your database here if needed
            }
          } catch (err) {
            console.warn('⚠️ Could not retrieve customer for tax_id.updated:', err.message);
          }
        }
        break;

      case 'billing_portal.configuration.created':
        {
          const configuration = event.data.object;
          console.log(`ℹ️ Customer portal configuration created: ${configuration.id}`);
        }
        break;

      case 'billing_portal.configuration.updated':
        {
          const configuration = event.data.object;
          console.log(`ℹ️ Customer portal configuration updated: ${configuration.id}`);
        }
        break;

      case 'billing_portal.session.created':
        {
          const session = event.data.object;
          console.log(`ℹ️ Customer portal session created: ${session.id} for customer ${session.customer}`);
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