// routes/authRoutes.js
const express = require('express');
const bcrypt = require('bcrypt');
const { getPool } = require('../config/db');
const { generateToken } = require('../utils/token');

const router = express.Router();

const upload = require('../middleware/multerUpload'); // or use app.get() if you're passing from server.js
const { containerClient } = require('../middleware/blobClient'); // or pass via app.set()

// POST new user/ signup
router.post('/signup', upload.single('profileImage'), async (req, res) => {
  const {
    name,
    email,
    password,
    fitnessGoal,
    age,
    weight,
    heightx,
    gender,
    fitnessLevel
  } = req.body;

  const file = req.file;
  let profileImageUrl = null;

  try {
    if (file) {
      const blobName = `profile_${Date.now()}.jpg`;
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: { blobContentType: file.mimetype },
      });
      profileImageUrl = blockBlobClient.url;
    }
    
    const hashedPassword = await bcrypt.hash(password, 12);
    const pool = getPool();
    const currentDate = new Date();

    // Begin transaction
    const transaction = pool.transaction();
    await transaction.begin();

    const userRequest = new (require('mssql').Request)(transaction);
    const userResult = await userRequest
      .input('name', name)
      .input('email', email)
      .input('fitnessGoal', fitnessGoal)
      .input('age', age)
      .input('weight', weight)
      .input('heightx', heightx)
      .input('gender', gender)
      .input('fitnessLevel', fitnessLevel)
      .input('profileImageUrl', profileImageUrl || null)
      .input('createDate', currentDate)
      .query(`
        INSERT INTO dbo.[User] 
        (Name, EmailAddr, FitnessGoal, Age, Weight, Height, Gender, FitnessLevel, CreateDate, ProfileImageUrl)
        OUTPUT INSERTED.UserID
        VALUES (@name, @email, @fitnessGoal, @age, @weight, @heightx, @gender, @fitnessLevel, @createDate, @profileImageUrl)
      `);

    const userId = userResult.recordset[0].UserID;

    const accountRequest = new (require('mssql').Request)(transaction);
    await accountRequest
      .input('userId', userId)
      .input('username', email)
      .input('password', hashedPassword)
      .input('createDate', currentDate)
      .query(`
        INSERT INTO dbo.Account (UserID, UserName, Password, CreateDt)
        VALUES (@userId, @username, @password, @createDate)
      `);

    await transaction.commit();

    const token = generateToken({ userId });

    res.status(200).json({
      message: 'User created successfully!',
      token,
      userId
    });
  } catch (error) {
    console.error('Signup Error:', error);
    res.status(500).json({ message: 'Error signing up user' });
  }
});

// POST existing user/ signin
// SIGNIN
router.post('/signin', async (req, res) => {
  const { email, password } = req.body;

  try {
    const pool = getPool();

    const result = await pool.request()
      .input('email', email)
      .query(`
        SELECT A.UserID, A.UserName, A.Password
        FROM dbo.Account A
        WHERE A.UserName = @email
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = result.recordset[0];
    const isPasswordMatch = await bcrypt.compare(password, user.Password);

    if (!isPasswordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = generateToken({ userId: user.UserID });

    res.status(200).json({
      message: 'Login successful!',
      token,
      user: {
        id: user.UserID,
        email: user.UserName
      }
    });
  } catch (error) {
    console.error('Signin Error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

module.exports = router;
