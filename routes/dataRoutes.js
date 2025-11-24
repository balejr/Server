// cd /home/site// routes/dataRoutes.js
const express = require('express');
const axios = require('axios');
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

//-------------- DEVICE DATA --------------------

// GET /api/deviceData/lastSync
router.get('/deviceData/lastSync', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const {
    deviceType
  } = req.query;
  try {
    const pool = getPool();
    const result = await pool.request()
      .input('userId', userId)
      .input('deviceType', deviceType)
      .query(`
            SELECT TOP 1 CollectedDate
            FROM DeviceDataTemp
            WHERE UserID = @UserId
              AND DeviceType = @deviceType
            ORDER BY CollectedDate DESC;
      `);
    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('Error fetching last time device was synced:', err);
    res.status(500).json({ message: 'Failed to fetch last time device data was synced' });
  }
});

//  PATCH  /api/deviceData/sync
router.patch('/deviceData/sync', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { 
    deviceType,
    deviceData
  } = req.body;

  if (!Array.isArray(deviceData) || deviceData.length === 0) {
    return res.status(400).json({ message: 'No device data provided' });
  }

  const pool = getPool();

  try {
    for (const item of deviceData) {
      const {
        stepCount,
        calories,
        sleepRating,
        collectedDate
      } = item;

      await pool.request()
        .input('userId', userId)
        .input('deviceType', deviceType)
        .input('stepCount', stepCount)
        .input('calories', calories)
        .input('sleepRating', sleepRating)
        .input('collectedDate', collectedDate)
        .query(`
          MERGE DeviceDataTemp AS target
          USING (SELECT 
                  @userId AS UserID, 
                  @deviceType AS DeviceType, 
                  @collectedDate AS CollectedDate
                ) AS source
          ON target.UserID = source.UserID
             AND target.DeviceType = source.DeviceType
             AND target.CollectedDate = source.CollectedDate

          WHEN MATCHED THEN
            UPDATE SET 
              StepCount = @stepCount,
              Calories = @calories,
              SleepRating = @sleepRating

          WHEN NOT MATCHED THEN
            INSERT (DeviceType, StepCount, Calories, SleepRating, CollectedDate, UserID)
            VALUES (@deviceType, @stepCount, @calories, @sleepRating, @collectedDate, @userId);
        `);
    }

    return res.status(200).json({ message: 'Device data synced successfully' });

  } catch (err) {
    console.error('DeviceData UPSERT Error:', err);
    return res.status(500).json({
      message: 'Failed to sync device data',
      error: err.message
    });
  }
});

// -------------------- ACHIEVEMENTS --------------------

// Helper function to calculate FitPoints tier
function calculateFPTier(fitPoints) {
  if (fitPoints >= 2000) return 'Exclusive';
  if (fitPoints >= 1000) return 'Gold';
  if (fitPoints >= 500) return 'Silver';
  if (fitPoints >= 100) return 'Bronze';
  return 'Stone';
}

// Helper function to calculate Experience Points tier
function calculateXPTier(experiencePoints) {
  if (experiencePoints >= 5001) return 'Champion';
  if (experiencePoints >= 3001) return 'Elite';
  if (experiencePoints >= 1501) return 'Advanced';
  if (experiencePoints >= 501) return 'Intermediate';
  return 'Beginner';
}

// Helper function to update user points and tiers
async function updateUserPoints(pool, userId, fitPointsDelta = 0, experiencePointsDelta = 0) {
  // Get current user points
  const pointsResult = await pool.request()
    .input('userId', userId)
    .query(`
      SELECT FitPoints, ExperiencePoints, FitPointsTier
      FROM dbo.UserPoints
      WHERE UserID = @userId
    `);

  let currentFP = 0;
  let currentXP = 0;
  let currentFPTier = 'Stone';
  let canEarnXP = false;

  if (pointsResult.recordset.length > 0) {
    currentFP = pointsResult.recordset[0].FitPoints || 0;
    currentXP = pointsResult.recordset[0].ExperiencePoints || 0;
    currentFPTier = pointsResult.recordset[0].FitPointsTier || 'Stone';
    canEarnXP = currentFP >= 1000; // Gold tier or higher
  }

  // Calculate new totals
  const newFP = currentFP + fitPointsDelta;
  const newXP = canEarnXP ? (currentXP + experiencePointsDelta) : currentXP; // Only award XP if Gold+ FP tier

  // Calculate new tiers
  const newFPTier = calculateFPTier(newFP);
  const newXPTier = canEarnXP && newXP > 0 ? calculateXPTier(newXP) : null;

  // Upsert user points
  await pool.request()
    .input('userId', userId)
    .input('fitPoints', newFP)
    .input('experiencePoints', newXP)
    .input('fitPointsTier', newFPTier)
    .input('experiencePointsTier', newXPTier)
    .query(`
      MERGE dbo.UserPoints AS target
      USING (SELECT @userId AS UserID) AS source
      ON target.UserID = source.UserID
      WHEN MATCHED THEN
        UPDATE SET
          FitPoints = @fitPoints,
          ExperiencePoints = @experiencePoints,
          FitPointsTier = @fitPointsTier,
          ExperiencePointsTier = @experiencePointsTier,
          LastModified = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (UserID, FitPoints, ExperiencePoints, FitPointsTier, ExperiencePointsTier)
        VALUES (@userId, @fitPoints, @experiencePoints, @fitPointsTier, @experiencePointsTier);
    `);

  return {
    fitPoints: newFP,
    experiencePoints: newXP,
    fitPointsTier: newFPTier,
    experiencePointsTier: newXPTier,
    canEarnXP: newFP >= 1000
  };
}

