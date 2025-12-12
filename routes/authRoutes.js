// routes/authRoutes.js
const express = require('express');
const bcrypt = require('bcrypt');
const { getPool } = require('../config/db');
const { generateToken } = require('../utils/token');
const { sendPasswordResetEmail } = require('../utils/mailer');
const { authenticateToken } = require('../middleware/authMiddleware');
const { exchangeCodeForToken } = require('../services/ouraService');

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

//------------Update Profile------------------------
router.patch('/update-profile/:userId', upload.single('profileImage'), async (req, res) => {
  const userId = req.params.userId;
  const {
    lastname,
    firstname,
    gender,
    fitnessGoal,
    weight,
    height,
    fitnessLevel,
    age
  } = req.body;

  const file = req.file;
  let profileImageUrl = null;

  try {
    if (file) {
      const blobName = `profile_${userId}_${Date.now()}.jpg`;
      const blockBlobClient = containerClient.getBlockBlobClient(`profile-pictures/${blobName}`);

      await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: { blobContentType: file.mimetype },
      });

      profileImageUrl = blockBlobClient.url;
    }

    const pool = await getPool();
    const request = pool.request();

    request.input('userId', userId);
    request.input('firstname', firstname);
    request.input('lastname', lastname);
    request.input('gender', gender);
    request.input('fitnessGoal', fitnessGoal);
    request.input('weight', weight);
    request.input('height', height);
    request.input('fitnessLevel', fitnessLevel);
    request.input('age', age);
    if (profileImageUrl) {
      request.input('profileImageUrl', profileImageUrl);
    }

    const updateQuery = `
      UPDATE dbo.UserProfile
      SET 
        FirstName = @firstname,
        LastName = @lastname,
        Gender = @gender,
        FitnessGoal = @fitnessGoal,
        Weight = @weight,
        Height = @height,
        FitnessLevel = @fitnessLevel,
        Age = @age
        ${profileImageUrl ? ', ProfileImageUrl = @profileImageUrl' : ''}
      WHERE UserID = @userId
    `;

    await request.query(updateQuery);
    res.status(200).json({ message: 'User profile updated successfully.' });

  } catch (error) {
    console.error('Update Profile Error:', {
      message: error.message,
      stack: error.stack,
      requestBody: req.body, // ✅ this is okay because we are inside the route
      fileInfo: req.file
    });
    res.status(500).json({ message: 'Error updating user profile' });
  }
});



//------------------Update User Info -------------------
// PATCH edit user profile fields
router.patch('/user/profile/:userId', authenticateToken, async (req, res) => {
  const userId = req.params.userId;
  const fields = req.body;

  const allowedFields = [
    'FirstName',
    'LastName',
    'Gender',
    'FitnessGoal',
    'Weight',
    'Height',
    'FitnessLevel',
    'Age',
    'ProfileImageURL'
  ];

  const validKeys = Object.keys(fields).filter(key => allowedFields.includes(key));
  console.log("Allowed updates:", validKeys);

  const pool = getPool();
  const request = pool.request().input('userId', userId);

  const updates = validKeys
    .map((key) => {
      request.input(key, fields[key]);
      return `${key} = @${key}`;
    }).join(', ');

  if (!updates) {
    return res.status(400).json({ message: 'No valid fields to update' });
  }

  try {
    await request.query(`UPDATE dbo.UserProfile SET ${updates} WHERE UserID = @userId`);
    res.status(200).json({ message: 'User profile updated' });
  } catch (err) {
    console.error('Update failed:', err);
    res.status(500).json({ message: 'Failed to update user profile' });
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

// --------------- OURA --------------
router.get("/oura/:userId", (req, res) => {
  const userId = req.params.userId;  // <-- userId comes from the route param

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  const base = "https://cloud.ouraring.com/oauth/authorize";

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.OURA_CLIENT_ID,
    redirect_uri: process.env.OURA_REDIRECT_URI,
    scope: "personal daily heartrate session workout tag email",
    state: userId.toString() // <-- send your user ID
  });

  res.redirect(`${base}?${params.toString()}`);
});

router.get("/oura/callback", async (req, res) => {
  return res.status(400).send("Missing code or token");
  const code = req.query.code;
  const token = req.query.token; // direct token (optional)

  if (!code && !token) {
    return res.status(400).send("Missing code or token");
  }

  try {
    let accessToken;

    if (token) {
      // If a token is sent directly, use it
      accessToken = token;
      console.log("Received token directly:", accessToken);
    } else if (code) {
      // If code is sent, exchange it for a token
      console.log("Received OAuth code:", code);
      const tokenData = await exchangeCodeForToken(code);
      accessToken = tokenData.access_token;
    }

    // Save accessToken to DB (example using userId from state)
    const userId = req.query.state;
    if (!userId) return res.status(400).send("Missing userId (state)");

    const pool = await getPool();
    await pool.request()
      .input("userId", sql.Int, userId)
      .input("accessToken", sql.VarChar, accessToken)
      .query(`
        IF EXISTS (SELECT 1 FROM OuraTokens WHERE userId = @userId)
        BEGIN
          UPDATE OuraTokens
          SET accessToken = @accessToken,
              updatedAt = GETDATE()
          WHERE userId = @userId;
        END
        ELSE
        BEGIN
          INSERT INTO OuraTokens (userId, accessToken, createdAt, updatedAt)
          VALUES (@userId, @accessToken, GETDATE(), GETDATE());
        END
      `);

    res.send("Oura connected successfully! You can close this window.");
  } catch (err) {
    console.error("OAuth Error:", err);
    res.status(500).send("Error processing callback");
  }
});




module.exports = router;
