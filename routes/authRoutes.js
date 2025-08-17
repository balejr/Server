// routes/authRoutes.js
const express = require('express');
const bcrypt = require('bcrypt');
const { getPool } = require('../config/db');
const { generateAccessToken, generateRefreshToken } = require('../utils/token');
const { authenticateRefreshToken } = require('../middleware/authMiddleware');

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

      const accessToken = generateAccessToken({ userId });
      const refreshToken = generateRefreshToken({ userId });

      res.status(200).json({
        message: '用户创建成功！',
        accessToken,
        refreshToken,
        userId
      });
    } catch (error) {
      console.error('Signup Error:', error);
      res.status(500).json({ message: '注册用户时出错' });
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
        WHERE A.Email = @email
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ message: '邮箱或密码无效' });
    }

    const user = result.recordset[0];
    const isPasswordMatch = await bcrypt.compare(password, user.Password);

    if (!isPasswordMatch) {
      return res.status(401).json({ message: '邮箱或密码无效' });
    }

    const accessToken = generateAccessToken({ userId: user.UserID });
    const refreshToken = generateRefreshToken({ userId: user.UserID });

    res.status(200).json({
      message: '登录成功！',
      accessToken,
      refreshToken,
      user: {
        id: user.UserID,
        email: user.Email
      }
    });
  } catch (error) {
    console.error('Signin Error:', error);
    res.status(500).json({ message: '登录过程中服务器出错' });
  }
});

// SIGNIN Testing
router.post('/signin-testing', async (req, res) => {
  const { token } = req.body;

  if (!token) return res.status(401).json({ message: 'Missing Refresh Token' });
  if (!refreshTokens.includes(token)) return res.status(403).json({ message: 'Invalid Token' });
  jwt.verify(token, REFRESH_SECRET, (err, user) => {
    if (err) {
      res.status(403).json({ message: 'Expired or Invalid Token' })
      const newAccessToken = generateAccessToken({ userId: user.userId });
      res.json({ accessToken: newAccessToken });
    }});
});

// POST refresh token
router.post('/refresh', authenticateRefreshToken, async (req, res) => {
  try {
    const { userId } = req.user;
    
    // 生成新的访问令牌
    const newAccessToken = generateAccessToken({ userId });
    
    res.status(200).json({
      message: '令牌刷新成功',
      accessToken: newAccessToken
    });
  } catch (error) {
    console.error('Refresh Token Error:', error);
    res.status(500).json({ message: '刷新令牌时出错' });
  }
});

// POST logout (可选，用于撤销刷新令牌)
router.post('/logout', async (req, res) => {
  try {
    // 在实际应用中，您可能想要将刷新令牌加入黑名单
    // 这里我们只是返回成功消息
    res.status(200).json({
      message: '登出成功'
    });
  } catch (error) {
    console.error('Logout Error:', error);
    res.status(500).json({ message: '登出时出错' });
  }
});

module.exports = router;