// GET progress achievements
router.get('/achievements/progress', authenticateToken, async (req, res) => {
  const period = req.query.period || 'Daily';
  const userId = req.user.userId;

  try {
    const pool = getPool();
    
    // Get user's current FP tier to determine if XP achievements should be shown
    const userPointsResult = await pool.request()
      .input('userId', userId)
      .query(`
        SELECT FitPoints, FitPointsTier
        FROM dbo.UserPoints
        WHERE UserID = @userId
      `);

    const canEarnXP = userPointsResult.recordset.length > 0 && 
                      (userPointsResult.recordset[0].FitPoints || 0) >= 1000;

    // Get all active achievements for the specified category
    // Filter XP achievements if user hasn't reached Gold FP tier
    let query = `
      SELECT 
        a.AchievementID AS id,
        a.Title AS title,
        ISNULL(ua.CurrentValue, 0) AS progress,
        a.GoalValue AS goal,
        a.Icon AS icon,
        ISNULL(ua.IsCompleted, 0) AS completed,
        a.RewardType AS rewardType,
        a.RewardAmount AS rewardAmount
      FROM dbo.Achievements a
      LEFT JOIN dbo.UserAchievements ua 
        ON a.AchievementID = ua.AchievementID 
        AND ua.UserID = @userId
      WHERE a.Category = @category 
        AND a.IsActive = 1
        AND a.Type = 'progress'
    `;

    const request = pool.request()
      .input('userId', userId)
      .input('category', period);

    // Only show XP achievements if user has Gold+ FP tier
    if (!canEarnXP) {
      query += ` AND a.RewardType = 'FP'`;
    }

    query += ` ORDER BY a.AchievementID`;

    const result = await request.query(query);

    // Transform to match expected format
    const achievements = result.recordset.map(achievement => ({
      id: achievement.id,
      title: achievement.title,
      progress: achievement.progress,
      goal: achievement.goal,
      icon: achievement.icon,
      completed: achievement.completed === 1,
      rewardType: achievement.rewardType,
      rewardAmount: achievement.rewardAmount
    }));

    res.status(200).json({
      userId,
      period,
      achievements
    });
  } catch (err) {
    console.error('Error fetching progress achievements:', err);
    res.status(500).json({ message: 'Failed to fetch progress achievements', error: err.message });
  }
});

// GET completed achievements
router.get('/achievements/completed', authenticateToken, async (req, res) => {
  const search = req.query.search || '';
  const userId = req.user.userId;

  try {
    const pool = getPool();
    
    let query = `
      SELECT 
        a.AchievementID AS id,
        a.Title AS title,
        ua.CompletedDate AS date,
        a.Icon AS icon,
        a.RewardType AS rewardType,
        a.RewardAmount AS rewardAmount
      FROM dbo.Achievements a
      INNER JOIN dbo.UserAchievements ua 
        ON a.AchievementID = ua.AchievementID
      WHERE ua.UserID = @userId
        AND ua.IsCompleted = 1
        AND a.IsActive = 1
    `;

    const request = pool.request().input('userId', userId);

    // Add search filter if provided
    if (search) {
      query += ` AND a.Title LIKE @search`;
      request.input('search', `%${search}%`);
    }

    query += ` ORDER BY ua.CompletedDate DESC`;

    const result = await request.query(query);

    // Transform to match expected format
    const completed = result.recordset.map(achievement => ({
      id: achievement.id,
      title: achievement.title,
      date: achievement.date,
      icon: achievement.icon,
      rewardType: achievement.rewardType,
      rewardAmount: achievement.rewardAmount
    }));

    res.status(200).json({
      userId,
      search,
      completed
    });
  } catch (err) {
    console.error('Error fetching completed achievements:', err);
    res.status(500).json({ message: 'Failed to fetch completed achievements', error: err.message });
  }
});

