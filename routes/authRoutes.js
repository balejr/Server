// routes/authRoutes.js
const express = require('express');
const bcrypt = require('bcrypt');
const { getPool } = require('../config/db');
const { generateToken } = require('../utils/token');
const { sendPasswordResetEmail } = require('../utils/mailer');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

const upload = require('../middleware/multerUpload'); // or use app.get() if you're passing from server.js
const { containerClient } = require('../middleware/blobClient'); // or pass via app.set()

// POST new user/ signup
router.post('/signup', upload.single('profileImage'), async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    fitnessGoal,
    age,
    weight,
    height,
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

    const profileRequest = new (require('mssql').Request)(transaction);
    const profileResult = await profileRequest
      .input('firstName', firstName)
      .input('lastName', lastName)
      .input('fitnessGoal', fitnessGoal)
      .input('age', age)
      .input('weight', weight)
      .input('height', height)
      .input('gender', gender)
      .input('fitnessLevel', fitnessLevel)
      .input('profileImageUrl', profileImageUrl || null)
      .input('createDate', currentDate)
      .query(`
        INSERT INTO dbo.UserProfile 
        (FirstName, LastName, FitnessGoal, Age, Weight, Height, Gender, FitnessLevel, CreateDate, ProfileImageUrl)
        OUTPUT INSERTED.UserID
        VALUES (@firstName, @lastName, @fitnessGoal, @age, @weight, @height, @gender, @fitnessLevel, @createDate, @profileImageUrl)
      `);

      const userId = profileResult.recordset[0].UserID;

      const loginRequest = new (require('mssql').Request)(transaction);
      await loginRequest
        .input('userId', userId)
        .input('email', email)
        .input('password', hashedPassword)
        .input('createDate', currentDate)
        .query(`
          INSERT INTO dbo.UserLogin (UserID, Email, Password, CreateDate)
          VALUES (@userId, @email, @password, @createDate)
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

//------------Change Profile Picture ------------------------
router.patch('/user/profile-picture/:userId', authenticateToken, async (req, res) => {
  const { userId } = req.params;
  const { ProfilePicture } = req.body;

  if (!ProfilePicture) {
    return res.status(400).json({ message: 'ProfilePicture is required' });
  }

  try {
    const pool = getPool();
    await pool
      .request()
      .input('userId', userId)
      .input('ProfilePicture', ProfilePicture)
      .query('UPDATE dbo.UserProfile SET ProfileImageURL = @ProfilePicture WHERE UserID = @userId');

    res.status(200).json({ message: 'Profile picture updated successfully' });
  } catch (error) {
    console.error('Error updating profile picture:', error);
    res.status(500).json({ message: 'Failed to update profile picture' });
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
        SELECT A.UserID, A.Email, A.Password
        FROM dbo.UserLogin A
        INNER JOIN (SELECT Email, MAX(UserID) as UserId FROM dbo.UserLogin GROUP BY Email) B
        ON A.UserID = B.UserID
        AND A.Email = B.Email
        WHERE A.Email = @email
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
        email: user.Email
      }
    });
  } catch (error) {
    console.error('Signin Error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// CHECK EMAIL

router.get('/checkemail', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ message: 'Email query parameter is required' });
  }

  try {
    const pool = getPool();

    const result = await pool.request()
      .input('email', email)
      .query('SELECT COUNT(*) AS count FROM dbo.UserLogin WHERE Email = @email');

    const exists = result.recordset[0].count > 0;
    return res.json({ exists });
  } catch (error) {
    console.error('Error checking email:', error);
    res.status(500).json({ message: 'Server error while checking email' });
  }
});

// POST existing user/ forgot-password
// ✅ FORGOT PASSWORD (store code in DB using UserID)
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const pool = getPool();

  try {
    // Get latest UserID for the email
    const userResult = await pool.request()
      .input('email', email)
      .query(`
        SELECT TOP 1 UserID
        FROM dbo.UserLogin
        WHERE Email = @email
        ORDER BY UserID DESC
      `);

    if (userResult.recordset.length === 0) {
      return res.status(200).json({ message: 'If an account exists, a reset code has been sent.' });
    }

    const userId = userResult.recordset[0].UserID;

    // Delete any previous unused code for this user
    await pool.request()
      .input('userId', userId)
      .query(`DELETE FROM dbo.PasswordResets WHERE UserID = @userId AND Used = 0`);

    // Generate 6-digit code and expiration timestamp
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    const lastModified = new Date();

    // Insert into PasswordResets table
    await pool.request()
      .input('userId', userId)
      .input('code', code)
      .input('expiresAt', expiresAt)
      .input('lastModified', lastModified)
      .query(`
        INSERT INTO dbo.PasswordResets (UserID, Code, ExpiresAt, LastModified, Used)
        VALUES (@userId, @code, @expiresAt, @lastModified, 0)
      `);

    await sendPasswordResetEmail(email, code);

    res.status(200).json({ message: 'If an account exists, a reset code has been sent.' });
  } catch (error) {
    console.error('Forgot Password Error:', error);
    res.status(500).json({ message: 'Something went wrong while sending reset code.' });
  }
});

// ✅ RESET PASSWORD (validate code from DB using UserID)
router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  const pool = getPool();

  try {
    // Get latest UserID for the email
    const userResult = await pool.request()
      .input('email', email)
      .query(`
        SELECT TOP 1 UserID
        FROM dbo.UserLogin
        WHERE Email = @email
        ORDER BY UserID DESC
      `);

    if (userResult.recordset.length === 0) {
      return res.status(400).json({ message: 'Invalid reset attempt' });
    }

    const userId = userResult.recordset[0].UserID;

    // Remove expired codes
    await pool.request()
      .query(`DELETE FROM dbo.PasswordResets WHERE ExpiresAt < GETDATE()`);

    // Look up active code
    const result = await pool.request()
      .input('userId', userId)
      .input('code', code)
      .query(`
        SELECT *
        FROM dbo.PasswordResets
        WHERE UserID = @userId AND Code = @code AND Used = 0
      `);

    if (result.recordset.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired reset code' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await pool.request()
      .input('email', email)
      .input('password', hashedPassword)
      .query(`
        UPDATE dbo.UserLogin
        SET Password = @password
        WHERE UserID = (
          SELECT MAX(UserID)
          FROM dbo.UserLogin
          WHERE Email = @email
        )
      `);

    // ✅ Mark code as used instead of deleting it
    await pool.request()
      .input('userId', userId)
      .input('code', code)
      .query(`
        UPDATE dbo.PasswordResets
        SET Used = 1
        WHERE UserID = @userId AND Code = @code
      `);

    res.status(200).json({ message: 'Password reset successful!' });
  } catch (error) {
    console.error('Reset Password Error:', error);
    res.status(500).json({ message: 'Something went wrong while resetting password.' });
  }
});

module.exports = router;