// DELETE progress achievement (removes user's progress tracking)
router.delete('/achievements/progress/:id', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const achievementId = req.params.id;
  const period = req.query.period || 'Daily';

  try {
    const pool = getPool();

    // Verify the achievement exists and belongs to the category
    const checkResult = await pool.request()
      .input('achievementId', achievementId)
      .input('category', period)
      .query(`
        SELECT AchievementID 
        FROM dbo.Achievements 
        WHERE AchievementID = @achievementId 
          AND Category = @category
          AND IsActive = 1
      `);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Achievement not found or invalid category' 
      });
    }

    // Delete user's progress for this achievement
    const deleteResult = await pool.request()
      .input('userId', userId)
      .input('achievementId', achievementId)
      .query(`
        DELETE FROM dbo.UserAchievements
        WHERE UserID = @userId 
          AND AchievementID = @achievementId
      `);

    res.status(200).json({ 
      success: true,
      message: 'Achievement progress deleted successfully' 
    });
  } catch (err) {
    console.error('Error deleting achievement progress:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to delete achievement progress', 
      error: err.message 
    });
  }
});

// POST create or update user achievement progress
router.post('/achievements/progress', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { achievementId, currentValue } = req.body;

  if (!achievementId || currentValue === undefined) {
    return res.status(400).json({ 
      success: false,
      message: 'achievementId and currentValue are required' 
    });
  }

  try {
    const pool = getPool();

    // Get achievement details including reward information
    const achievementResult = await pool.request()
      .input('achievementId', achievementId)
      .query(`
        SELECT GoalValue, RewardType, RewardAmount
        FROM dbo.Achievements 
        WHERE AchievementID = @achievementId 
          AND IsActive = 1
      `);

    if (achievementResult.recordset.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Achievement not found' 
      });
    }

    const achievement = achievementResult.recordset[0];
    const goalValue = achievement.GoalValue;
    const rewardType = achievement.RewardType;
    const rewardAmount = achievement.RewardAmount;
    const isCompleted = currentValue >= goalValue;

    // Check if this achievement was already completed and points were awarded
    const existingResult = await pool.request()
      .input('userId', userId)
      .input('achievementId', achievementId)
      .query(`
        SELECT IsCompleted, PointsAwarded
        FROM dbo.UserAchievements
        WHERE UserID = @userId AND AchievementID = @achievementId
      `);

    const wasAlreadyCompleted = existingResult.recordset.length > 0 && 
                                 existingResult.recordset[0].IsCompleted === 1;
    const pointsAlreadyAwarded = existingResult.recordset.length > 0 && 
                                  existingResult.recordset[0].PointsAwarded === 1;

    // Award points only if newly completed and points haven't been awarded
    let pointsAwarded = false;
    let newUserPoints = null;

    if (isCompleted && !pointsAlreadyAwarded) {
      const fitPointsDelta = rewardType === 'FP' ? rewardAmount : 0;
      const experiencePointsDelta = rewardType === 'XP' ? rewardAmount : 0;
      
      newUserPoints = await updateUserPoints(pool, userId, fitPointsDelta, experiencePointsDelta);
      pointsAwarded = true;
    }

    // Upsert user achievement
    await pool.request()
      .input('userId', userId)
      .input('achievementId', achievementId)
      .input('currentValue', currentValue)
      .input('isCompleted', isCompleted ? 1 : 0)
      .input('pointsAwarded', pointsAwarded ? 1 : (pointsAlreadyAwarded ? 1 : 0))
      .input('completedDate', isCompleted ? new Date() : null)
      .query(`
        MERGE dbo.UserAchievements AS target
        USING (SELECT @userId AS UserID, @achievementId AS AchievementID) AS source
        ON target.UserID = source.UserID AND target.AchievementID = source.AchievementID
        WHEN MATCHED THEN
          UPDATE SET 
            CurrentValue = @currentValue,
            IsCompleted = @isCompleted,
            PointsAwarded = CASE WHEN @pointsAwarded = 1 THEN 1 ELSE PointsAwarded END,
            CompletedDate = CASE WHEN @isCompleted = 1 AND CompletedDate IS NULL 
                              THEN GETDATE() 
                              ELSE CompletedDate END,
            LastModified = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (UserID, AchievementID, CurrentValue, IsCompleted, CompletedDate, PointsAwarded)
          VALUES (@userId, @achievementId, @currentValue, @isCompleted, 
                  CASE WHEN @isCompleted = 1 THEN GETDATE() ELSE NULL END,
                  CASE WHEN @pointsAwarded = 1 THEN 1 ELSE 0 END);
      `);

    res.status(200).json({ 
      success: true,
      message: 'Achievement progress updated successfully',
      completed: isCompleted,
      pointsAwarded: pointsAwarded,
      rewardType: pointsAwarded ? rewardType : null,
      rewardAmount: pointsAwarded ? rewardAmount : null,
      userPoints: newUserPoints
    });
  } catch (err) {
    console.error('Error updating achievement progress:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to update achievement progress', 
      error: err.message 
    });
  }
});

// GET user points and tiers
router.get('/achievements/points', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();

    const result = await pool.request()
      .input('userId', userId)
      .query(`
        SELECT 
          FitPoints,
          ExperiencePoints,
          FitPointsTier,
          ExperiencePointsTier
        FROM dbo.UserPoints
        WHERE UserID = @userId
      `);

    if (result.recordset.length === 0) {
      // Initialize user points if they don't exist
      await updateUserPoints(pool, userId, 0, 0);
      return res.status(200).json({
        fitPoints: 0,
        experiencePoints: 0,
        fitPointsTier: 'Stone',
        experiencePointsTier: null,
        canEarnXP: false
      });
    }

    const userPoints = result.recordset[0];
    const canEarnXP = (userPoints.FitPoints || 0) >= 1000;

    res.status(200).json({
      fitPoints: userPoints.FitPoints || 0,
      experiencePoints: userPoints.ExperiencePoints || 0,
      fitPointsTier: userPoints.FitPointsTier || 'Stone',
      experiencePointsTier: userPoints.ExperiencePointsTier || null,
      canEarnXP: canEarnXP
    });
  } catch (err) {
    console.error('Error fetching user points:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch user points', 
      error: err.message 
    });
  }
});

// GET all achievements (for admin or user to see available achievements)
router.get('/achievements/all', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const category = req.query.category; // Optional filter by category

  try {
    const pool = getPool();

    // Get user's current FP tier to determine if XP achievements should be shown
    const userPointsResult = await pool.request()
      .input('userId', userId)
      .query(`
        SELECT FitPoints
        FROM dbo.UserPoints
        WHERE UserID = @userId
      `);

    const canEarnXP = userPointsResult.recordset.length > 0 && 
                      (userPointsResult.recordset[0].FitPoints || 0) >= 1000;

    let query = `
      SELECT 
        a.AchievementID AS id,
        a.Title AS title,
        a.Description AS description,
        a.Category AS category,
        a.Type AS type,
        a.GoalValue AS goalValue,
        a.RewardType AS rewardType,
        a.RewardAmount AS rewardAmount,
        a.Icon AS icon,
        ISNULL(ua.IsCompleted, 0) AS completed,
        ISNULL(ua.CurrentValue, 0) AS currentValue
      FROM dbo.Achievements a
      LEFT JOIN dbo.UserAchievements ua 
        ON a.AchievementID = ua.AchievementID 
        AND ua.UserID = @userId
      WHERE a.IsActive = 1
    `;

    const request = pool.request().input('userId', userId);

    // Filter by category if provided
    if (category) {
      query += ` AND a.Category = @category`;
      request.input('category', category);
    }

    // Only show XP achievements if user has Gold+ FP tier
    if (!canEarnXP) {
      query += ` AND a.RewardType = 'FP'`;
    }

    query += ` ORDER BY a.Category, a.AchievementID`;

    const result = await request.query(query);

    const achievements = result.recordset.map(achievement => ({
      id: achievement.id,
      title: achievement.title,
      description: achievement.description,
      category: achievement.category,
      type: achievement.type,
      goalValue: achievement.goalValue,
      rewardType: achievement.rewardType,
      rewardAmount: achievement.rewardAmount,
      icon: achievement.icon,
      completed: achievement.completed === 1,
      currentValue: achievement.currentValue
    }));

    res.status(200).json({
      userId,
      achievements,
      canEarnXP
    });
  } catch (err) {
    console.error('Error fetching all achievements:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch achievements', 
      error: err.message 
    });
  }
});


module.exports = router;