// routes/authRoutes.js
const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { getPool } = require("../config/db");
const {
  generateToken,
  generateTokenPair,
  generateRefreshToken,
  verifyToken,
  getRefreshTokenExpiry,
} = require("../utils/token");
const { sendPasswordResetEmail } = require("../utils/mailer");
const {
  authenticateToken,
  authenticateRefreshToken,
  checkAuthRateLimit,
  resetAuthRateLimit,
} = require("../middleware/authMiddleware");
const {
  requireMFA,
  getUserMFAStatus,
  recordMFAVerification,
} = require("../middleware/mfaMiddleware");
const {
  sendPhoneOTP,
  verifyPhoneOTP,
  sendEmailOTP,
  verifyEmailOTP,
  isValidE164,
  checkRateLimit,
  recordOTPAttempt,
  updateOTPStatus,
} = require("../utils/twilioService");
const logger = require("../utils/logger");

const router = express.Router();

const upload = require("../middleware/multerUpload");
const { containerClient } = require("../middleware/blobClient");
const { exchangeCodeForToken } = require('../services/ouraService');
const { generateCodeVerifier } = require('../services/garminService');

/**
 * @swagger
 * /auth/signup:
 *   post:
 *     summary: Create a new user account
 *     description: Register a new user with email, password, phone number, and profile information. Supports optional profile image upload.
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/SignupRequest'
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SignupRequest'
 *     responses:
 *       200:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenPair'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Email or phone number already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/signup", upload.single("profileImage"), async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    phoneNumber,
    fitnessGoal,
    age,
    weight,
    height,
    gender,
    fitnessLevel,
    preferredLoginMethod = "email",
  } = req.body;

  const file = req.file;
  let profileImageUrl = null;

  try {
    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Strong password validation matching frontend requirements
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    const hasUpperCase = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSymbol = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (!hasUpperCase || !hasNumber || !hasSymbol) {
      return res.status(400).json({
        success: false,
        message:
          "Password must contain at least 1 uppercase letter, 1 number, and 1 symbol",
      });
    }

    // Phone number is required
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    // Validate phone number format
    if (!isValidE164(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid phone number format. Use E.164 format (e.g., +12345678900)",
      });
    }

    // Validate preferred login method
    const validMethods = ["email", "phone", "biometric"];
    if (!validMethods.includes(preferredLoginMethod)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid preferred login method. Must be email, phone, or biometric",
      });
    }

    // Normalize email to prevent case-sensitive duplicates
    const normalizedEmail = email.toLowerCase().trim();

    if (file && containerClient) {
      const blobName = `profile_${Date.now()}.jpg`;
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: { blobContentType: file.mimetype },
      });
      profileImageUrl = blockBlobClient.url;
    } else if (file && !containerClient) {
      logger.warn("Profile image upload skipped - Azure Blob Storage not configured");
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const pool = getPool();
    const currentDate = new Date();

    // Check if phone was verified during signup flow
    // This is more secure than trusting a frontend flag
    let phoneVerified = false;
    if (phoneNumber) {
      // Extended to 30 minutes to give users more time to complete signup
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const otpCheck = await pool
        .request()
        .input("phoneNumber", phoneNumber)
        .input("thirtyMinutesAgo", thirtyMinutesAgo).query(`
          SELECT TOP 1 Status
          FROM dbo.OTPVerifications
          WHERE PhoneOrEmail = @phoneNumber
            AND Purpose IN ('signup', 'phone_verify', 'verification')
            AND Status = 'approved'
            AND CreatedAt > @thirtyMinutesAgo
          ORDER BY CreatedAt DESC
        `);

      phoneVerified = otpCheck.recordset.length > 0;

      logger.debug("Phone verification check during signup:", {
        phoneNumber: phoneNumber.slice(-4),
        foundApprovedOTP: phoneVerified,
        recordCount: otpCheck.recordset.length,
      });
    }

    // Check if email was verified during signup flow (optional enhancement)
    // Allows users to verify their email via OTP before completing signup
    let emailVerified = false;
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const emailOtpCheck = await pool
      .request()
      .input("email", normalizedEmail)
      .input("thirtyMinutesAgo", thirtyMinutesAgo).query(`
        SELECT TOP 1 Status
        FROM dbo.OTPVerifications
        WHERE PhoneOrEmail = @email
          AND Purpose IN ('signup', 'verification')
          AND Status = 'approved'
          AND CreatedAt > @thirtyMinutesAgo
        ORDER BY CreatedAt DESC
      `);

    emailVerified = emailOtpCheck.recordset.length > 0;

    logger.debug("Email verification check during signup:", {
      email: normalizedEmail.substring(0, 3) + "***",
      foundApprovedOTP: emailVerified,
      recordCount: emailOtpCheck.recordset.length,
    });

    // Begin transaction BEFORE duplicate checks to prevent race conditions
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Check if email already exists (inside transaction to prevent race condition)
      const emailCheckRequest = new (require("mssql").Request)(transaction);
      const existingUser = await emailCheckRequest
        .input("email", normalizedEmail)
        .query(
          "SELECT COUNT(*) as count FROM dbo.UserLogin WHERE LOWER(Email) = @email"
        );

      if (existingUser.recordset[0].count > 0) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: "Email already registered",
        });
      }

      // Check if phone number already exists (inside transaction to prevent race condition)
      if (phoneNumber) {
        const phoneCheckRequest = new (require("mssql").Request)(transaction);
        const existingPhone = await phoneCheckRequest.input(
          "phoneNumber",
          phoneNumber
        ).query(`
            SELECT COUNT(*) as count 
            FROM dbo.UserProfile 
            WHERE PhoneNumber = @phoneNumber AND PhoneVerified = 1
          `);

        if (existingPhone.recordset[0].count > 0) {
          await transaction.rollback();
          return res.status(409).json({
            success: false,
            message: "Phone number already registered",
          });
        }
      }

      const profileRequest = new (require("mssql").Request)(transaction);
      const profileResult = await profileRequest
        .input("firstName", firstName)
        .input("lastName", lastName)
        .input("fitnessGoal", fitnessGoal)
        .input("age", age)
        .input("weight", weight)
        .input("height", height)
        .input("gender", gender)
        .input("fitnessLevel", fitnessLevel)
        .input("profileImageUrl", profileImageUrl || null)
        .input("createDate", currentDate)
        .input("phoneNumber", phoneNumber || null)
        .input("phoneVerified", phoneVerified ? 1 : 0).query(`
          INSERT INTO dbo.UserProfile 
          (FirstName, LastName, FitnessGoal, Age, Weight, Height, Gender, FitnessLevel, CreateDate, ProfileImageUrl, PhoneNumber, PhoneVerified)
          OUTPUT INSERTED.UserID
          VALUES (@firstName, @lastName, @fitnessGoal, @age, @weight, @height, @gender, @fitnessLevel, @createDate, @profileImageUrl, @phoneNumber, @phoneVerified)
        `);

      const userId = profileResult.recordset[0].UserID;

      const loginRequest = new (require("mssql").Request)(transaction);
      await loginRequest
        .input("userId", userId)
        .input("email", normalizedEmail)
        .input("password", hashedPassword)
        .input("createDate", currentDate)
        .input("preferredLoginMethod", preferredLoginMethod)
        .input("mfaEnabled", 0)
        .input("biometricEnabled", 0).query(`
          INSERT INTO dbo.UserLogin (UserID, Email, Password, CreateDate, PreferredLoginMethod, MFAEnabled, BiometricEnabled)
          VALUES (@userId, @email, @password, @createDate, @preferredLoginMethod, @mfaEnabled, @biometricEnabled)
        `);

      // Generate token pair
      const tokens = generateTokenPair({ userId });

      // Store refresh token in database (inside transaction for atomicity)
      // Also clear TokenInvalidatedAt so new tokens work after any previous logout
      const refreshTokenExpiry = getRefreshTokenExpiry();
      const refreshTokenRequest = new (require("mssql").Request)(transaction);
      await refreshTokenRequest
        .input("userId", userId)
        .input("refreshToken", tokens.refreshToken)
        .input("refreshTokenExpires", refreshTokenExpiry).query(`
          UPDATE dbo.UserLogin 
          SET RefreshToken = @refreshToken, 
              RefreshTokenExpires = @refreshTokenExpires,
              TokenInvalidatedAt = NULL
          WHERE UserID = @userId
        `);

      await transaction.commit();

      return res.status(200).json({
        success: true,
        message: "User created successfully!",
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        userId,
        user: {
          id: userId,
          email: normalizedEmail,
          phoneNumber,
          phoneVerified,
          preferredLoginMethod,
        },
      });
    } catch (txError) {
      // Rollback transaction on any error
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        logger.error("Rollback error", { error: rollbackError.message });
      }
      throw txError; // Re-throw to be caught by outer catch
    }
  } catch (error) {
    logger.error("Signup Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error signing up user",
    });
  }
});

/**
 * @swagger
 * /auth/signin:
 *   post:
 *     summary: Sign in with email and password
 *     description: Authenticate user with email and password. Returns tokens directly or MFA challenge if MFA is enabled.
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SigninRequest'
 *     responses:
 *       200:
 *         description: Login successful or MFA required
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/TokenPair'
 *                 - $ref: '#/components/schemas/MFAChallenge'
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many login attempts
 */
router.post("/signin", checkAuthRateLimit, async (req, res) => {
  const { email, password } = req.body;

  // Validate required fields
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required",
    });
  }

  // Normalize email to lowercase for case-insensitive matching
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const pool = getPool();

    // Query uses case-insensitive matching via LOWER() and groups duplicates by normalized email
    const result = await pool.request().input("email", normalizedEmail).query(`
        SELECT 
          A.UserID, A.Email, A.Password, A.MFAEnabled, A.MFAMethod, 
          A.PreferredLoginMethod, A.BiometricEnabled,
          P.PhoneNumber, P.PhoneVerified
        FROM dbo.UserLogin A
        INNER JOIN dbo.UserProfile P ON A.UserID = P.UserID
        INNER JOIN (
          SELECT LOWER(Email) as NormalizedEmail, MAX(UserID) as MaxUserID 
          FROM dbo.UserLogin 
          GROUP BY LOWER(Email)
        ) B ON A.UserID = B.MaxUserID
        WHERE LOWER(A.Email) = @email
      `);

    // Debug: Check for duplicate accounts (case-insensitive)
    const allAccounts = await pool.request().input("email", normalizedEmail)
      .query(`
        SELECT UserID, Email, Password FROM dbo.UserLogin WHERE LOWER(Email) = @email ORDER BY UserID
      `);
    logger.debug("Signin attempt for email:", normalizedEmail);
    logger.debug(
      "Total accounts found with this email:",
      allAccounts.recordset.length
    );
    if (allAccounts.recordset.length > 1) {
      logger.debug(
        "WARNING: Multiple accounts detected for email:",
        normalizedEmail
      );
      logger.debug(
        "Account UserIDs:",
        allAccounts.recordset.map((a) => a.UserID)
      );
    }

    if (result.recordset.length === 0) {
      logger.debug(
        "No account found matching email (after MAX filter):",
        normalizedEmail
      );
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const user = result.recordset[0];
    logger.debug(
      "Found user for signin - UserID:",
      user.UserID,
      "Has password:",
      !!user.Password
    );

    const isPasswordMatch = await bcrypt.compare(password, user.Password);
    logger.debug("Password match result:", isPasswordMatch);

    if (!isPasswordMatch) {
      logger.debug("Password mismatch for UserID:", user.UserID);
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Reset rate limit on successful login
    resetAuthRateLimit(req);

    // Check if MFA is enabled
    if (user.MFAEnabled) {
      // Generate a temporary session token for MFA flow
      const mfaSessionToken = crypto.randomBytes(32).toString("hex");
      const mfaSessionExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store MFA session token in UserLogin table for validation
      await pool
        .request()
        .input("userId", user.UserID)
        .input("mfaSessionToken", mfaSessionToken)
        .input("mfaSessionExpires", mfaSessionExpires).query(`
          UPDATE dbo.UserLogin 
          SET MFASessionToken = @mfaSessionToken, MFASessionExpires = @mfaSessionExpires
          WHERE UserID = @userId
        `);

      // NOTE: We do NOT auto-send MFA code here anymore!
      // The frontend will call /auth/send-mfa-code after user selects their preferred method.
      // This gives users the choice between SMS and Email before any code is sent.

      // Helper function to mask phone number for display
      const maskPhone = (phone) => {
        if (!phone || phone.length < 10) return null;
        // Show country code and last 4 digits: +1 ***-***-7890
        const lastFour = phone.slice(-4);
        const countryCode = phone.slice(0, phone.length - 10);
        return countryCode + " ***-***-" + lastFour;
      };

      // Helper function to mask email for display
      const maskEmail = (email) => {
        if (!email) return null;
        const [localPart, domain] = email.split("@");
        if (!domain) return email;
        const maskedLocal =
          localPart.charAt(0) +
          "***" +
          (localPart.length > 1 ? localPart.charAt(localPart.length - 1) : "");
        return maskedLocal + "@" + domain;
      };

      return res.status(200).json({
        success: true,
        message:
          "MFA required. Please select your preferred verification method.",
        mfaRequired: true,
        mfaMethod: user.MFAMethod, // User's default preference (can be overridden by frontend)
        mfaSessionToken,
        userId: user.UserID,
        // Include contact info so frontend can show method selector with both options
        phoneNumber: user.PhoneNumber,
        email: user.Email,
        // Include masked versions for secure display
        maskedPhone: maskPhone(user.PhoneNumber),
        maskedEmail: maskEmail(user.Email),
        // Include available MFA methods for the user
        availableMethods: [
          ...(user.PhoneNumber ? ["sms"] : []),
          "email", // Email is always available
        ],
      });
    }

    // No MFA required - generate tokens
    const tokens = generateTokenPair({ userId: user.UserID });

    // Store refresh token
    const refreshTokenExpiry = getRefreshTokenExpiry();
    // Clear TokenInvalidatedAt so new tokens work after any previous logout
    await pool
      .request()
      .input("userId", user.UserID)
      .input("refreshToken", tokens.refreshToken)
      .input("refreshTokenExpires", refreshTokenExpiry).query(`
        UPDATE dbo.UserLogin 
        SET RefreshToken = @refreshToken, 
            RefreshTokenExpires = @refreshTokenExpires,
            TokenInvalidatedAt = NULL
        WHERE UserID = @userId
      `);

    res.status(200).json({
      success: true,
      message: "Login successful!",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: {
        id: user.UserID,
        email: user.Email,
        phoneNumber: user.PhoneNumber,
        phoneVerified: user.PhoneVerified,
        preferredLoginMethod: user.PreferredLoginMethod,
        mfaEnabled: user.MFAEnabled,
        biometricEnabled: user.BiometricEnabled,
      },
    });
  } catch (error) {
    logger.error("Signin Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
});

/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     summary: Refresh access token
 *     description: Exchange a valid refresh token for a new access/refresh token pair
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 *     responses:
 *       200:
 *         description: New token pair issued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenPair'
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post("/refresh-token", authenticateRefreshToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const oldRefreshToken = req.refreshToken;
    const pool = getPool();

    // Verify refresh token exists in database and is not expired
    const result = await pool
      .request()
      .input("userId", userId)
      .input("refreshToken", oldRefreshToken).query(`
        SELECT RefreshToken, RefreshTokenExpires
        FROM dbo.UserLogin
        WHERE UserID = @userId AND RefreshToken = @refreshToken
      `);

    if (result.recordset.length === 0) {
      // Check if user has a DIFFERENT valid refresh token (logged in elsewhere)
      const activeSessionCheck = await pool.request().input("userId", userId)
        .query(`
          SELECT RefreshToken, RefreshTokenExpires 
          FROM dbo.UserLogin 
          WHERE UserID = @userId 
            AND RefreshToken IS NOT NULL 
            AND RefreshTokenExpires > GETDATE()
        `);

      if (activeSessionCheck.recordset.length > 0) {
        // User has a valid token, but it's different = logged in elsewhere
        return res.status(401).json({
          success: false,
          message:
            "Your session was ended because you signed in on another device",
          errorCode: "LOGGED_IN_ELSEWHERE",
          requireLogin: true,
        });
      }

      // No valid token exists - normal invalid token error
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
        errorCode: "TOKEN_INVALID",
        requireLogin: true,
      });
    }

    const tokenData = result.recordset[0];

    // Check if refresh token has been revoked or expired in DB
    if (new Date(tokenData.RefreshTokenExpires) < new Date()) {
      return res.status(401).json({
        success: false,
        message: "Refresh token has expired. Please sign in again.",
        errorCode: "TOKEN_EXPIRED",
        requireLogin: true,
      });
    }

    // Generate new token pair
    const tokens = generateTokenPair({ userId });
    const refreshTokenExpiry = getRefreshTokenExpiry();

    // Update refresh token in database with optimistic locking
    // Include old token in WHERE clause to detect race conditions
    const updateResult = await pool
      .request()
      .input("userId", userId)
      .input("oldRefreshToken", oldRefreshToken)
      .input("refreshToken", tokens.refreshToken)
      .input("refreshTokenExpires", refreshTokenExpiry).query(`
        UPDATE dbo.UserLogin 
        SET RefreshToken = @refreshToken, RefreshTokenExpires = @refreshTokenExpires
        WHERE UserID = @userId AND RefreshToken = @oldRefreshToken
      `);

    // If no rows affected, the token was already rotated by another request
    if (updateResult.rowsAffected[0] === 0) {
      return res.status(401).json({
        success: false,
        message: "Token has been rotated. Please sign in again.",
        errorCode: "TOKEN_ALREADY_ROTATED",
        requireLogin: true,
      });
    }

    res.status(200).json({
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    });
  } catch (error) {
    logger.error("Refresh Token Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error refreshing token",
    });
  }
});

/**
 * @swagger
 * /auth/send-phone-otp:
 *   post:
 *     summary: Send OTP to phone number
 *     description: Send a 6-digit verification code to the specified phone number
 *     tags: [OTP]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendOTPRequest'
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OTPResponse'
 *       400:
 *         description: Invalid phone number format
 *       429:
 *         description: Rate limit exceeded
 */
router.post("/send-phone-otp", checkAuthRateLimit, async (req, res) => {
  const { phoneNumber, purpose = "signin" } = req.body;

  try {
    // Validate phone number
    if (!phoneNumber || !isValidE164(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid phone number format. Use E.164 format (e.g., +12345678900)",
      });
    }

    const pool = getPool();

    // Check rate limit
    const rateLimitResult = await checkRateLimit(
      pool,
      null,
      phoneNumber,
      purpose
    );
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: rateLimitResult.error,
        remainingAttempts: 0,
      });
    }

    // Check phone number registration based on purpose
    const userResult = await pool.request().input("phoneNumber", phoneNumber)
      .query(`
        SELECT P.UserID, P.PhoneVerified, L.Email
        FROM dbo.UserProfile P
        INNER JOIN dbo.UserLogin L ON P.UserID = L.UserID
        WHERE P.PhoneNumber = @phoneNumber
      `);

    const phoneExists = userResult.recordset.length > 0;

    // For signin/login: phone must be registered and verified
    if (purpose === "signin" || purpose === "login") {
      if (!phoneExists) {
        logger.debug("Phone signin failed - phone not registered:", {
          phoneNumber: phoneNumber.slice(-4),
        });
        return res.status(404).json({
          success: false,
          message: "Phone number not registered",
        });
      }

      const user = userResult.recordset[0];
      logger.debug("Phone signin check:", {
        phoneNumber: phoneNumber.slice(-4),
        userId: user.UserID,
        phoneVerified: user.PhoneVerified,
        phoneVerifiedType: typeof user.PhoneVerified,
      });

      // Check PhoneVerified - handle both boolean and numeric (0/1) values
      let isPhoneVerified =
        user.PhoneVerified === true || user.PhoneVerified === 1;

      // Fallback: If phone not marked as verified, check OTPVerifications table
      // This handles cases where signup didn't properly record the verification
      if (!isPhoneVerified) {
        logger.debug(
          "Phone not marked verified, checking OTPVerifications table..."
        );

        const otpCheck = await pool.request().input("phoneNumber", phoneNumber)
          .query(`
            SELECT TOP 1 Status, CreatedAt, Purpose
            FROM dbo.OTPVerifications
            WHERE PhoneOrEmail = @phoneNumber
              AND Purpose IN ('signup', 'phone_verify', 'verification', 'signin')
              AND Status = 'approved'
            ORDER BY CreatedAt DESC
          `);

        if (otpCheck.recordset.length > 0) {
          logger.debug(
            "Found approved OTP verification, updating PhoneVerified status:",
            {
              phoneNumber: phoneNumber.slice(-4),
              userId: user.UserID,
              otpPurpose: otpCheck.recordset[0].Purpose,
              otpCreatedAt: otpCheck.recordset[0].CreatedAt,
            }
          );

          // Update the user's PhoneVerified status
          await pool.request().input("userId", user.UserID).query(`
              UPDATE dbo.UserProfile
              SET PhoneVerified = 1
              WHERE UserID = @userId
            `);

          isPhoneVerified = true;
        }
      }

      if (!isPhoneVerified) {
        logger.debug("Phone signin failed - phone not verified:", {
          phoneNumber: phoneNumber.slice(-4),
          userId: user.UserID,
          rawPhoneVerified: user.PhoneVerified,
        });
        return res.status(400).json({
          success: false,
          message:
            "Phone number not verified. Please verify your phone number first.",
        });
      }
    }

    // For signup: phone must NOT be already registered
    if (purpose === "signup") {
      if (phoneExists) {
        return res.status(409).json({
          success: false,
          message: "Phone number already registered. Please sign in instead.",
        });
      }
    }

    // Send OTP via Twilio
    const otpResult = await sendPhoneOTP(phoneNumber);

    if (!otpResult.success) {
      return res.status(500).json({
        success: false,
        message: otpResult.error || "Failed to send verification code",
      });
    }

    // Record OTP attempt (use null for anonymous/pre-signup users)
    await recordOTPAttempt(
      pool,
      null,
      phoneNumber,
      otpResult.verificationSid,
      purpose
    );

    res.status(200).json({
      success: true,
      message: "Verification code sent successfully",
      remainingAttempts: rateLimitResult.remainingAttempts - 1,
    });
  } catch (error) {
    logger.error("Send Phone OTP Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error sending verification code",
    });
  }
});

/**
 * @swagger
 * /auth/verify-phone-otp:
 *   post:
 *     summary: Verify phone OTP code
 *     description: Verify the 6-digit code sent to the phone number
 *     tags: [OTP]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyOTPRequest'
 *     responses:
 *       200:
 *         description: Phone verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         description: Invalid or expired code
 *       429:
 *         description: Too many verification attempts
 */
router.post("/verify-phone-otp", checkAuthRateLimit, async (req, res) => {
  const { phoneNumber, code, purpose = "signin" } = req.body;

  try {
    logger.debug("Verify phone OTP request:", {
      phoneNumber: phoneNumber ? phoneNumber.slice(-4) : "missing",
      purpose,
      codeProvided: !!code,
    });

    // Validate inputs
    if (!phoneNumber || !code) {
      return res.status(400).json({
        success: false,
        message: "Phone number and code are required",
      });
    }

    // Verify OTP with Twilio
    const verifyResult = await verifyPhoneOTP(phoneNumber, code);

    if (!verifyResult.success) {
      logger.debug("Phone OTP verification failed:", {
        phoneNumber: phoneNumber.slice(-4),
        error: verifyResult.error,
        status: verifyResult.status,
      });
      return res.status(400).json({
        success: false,
        message: verifyResult.error || "Invalid verification code",
        errorCode: "OTP_INVALID",
      });
    }

    const pool = getPool();

    // Normalize purpose for storage - map variants to canonical values
    const normalizedPurpose = purpose === "verification" ? "signup" : purpose;

    // Update OTP status
    await updateOTPStatus(pool, phoneNumber, normalizedPurpose, "approved");

    logger.debug("Phone OTP verified successfully:", {
      phoneNumber: phoneNumber.slice(-4),
      purpose: normalizedPurpose,
    });

    // Reset rate limit on success
    resetAuthRateLimit(req);

    // Handle signup/verification purposes FIRST - no user lookup needed!
    // The user doesn't exist yet, we just need to verify the phone is valid
    if (
      purpose === "signup" ||
      purpose === "verification" ||
      normalizedPurpose === "signup"
    ) {
      logger.debug(
        "Signup phone verification complete - no user lookup needed:",
        {
          phoneNumber: phoneNumber.slice(-4),
          purpose,
        }
      );
      return res.status(200).json({
        success: true,
        message: "Phone number verified successfully",
        phoneVerified: true,
      });
    }

    // Handle signin/login - return tokens for existing user
    if (purpose === "signin" || purpose === "login") {
      // Get user by phone number
      const userResult = await pool.request().input("phoneNumber", phoneNumber)
        .query(`
          SELECT P.UserID, L.Email, P.PhoneNumber, P.PhoneVerified,
                 L.PreferredLoginMethod, L.MFAEnabled, L.BiometricEnabled
          FROM dbo.UserProfile P
          INNER JOIN dbo.UserLogin L ON P.UserID = L.UserID
          WHERE P.PhoneNumber = @phoneNumber
        `);

      if (userResult.recordset.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const user = userResult.recordset[0];

      // Generate tokens
      const tokens = generateTokenPair({ userId: user.UserID });
      const refreshTokenExpiry = getRefreshTokenExpiry();

      // Store refresh token and clear TokenInvalidatedAt for new session
      await pool
        .request()
        .input("userId", user.UserID)
        .input("refreshToken", tokens.refreshToken)
        .input("refreshTokenExpires", refreshTokenExpiry).query(`
          UPDATE dbo.UserLogin 
          SET RefreshToken = @refreshToken, 
              RefreshTokenExpires = @refreshTokenExpires,
              TokenInvalidatedAt = NULL
          WHERE UserID = @userId
        `);

      return res.status(200).json({
        success: true,
        message: "Login successful!",
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        user: {
          id: user.UserID,
          email: user.Email,
          phoneNumber: user.PhoneNumber,
          phoneVerified: user.PhoneVerified,
          preferredLoginMethod: user.PreferredLoginMethod,
          mfaEnabled: user.MFAEnabled,
          biometricEnabled: user.BiometricEnabled,
        },
      });
    }

    // For other purposes (phone_verify, etc.)
    res.status(200).json({
      success: true,
      message: "Phone number verified successfully",
    });
  } catch (error) {
    logger.error("Verify Phone OTP Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error verifying code",
    });
  }
});

/**
 * @swagger
 * /auth/verify-phone-number:
 *   post:
 *     summary: Verify phone number for authenticated user
 *     description: Verify phone ownership for an existing logged-in user
 *     tags: [OTP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNumber, code]
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 example: '+14155551234'
 *               code:
 *                 type: string
 *                 example: '123456'
 *     responses:
 *       200:
 *         description: Phone verified and linked to account
 *       400:
 *         description: Invalid code
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post("/verify-phone-number", authenticateToken, async (req, res) => {
  const { phoneNumber, code } = req.body;
  const userId = req.user.userId;

  try {
    // If code is provided, verify it
    if (code) {
      const verifyResult = await verifyPhoneOTP(phoneNumber, code);

      if (!verifyResult.success) {
        logger.debug("Phone number verification failed:", {
          userId,
          phoneNumber: phoneNumber.slice(-4),
          error: verifyResult.error,
        });
        return res.status(400).json({
          success: false,
          message: verifyResult.error || "Invalid verification code",
          errorCode: "OTP_INVALID",
        });
      }

      const pool = getPool();

      // Update phone verification status
      await pool
        .request()
        .input("userId", userId)
        .input("phoneNumber", phoneNumber).query(`
          UPDATE dbo.UserProfile
          SET PhoneNumber = @phoneNumber, PhoneVerified = 1
          WHERE UserID = @userId
        `);

      return res.status(200).json({
        success: true,
        message: "Phone number verified successfully",
      });
    }

    // No code - send OTP
    if (!phoneNumber || !isValidE164(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format",
      });
    }

    const pool = getPool();

    // Check rate limit
    const rateLimitResult = await checkRateLimit(
      pool,
      userId,
      phoneNumber,
      "phone_verify"
    );
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: rateLimitResult.error,
      });
    }

    // Update phone number (unverified)
    await pool
      .request()
      .input("userId", userId)
      .input("phoneNumber", phoneNumber).query(`
        UPDATE dbo.UserProfile
        SET PhoneNumber = @phoneNumber, PhoneVerified = 0
        WHERE UserID = @userId
      `);

    // Send OTP
    const otpResult = await sendPhoneOTP(phoneNumber);

    if (!otpResult.success) {
      return res.status(500).json({
        success: false,
        message: otpResult.error || "Failed to send verification code",
      });
    }

    await recordOTPAttempt(
      pool,
      userId,
      phoneNumber,
      otpResult.verificationSid,
      "phone_verify"
    );

    res.status(200).json({
      success: true,
      message: "Verification code sent",
    });
  } catch (error) {
    logger.error("Verify Phone Number Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error verifying phone number",
    });
  }
});

/**
 * @swagger
 * /auth/send-mfa-code:
 *   post:
 *     summary: Send MFA verification code
 *     description: Send MFA code via SMS or email during the login flow
 *     tags: [MFA]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, method]
 *             properties:
 *               userId:
 *                 type: integer
 *                 example: 123
 *               method:
 *                 type: string
 *                 enum: [sms, email]
 *                 example: sms
 *     responses:
 *       200:
 *         description: MFA code sent
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         description: Invalid request
 *       429:
 *         description: Rate limit exceeded
 */
router.post("/send-mfa-code", checkAuthRateLimit, async (req, res) => {
  const { userId, method } = req.body;

  try {
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const pool = getPool();

    // Get user info
    const result = await pool.request().input("userId", userId).query(`
        SELECT L.Email, L.MFAEnabled, L.MFAMethod, P.PhoneNumber
        FROM dbo.UserLogin L
        INNER JOIN dbo.UserProfile P ON L.UserID = P.UserID
        WHERE L.UserID = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.recordset[0];
    const mfaMethod = method || user.MFAMethod || "email";

    // Check rate limit
    const destination = mfaMethod === "sms" ? user.PhoneNumber : user.Email;
    const rateLimitResult = await checkRateLimit(
      pool,
      userId,
      destination,
      "mfa"
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: rateLimitResult.error,
      });
    }

    // Send OTP
    let otpResult;
    if (mfaMethod === "sms" && user.PhoneNumber) {
      otpResult = await sendPhoneOTP(user.PhoneNumber);
    } else {
      otpResult = await sendEmailOTP(user.Email);
    }

    if (!otpResult.success) {
      return res.status(500).json({
        success: false,
        message: otpResult.error || "Failed to send MFA code",
      });
    }

    await recordOTPAttempt(
      pool,
      userId,
      destination,
      otpResult.verificationSid,
      "mfa"
    );

    res.status(200).json({
      success: true,
      message: "MFA code sent",
      method: mfaMethod,
    });
  } catch (error) {
    logger.error("Send MFA Code Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error sending MFA code",
    });
  }
});

/**
 * @swagger
 * /auth/verify-mfa-login:
 *   post:
 *     summary: Complete MFA login verification
 *     description: Verify MFA code and complete the login process, returning tokens
 *     tags: [MFA]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyMFALoginRequest'
 *     responses:
 *       200:
 *         description: MFA verified, login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenPair'
 *       400:
 *         description: Invalid or expired code
 *       401:
 *         description: Invalid MFA session
 */
router.post("/verify-mfa-login", checkAuthRateLimit, async (req, res) => {
  const { mfaSessionToken, code, userId, method } = req.body;

  try {
    if (!userId || !code || !mfaSessionToken) {
      return res.status(400).json({
        success: false,
        message: "User ID, code, and MFA session token are required",
      });
    }

    const pool = getPool();

    // Get user info and validate MFA session
    const result = await pool.request().input("userId", userId).query(`
        SELECT L.UserID, L.Email, L.MFAMethod, L.MFAEnabled, L.MFASessionToken, L.MFASessionExpires,
               P.PhoneNumber, P.PhoneVerified, L.PreferredLoginMethod, L.BiometricEnabled
        FROM dbo.UserLogin L
        INNER JOIN dbo.UserProfile P ON L.UserID = P.UserID
        WHERE L.UserID = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.recordset[0];

    // Validate MFA session token
    if (!user.MFASessionToken || user.MFASessionToken !== mfaSessionToken) {
      return res.status(401).json({
        success: false,
        message: "Invalid MFA session. Please sign in again.",
        errorCode: "MFA_SESSION_INVALID",
      });
    }

    // Check if MFA session has expired
    if (
      user.MFASessionExpires &&
      new Date(user.MFASessionExpires) < new Date()
    ) {
      // Clear expired session (include token in WHERE for safety)
      await pool
        .request()
        .input("userId", userId)
        .input("mfaSessionToken", mfaSessionToken).query(`
          UPDATE dbo.UserLogin 
          SET MFASessionToken = NULL, MFASessionExpires = NULL
          WHERE UserID = @userId AND MFASessionToken = @mfaSessionToken
        `);
      return res.status(401).json({
        success: false,
        message: "MFA session expired. Please sign in again.",
        errorCode: "MFA_SESSION_EXPIRED",
      });
    }

    // Use the method parameter from frontend if provided, otherwise fall back to user's stored method
    // This allows users to choose SMS or Email regardless of their default preference
    const verificationMethod = method || user.MFAMethod || "email";
    const destination =
      verificationMethod === "sms" ? user.PhoneNumber : user.Email;

    logger.debug("MFA verification attempt:", {
      userId,
      requestedMethod: method,
      userStoredMethod: user.MFAMethod,
      usingMethod: verificationMethod,
      destination:
        verificationMethod === "sms"
          ? user.PhoneNumber?.slice(-4)
          : user.Email?.substring(0, 3) + "***",
    });

    // Verify OTP based on the method the user actually used
    let verifyResult;
    if (verificationMethod === "sms") {
      if (!user.PhoneNumber) {
        return res.status(400).json({
          success: false,
          message: "No phone number associated with this account",
          errorCode: "PHONE_NOT_FOUND",
        });
      }
      verifyResult = await verifyPhoneOTP(user.PhoneNumber, code);
    } else {
      verifyResult = await verifyEmailOTP(user.Email, code);
    }

    if (!verifyResult.success) {
      await updateOTPStatus(pool, destination, "mfa", "failed");
      logger.debug("MFA verification failed:", {
        userId,
        method: verificationMethod,
        error: verifyResult.error,
      });
      return res.status(400).json({
        success: false,
        message: verifyResult.error || "Invalid verification code",
        errorCode: "OTP_INVALID",
      });
    }

    // Record successful MFA verification
    await recordMFAVerification(pool, userId, verificationMethod);
    await updateOTPStatus(pool, destination, "mfa", "approved");

    // Clear MFA session token with optimistic locking (one-time use)
    const clearResult = await pool
      .request()
      .input("userId", userId)
      .input("mfaSessionToken", mfaSessionToken).query(`
        UPDATE dbo.UserLogin 
        SET MFASessionToken = NULL, MFASessionExpires = NULL
        WHERE UserID = @userId AND MFASessionToken = @mfaSessionToken
      `);

    // If no rows affected, token was already used by another request
    if (clearResult.rowsAffected[0] === 0) {
      return res.status(401).json({
        success: false,
        message: "MFA session already used. Please sign in again.",
        errorCode: "MFA_SESSION_ALREADY_USED",
        requireLogin: true,
      });
    }

    // Generate tokens
    const tokens = generateTokenPair({ userId: user.UserID });
    const refreshTokenExpiry = getRefreshTokenExpiry();

    // Store refresh token and clear TokenInvalidatedAt for new session
    await pool
      .request()
      .input("userId", user.UserID)
      .input("refreshToken", tokens.refreshToken)
      .input("refreshTokenExpires", refreshTokenExpiry).query(`
        UPDATE dbo.UserLogin 
        SET RefreshToken = @refreshToken, 
            RefreshTokenExpires = @refreshTokenExpires,
            TokenInvalidatedAt = NULL
        WHERE UserID = @userId
      `);

    logger.debug("MFA verification successful:", {
      userId,
      method: verificationMethod,
    });

    res.status(200).json({
      success: true,
      message: "MFA verification successful",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: {
        id: user.UserID,
        email: user.Email,
        phoneNumber: user.PhoneNumber,
        phoneVerified: user.PhoneVerified,
        preferredLoginMethod: user.PreferredLoginMethod,
        mfaEnabled: user.MFAEnabled,
        biometricEnabled: user.BiometricEnabled,
      },
    });
  } catch (error) {
    logger.error("Verify MFA Login Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error verifying MFA code",
    });
  }
});

/**
 * @swagger
 * /auth/verify-mfa-code:
 *   post:
 *     summary: Verify MFA code (legacy)
 *     description: Legacy endpoint for MFA code verification
 *     tags: [MFA]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, code]
 *             properties:
 *               userId:
 *                 type: integer
 *               code:
 *                 type: string
 *               method:
 *                 type: string
 *                 enum: [sms, email]
 *     responses:
 *       200:
 *         description: Code verified
 *       400:
 *         description: Invalid code
 */
router.post("/verify-mfa-code", checkAuthRateLimit, async (req, res) => {
  const { userId, code, method } = req.body;

  try {
    if (!userId || !code) {
      return res.status(400).json({
        success: false,
        message: "User ID and code are required",
      });
    }

    const pool = getPool();

    // Get user info
    const result = await pool.request().input("userId", userId).query(`
        SELECT L.UserID, L.Email, L.MFAMethod, P.PhoneNumber, P.PhoneVerified,
               L.PreferredLoginMethod, L.MFAEnabled, L.BiometricEnabled
        FROM dbo.UserLogin L
        INNER JOIN dbo.UserProfile P ON L.UserID = P.UserID
        WHERE L.UserID = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.recordset[0];
    const mfaMethod = method || user.MFAMethod || "email";
    const destination = mfaMethod === "sms" ? user.PhoneNumber : user.Email;

    // Verify OTP
    let verifyResult;
    if (mfaMethod === "sms") {
      verifyResult = await verifyPhoneOTP(user.PhoneNumber, code);
    } else {
      verifyResult = await verifyEmailOTP(user.Email, code);
    }

    if (!verifyResult.success) {
      await updateOTPStatus(pool, destination, "mfa", "failed");
      return res.status(400).json({
        success: false,
        message: verifyResult.error || "Invalid verification code",
      });
    }

    // Record successful MFA verification
    await recordMFAVerification(pool, userId, mfaMethod);
    await updateOTPStatus(pool, destination, "mfa", "approved");

    // Generate tokens
    const tokens = generateTokenPair({ userId: user.UserID });
    const refreshTokenExpiry = getRefreshTokenExpiry();

    // Store refresh token and clear TokenInvalidatedAt for new session
    await pool
      .request()
      .input("userId", user.UserID)
      .input("refreshToken", tokens.refreshToken)
      .input("refreshTokenExpires", refreshTokenExpiry).query(`
        UPDATE dbo.UserLogin 
        SET RefreshToken = @refreshToken, 
            RefreshTokenExpires = @refreshTokenExpires,
            TokenInvalidatedAt = NULL
        WHERE UserID = @userId
      `);

    res.status(200).json({
      success: true,
      message: "MFA verification successful",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: {
        id: user.UserID,
        email: user.Email,
        phoneNumber: user.PhoneNumber,
        phoneVerified: user.PhoneVerified,
        preferredLoginMethod: user.PreferredLoginMethod,
        mfaEnabled: user.MFAEnabled,
        biometricEnabled: user.BiometricEnabled,
      },
    });
  } catch (error) {
    logger.error("Verify MFA Code Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error verifying MFA code",
    });
  }
});

/**
 * @swagger
 * /auth/setup-mfa:
 *   post:
 *     summary: Setup MFA for account
 *     description: Enable MFA using SMS or email. First call sends verification code, second call with code enables MFA.
 *     tags: [MFA]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SetupMFARequest'
 *     responses:
 *       200:
 *         description: MFA setup initiated or completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 mfaEnabled:
 *                   type: boolean
 *       400:
 *         description: Invalid method or code
 */
router.post(
  "/setup-mfa",
  authenticateToken,
  checkAuthRateLimit,
  async (req, res) => {
    const { method, code } = req.body;
    const userId = req.user.userId;

    try {
      if (!method || !["sms", "email"].includes(method)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid MFA method. Must be "sms" or "email"',
        });
      }

      const pool = getPool();

      // Get user info
      const userResult = await pool.request().input("userId", userId).query(`
        SELECT L.Email, P.PhoneNumber, P.PhoneVerified
        FROM dbo.UserLogin L
        INNER JOIN dbo.UserProfile P ON L.UserID = P.UserID
        WHERE L.UserID = @userId
      `);

      if (userResult.recordset.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const user = userResult.recordset[0];

      // For SMS method, verify phone is set and verified
      if (method === "sms") {
        if (!user.PhoneNumber || !user.PhoneVerified) {
          return res.status(400).json({
            success: false,
            message: "Phone number must be verified before enabling SMS MFA",
          });
        }
      }

      const destination = method === "sms" ? user.PhoneNumber : user.Email;

      // If code is provided, verify it to complete setup
      if (code) {
        let verifyResult;
        if (method === "sms") {
          verifyResult = await verifyPhoneOTP(user.PhoneNumber, code);
        } else {
          verifyResult = await verifyEmailOTP(user.Email, code);
        }

        if (!verifyResult.success) {
          return res.status(400).json({
            success: false,
            message: verifyResult.error || "Invalid verification code",
          });
        }

        // Enable MFA
        await pool.request().input("userId", userId).input("method", method)
          .query(`
          UPDATE dbo.UserLogin
          SET MFAEnabled = 1, MFAMethod = @method
          WHERE UserID = @userId
        `);

        return res.status(200).json({
          success: true,
          message: "MFA enabled successfully",
          mfaEnabled: true,
          mfaMethod: method,
        });
      }

      // No code - send verification code
      const rateLimitResult = await checkRateLimit(
        pool,
        userId,
        destination,
        "mfa"
      );
      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          success: false,
          message: rateLimitResult.error,
        });
      }

      let otpResult;
      if (method === "sms") {
        otpResult = await sendPhoneOTP(user.PhoneNumber);
      } else {
        otpResult = await sendEmailOTP(user.Email);
      }

      if (!otpResult.success) {
        return res.status(500).json({
          success: false,
          message: otpResult.error || "Failed to send verification code",
        });
      }

      await recordOTPAttempt(
        pool,
        userId,
        destination,
        otpResult.verificationSid,
        "mfa"
      );

      res.status(200).json({
        success: true,
        message:
          "Verification code sent. Enter the code to complete MFA setup.",
        method,
      });
    } catch (error) {
      logger.error("Setup MFA Error", { error: error.message });
      res.status(500).json({
        success: false,
        message: "Error setting up MFA",
      });
    }
  }
);

/**
 * @swagger
 * /auth/enable-mfa-direct:
 *   post:
 *     summary: Enable MFA directly (skip verification)
 *     description: Enable MFA when phone/email was already verified during signup
 *     tags: [MFA]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [method]
 *             properties:
 *               method:
 *                 type: string
 *                 enum: [sms, email]
 *               alreadyVerified:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: MFA enabled
 *       400:
 *         description: Invalid method or phone not verified
 */
router.post(
  "/enable-mfa-direct",
  authenticateToken,
  checkAuthRateLimit,
  async (req, res) => {
    const { method, alreadyVerified = true } = req.body;
    const userId = req.user.userId;

    try {
      // Validate method
      if (!method || !["sms", "email"].includes(method)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid MFA method. Must be "sms" or "email"',
        });
      }

      const pool = getPool();

      // Get user info
      const userResult = await pool.request().input("userId", userId).query(`
        SELECT L.Email, L.MFAEnabled, P.PhoneNumber, P.PhoneVerified
        FROM dbo.UserLogin L
        INNER JOIN dbo.UserProfile P ON L.UserID = P.UserID
        WHERE L.UserID = @userId
      `);

      if (userResult.recordset.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const user = userResult.recordset[0];

      // Check if MFA is already enabled
      if (user.MFAEnabled) {
        return res.status(200).json({
          success: true,
          message: "MFA is already enabled",
          mfaEnabled: true,
          mfaMethod: method,
        });
      }

      // For SMS method, verify phone is set and verified
      if (method === "sms") {
        if (!user.PhoneNumber) {
          return res.status(400).json({
            success: false,
            message: "Phone number is required for SMS MFA",
          });
        }

        if (!user.PhoneVerified && !alreadyVerified) {
          return res.status(400).json({
            success: false,
            message: "Phone number must be verified before enabling SMS MFA",
          });
        }

        // If alreadyVerified is true, check if there was a recent verification
        // This provides additional security by verifying the phone was actually verified recently
        if (alreadyVerified && !user.PhoneVerified) {
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
          const otpCheck = await pool
            .request()
            .input("phoneNumber", user.PhoneNumber)
            .input("tenMinutesAgo", tenMinutesAgo).query(`
            SELECT TOP 1 Status
            FROM dbo.OTPVerifications
            WHERE PhoneOrEmail = @phoneNumber
              AND Purpose IN ('signup', 'phone_verify')
              AND Status = 'approved'
              AND CreatedAt > @tenMinutesAgo
            ORDER BY CreatedAt DESC
          `);

          if (otpCheck.recordset.length === 0) {
            return res.status(400).json({
              success: false,
              message:
                "Phone number verification required. Please verify your phone first.",
            });
          }

          // Update PhoneVerified status since we confirmed it was verified
          await pool.request().input("userId", userId).query(`
          UPDATE dbo.UserProfile
          SET PhoneVerified = 1
          WHERE UserID = @userId
        `);
        }
      }

      // Enable MFA directly
      await pool.request().input("userId", userId).input("method", method)
        .query(`
        UPDATE dbo.UserLogin
        SET MFAEnabled = 1, MFAMethod = @method
        WHERE UserID = @userId
      `);

      logger.debug(
        `MFA enabled directly for user ${userId} with method: ${method}`
      );

      res.status(200).json({
        success: true,
        message: "MFA enabled successfully",
        mfaEnabled: true,
        mfaMethod: method,
      });
    } catch (error) {
      logger.error("Enable MFA Direct Error", { error: error.message });
      res.status(500).json({
        success: false,
        message: "Error enabling MFA",
      });
    }
  }
);

/**
 * @swagger
 * /auth/disable-mfa:
 *   post:
 *     summary: Disable MFA
 *     description: Remove MFA from account. Requires MFA verification to confirm.
 *     tags: [MFA]
 *     responses:
 *       200:
 *         description: MFA disabled successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: MFA verification required
 */
router.post(
  "/disable-mfa",
  authenticateToken,
  requireMFA("disable_mfa"),
  async (req, res) => {
    const userId = req.user.userId;

    try {
      const pool = getPool();

      await pool.request().input("userId", userId).query(`
        UPDATE dbo.UserLogin
        SET MFAEnabled = 0, MFAMethod = NULL
        WHERE UserID = @userId
      `);

      res.status(200).json({
        success: true,
        message: "MFA disabled successfully",
      });
    } catch (error) {
      logger.error("Disable MFA Error", { error: error.message });
      res.status(500).json({
        success: false,
        message: "Error disabling MFA",
      });
    }
  }
);

/**
 * @swagger
 * /auth/update-login-preference:
 *   patch:
 *     summary: Update preferred login method
 *     description: Set the user's preferred login method (email or phone)
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [preferredLoginMethod]
 *             properties:
 *               preferredLoginMethod:
 *                 type: string
 *                 enum: [email, phone]
 *     responses:
 *       200:
 *         description: Preference updated
 *       400:
 *         description: Invalid method or required verification not complete
 */
router.patch(
  "/update-login-preference",
  authenticateToken,
  async (req, res) => {
    const { preferredLoginMethod } = req.body;
    const userId = req.user.userId;

    try {
      const validMethods = ["email", "phone"];
      if (!validMethods.includes(preferredLoginMethod)) {
        return res.status(400).json({
          success: false,
          message: "Invalid login method. Must be email or phone",
        });
      }

      const pool = getPool();

      // If phone, verify phone is set up
      if (preferredLoginMethod === "phone") {
        const phoneCheck = await pool.request().input("userId", userId).query(`
          SELECT PhoneNumber, PhoneVerified FROM dbo.UserProfile WHERE UserID = @userId
        `);

        if (!phoneCheck.recordset[0]?.PhoneVerified) {
          return res.status(400).json({
            success: false,
            message:
              "Phone number must be verified before setting as preferred login method",
          });
        }
      }

      await pool
        .request()
        .input("userId", userId)
        .input("preferredLoginMethod", preferredLoginMethod).query(`
        UPDATE dbo.UserLogin
        SET PreferredLoginMethod = @preferredLoginMethod
        WHERE UserID = @userId
      `);

      res.status(200).json({
        success: true,
        message: "Login preference updated",
        preferredLoginMethod,
      });
    } catch (error) {
      logger.error("Update Login Preference Error", { error: error.message });
      res.status(500).json({
        success: false,
        message: "Error updating login preference",
      });
    }
  }
);

// NOTE: Biometric endpoints removed - Face ID/Touch ID is now handled locally on the device
// See: Face ID Session Gate implementation (local-only, no backend interaction)

/**
 * @swagger
 * /auth/send-email-otp:
 *   post:
 *     summary: Send OTP to email
 *     description: Send a 6-digit verification code to the specified email address
 *     tags: [OTP]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendEmailOTPRequest'
 *     responses:
 *       200:
 *         description: OTP sent (or silent success for password_reset)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OTPResponse'
 *       400:
 *         description: Invalid email format
 *       409:
 *         description: Email already registered (for signup purpose)
 *       429:
 *         description: Rate limit exceeded
 */
router.post("/send-email-otp", checkAuthRateLimit, async (req, res) => {
  const { email, purpose = "password_reset" } = req.body;

  try {
    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // Normalize email to lowercase for case-insensitive matching
    const normalizedEmail = email.toLowerCase().trim();

    // Validate purpose
    const validPurposes = [
      "signup",
      "verification",
      "signin",
      "mfa",
      "password_reset",
    ];
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid purpose. Must be one of: signup, verification, signin, mfa, password_reset",
      });
    }

    const pool = getPool();
    let userId = null;

    // For password_reset: user must exist (but don't reveal this in error)
    // Use LOWER() for backward compatibility with old accounts
    if (purpose === "password_reset") {
      const userResult = await pool.request().input("email", normalizedEmail)
        .query(`
        SELECT TOP 1 UserID
        FROM dbo.UserLogin
        WHERE LOWER(Email) = @email
        ORDER BY UserID DESC
      `);

      if (userResult.recordset.length === 0) {
        // Don't reveal if email exists - return success anyway
        return res.status(200).json({
          success: true,
          message: "If an account exists, a verification code has been sent.",
        });
      }
      userId = userResult.recordset[0].UserID;
    }

    // For signup/verification: user must NOT exist
    // Use LOWER() for backward compatibility with old accounts
    if (purpose === "signup" || purpose === "verification") {
      const existingUser = await pool.request().input("email", normalizedEmail)
        .query(`
        SELECT UserID FROM dbo.UserLogin WHERE LOWER(Email) = @email
      `);

      if (existingUser.recordset.length > 0) {
        return res.status(409).json({
          success: false,
          message: "Email already registered. Please sign in instead.",
        });
      }
    }

    // For signin/mfa: user must exist
    // Use LOWER() for backward compatibility with old accounts
    if (purpose === "signin" || purpose === "mfa") {
      const userResult = await pool.request().input("email", normalizedEmail)
        .query(`
        SELECT UserID FROM dbo.UserLogin WHERE LOWER(Email) = @email
      `);

      if (userResult.recordset.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
      userId = userResult.recordset[0].UserID;
    }

    // Check rate limit (use normalized email)
    const rateLimitResult = await checkRateLimit(
      pool,
      userId,
      normalizedEmail,
      purpose
    );
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: rateLimitResult.error,
        remainingAttempts: 0,
      });
    }

    // Send OTP via Twilio (use normalized email)
    const otpResult = await sendEmailOTP(normalizedEmail);

    if (!otpResult.success) {
      logger.error("Failed to send email OTP", { error: otpResult.error });
      return res.status(500).json({
        success: false,
        message: otpResult.error || "Failed to send verification code",
      });
    }

    // Record OTP attempt (use normalized email)
    await recordOTPAttempt(
      pool,
      userId,
      normalizedEmail,
      otpResult.verificationSid,
      purpose
    );

    logger.debug("Email OTP sent successfully:", {
      email: normalizedEmail.substring(0, 3) + "***",
      purpose,
      verificationSid: otpResult.verificationSid,
    });

    res.status(200).json({
      success: true,
      message: "Verification code sent successfully",
      remainingAttempts: rateLimitResult.remainingAttempts - 1,
    });
  } catch (error) {
    logger.error("Send Email OTP Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error sending verification code",
    });
  }
});

/**
 * @swagger
 * /auth/verify-email-otp:
 *   post:
 *     summary: Verify email OTP code
 *     description: Verify the 6-digit code sent to the email address
 *     tags: [OTP]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyOTPRequest'
 *     responses:
 *       200:
 *         description: Email verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         description: Invalid or expired code
 *       404:
 *         description: User not found (for signin/mfa purposes)
 */
router.post("/verify-email-otp", checkAuthRateLimit, async (req, res) => {
  const { email, code, purpose = "password_reset" } = req.body;

  try {
    // Validate inputs
    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and code are required",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // Normalize email to lowercase for case-insensitive matching
    const normalizedEmail = email.toLowerCase().trim();

    // Verify OTP with Twilio (use normalized email)
    const verifyResult = await verifyEmailOTP(normalizedEmail, code);

    if (!verifyResult.success) {
      logger.debug("Email OTP verification failed:", {
        email: normalizedEmail.substring(0, 3) + "***",
        error: verifyResult.error,
        status: verifyResult.status,
      });
      return res.status(400).json({
        success: false,
        message: verifyResult.error || "Invalid verification code",
        errorCode: "OTP_INVALID",
      });
    }

    const pool = getPool();

    // Update OTP status (use normalized email)
    await updateOTPStatus(pool, normalizedEmail, purpose, "approved");

    // Reset rate limit on success
    resetAuthRateLimit(req);

    logger.debug("Email OTP verified successfully:", {
      email: normalizedEmail.substring(0, 3) + "***",
      purpose,
    });

    // Handle signup/verification - just confirm email is valid
    if (purpose === "signup" || purpose === "verification") {
      logger.debug("Signup email verification complete:", {
        email: normalizedEmail.substring(0, 3) + "***",
        purpose,
      });
      return res.status(200).json({
        success: true,
        message: "Email verified successfully",
        verified: true,
      });
    }

    // Handle signin/mfa - return tokens for existing user
    // Use LOWER() for backward compatibility with old accounts
    if (purpose === "signin" || purpose === "mfa") {
      const userResult = await pool.request().input("email", normalizedEmail)
        .query(`
        SELECT P.UserID, L.Email, L.PreferredLoginMethod, L.MFAEnabled, L.BiometricEnabled,
               P.PhoneNumber, P.PhoneVerified
        FROM dbo.UserLogin L
        INNER JOIN dbo.UserProfile P ON L.UserID = P.UserID
        WHERE LOWER(L.Email) = @email
      `);

      if (userResult.recordset.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const user = userResult.recordset[0];
      const tokens = generateTokenPair({ userId: user.UserID });
      const refreshTokenExpiry = getRefreshTokenExpiry();

      // Store refresh token and clear TokenInvalidatedAt for new session
      await pool
        .request()
        .input("userId", user.UserID)
        .input("refreshToken", tokens.refreshToken)
        .input("refreshTokenExpires", refreshTokenExpiry)
        .query(`UPDATE dbo.UserLogin 
                SET RefreshToken = @refreshToken, 
                    RefreshTokenExpires = @refreshTokenExpires,
                    TokenInvalidatedAt = NULL
                WHERE UserID = @userId`);

      return res.status(200).json({
        success: true,
        message: "Login successful!",
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        user: {
          id: user.UserID,
          email: user.Email,
          phoneNumber: user.PhoneNumber,
          phoneVerified: user.PhoneVerified,
          preferredLoginMethod: user.PreferredLoginMethod,
          mfaEnabled: user.MFAEnabled,
          biometricEnabled: user.BiometricEnabled,
        },
      });
    }

    // For password_reset, return a token that can be used to reset the password
    // Use LOWER() for backward compatibility with old accounts
    if (purpose === "password_reset") {
      // Get user ID for the email
      const userResult = await pool.request().input("email", normalizedEmail)
        .query(`
        SELECT TOP 1 UserID
        FROM dbo.UserLogin
        WHERE LOWER(Email) = @email
        ORDER BY UserID DESC
      `);

      if (userResult.recordset.length === 0) {
        return res.status(400).json({
          success: false,
          message: "User not found",
        });
      }

      const userId = userResult.recordset[0].UserID;

      // Generate a temporary reset token (valid for 10 minutes)
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenExpires = new Date(Date.now() + 10 * 60 * 1000);

      // Store reset token in database
      await pool
        .request()
        .input("userId", userId)
        .input("resetToken", resetToken)
        .input("resetTokenExpires", resetTokenExpires).query(`
          UPDATE dbo.UserLogin
          SET PasswordResetToken = @resetToken, PasswordResetExpires = @resetTokenExpires
          WHERE UserID = @userId
        `);

      return res.status(200).json({
        success: true,
        message: "Email verified successfully",
        verified: true,
        resetToken, // Frontend can use this to authorize the password reset
      });
    }

    // Default response for other purposes
    res.status(200).json({
      success: true,
      message: "Email verified successfully",
      verified: true,
    });
  } catch (error) {
    logger.error("Verify Email OTP Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error verifying code",
    });
  }
});

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Request password reset
 *     description: Send a password reset code to the user's email. Always returns success to prevent email enumeration.
 *     tags: [Password]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordRequest'
 *     responses:
 *       200:
 *         description: Reset code sent (if account exists)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 useTwilio:
 *                   type: boolean
 *       429:
 *         description: Rate limit exceeded
 */
router.post("/forgot-password", checkAuthRateLimit, async (req, res) => {
  const { email } = req.body;

  // Normalize email to lowercase for case-insensitive matching
  const normalizedEmail = email.toLowerCase().trim();
  const pool = getPool();

  try {
    // Get latest UserID for the email (use LOWER() for backward compatibility)
    const userResult = await pool.request().input("email", normalizedEmail)
      .query(`
        SELECT TOP 1 UserID
        FROM dbo.UserLogin
        WHERE LOWER(Email) = @email
        ORDER BY UserID DESC
      `);

    if (userResult.recordset.length === 0) {
      // Don't reveal if email exists
      return res.status(200).json({
        success: true,
        message: "If an account exists, a reset code has been sent.",
      });
    }

    const userId = userResult.recordset[0].UserID;

    // Check rate limit (use normalized email for consistent tracking)
    const rateLimitResult = await checkRateLimit(
      pool,
      email,
      normalizedEmail,
      "password_reset"
    );
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: rateLimitResult.error,
      });
    }

    // Send OTP via Twilio (use normalized email)
    const otpResult = await sendEmailOTP(normalizedEmail);

    if (!otpResult.success) {
      // Fall back to legacy email method
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const lastModified = new Date();

      // Delete previous codes
      await pool
        .request()
        .input("userId", userId)
        .query(
          `DELETE FROM dbo.PasswordResets WHERE UserID = @userId AND Used = 0`
        );

      // Insert new code
      await pool
        .request()
        .input("userId", userId)
        .input("code", code)
        .input("expiresAt", expiresAt)
        .input("lastModified", lastModified).query(`
          INSERT INTO dbo.PasswordResets (UserID, Code, ExpiresAt, LastModified, Used)
          VALUES (@userId, @code, @expiresAt, @lastModified, 0)
        `);

      await sendPasswordResetEmail(normalizedEmail, code);
    } else {
      // Record OTP attempt for Twilio (use normalized email)
      await recordOTPAttempt(
        pool,
        userId,
        normalizedEmail,
        otpResult.verificationSid,
        "password_reset"
      );
    }

    res.status(200).json({
      success: true,
      message: "If an account exists, a reset code has been sent.",
      useTwilio: otpResult.success,
    });
  } catch (error) {
    logger.error("Forgot Password Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Something went wrong while sending reset code.",
    });
  }
});

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Reset password with code
 *     description: Reset user's password using the verification code from forgot-password
 *     tags: [Password]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPasswordRequest'
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid code or weak password
 *       404:
 *         description: User not found
 *       429:
 *         description: Rate limit exceeded
 */
router.post("/reset-password", checkAuthRateLimit, async (req, res) => {
  const { email, code, newPassword, useTwilio = false, resetToken } = req.body;
  const pool = getPool();

  // Normalize email to lowercase for case-insensitive matching
  const normalizedEmail = email.toLowerCase().trim();

  // Strong password validation matching frontend requirements
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters",
    });
  }

  const hasUpperCase = /[A-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSymbol = /[!@#$%^&*(),.?":{}|<>]/.test(newPassword);

  if (!hasUpperCase || !hasNumber || !hasSymbol) {
    return res.status(400).json({
      success: false,
      message:
        "Password must contain at least 1 uppercase letter, 1 number, and 1 symbol",
    });
  }

  // Get latest UserID for the email (before transaction, read-only)
  // Use LOWER() for backward compatibility with old accounts
  let userResult;
  try {
    userResult = await pool.request().input("email", normalizedEmail).query(`
        SELECT TOP 1 UserID, PasswordResetToken, PasswordResetExpires
        FROM dbo.UserLogin
        WHERE LOWER(Email) = @email
        ORDER BY UserID DESC
      `);
  } catch (error) {
    logger.error("Reset Password - User lookup error", { error: error.message });
    return res.status(500).json({
      success: false,
      message: "Something went wrong while resetting password.",
    });
  }

  if (userResult.recordset.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid reset attempt",
    });
  }

  const user = userResult.recordset[0];
  const userId = user.UserID;

  // Begin transaction for atomic password reset
  const transaction = pool.transaction();
  await transaction.begin();

  try {
    // Hash password before database operations
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Method 1: Verify using resetToken (from verify-email-otp endpoint)
    if (resetToken) {
      // Validate reset token (pre-check for better error messages)
      if (user.PasswordResetToken !== resetToken) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid or expired reset token",
        });
      }

      // Check if token has expired (pre-check for better error messages)
      if (
        user.PasswordResetExpires &&
        new Date(user.PasswordResetExpires) < new Date()
      ) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Reset token has expired. Please request a new code.",
        });
      }

      // ATOMIC: Update password AND clear token in single query with token verification
      // This prevents race conditions where two requests could both use the same token
      const updateRequest = new (require("mssql").Request)(transaction);
      const updateResult = await updateRequest
        .input("userId", userId)
        .input("password", hashedPassword)
        .input("resetToken", resetToken).query(`
          UPDATE dbo.UserLogin
          SET Password = @password,
              PasswordResetToken = NULL,
              PasswordResetExpires = NULL
          WHERE UserID = @userId
            AND PasswordResetToken = @resetToken
            AND (PasswordResetExpires IS NULL OR PasswordResetExpires > GETDATE())
        `);

      // Check if update succeeded (rowsAffected = 0 means token was already used)
      if (updateResult.rowsAffected[0] === 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message:
            "Reset token has already been used or expired. Please request a new code.",
          errorCode: "TOKEN_ALREADY_USED",
        });
      }
    }
    // Method 2: Verify OTP directly with Twilio (use normalized email)
    else if (useTwilio && code) {
      const verifyResult = await verifyEmailOTP(normalizedEmail, code);

      if (!verifyResult.success) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: verifyResult.error || "Invalid or expired reset code",
        });
      }

      // Update password inside transaction
      const updateRequest = new (require("mssql").Request)(transaction);
      await updateRequest
        .input("userId", userId)
        .input("password", hashedPassword).query(`
          UPDATE dbo.UserLogin
          SET Password = @password
          WHERE UserID = @userId
        `);

      await updateOTPStatus(
        pool,
        normalizedEmail,
        "password_reset",
        "approved",
        transaction
      );
    }
    // Method 3: Legacy verification with PasswordResets table
    else if (code) {
      // Clean up expired codes (outside transaction is fine, not critical)
      await pool
        .request()
        .query(`DELETE FROM dbo.PasswordResets WHERE ExpiresAt < GETDATE()`);

      // Check if valid code exists
      const checkRequest = new (require("mssql").Request)(transaction);
      const result = await checkRequest
        .input("userId", userId)
        .input("code", code).query(`
          SELECT *
          FROM dbo.PasswordResets
          WHERE UserID = @userId AND Code = @code AND Used = 0
        `);

      if (result.recordset.length === 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid or expired reset code",
        });
      }

      // ATOMIC: Mark code as used with verification in WHERE clause
      const markUsedRequest = new (require("mssql").Request)(transaction);
      const markResult = await markUsedRequest
        .input("userId", userId)
        .input("code", code).query(`
          UPDATE dbo.PasswordResets
          SET Used = 1
          WHERE UserID = @userId AND Code = @code AND Used = 0
        `);

      // Check if code was already used by another concurrent request
      if (markResult.rowsAffected[0] === 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message:
            "Reset code has already been used. Please request a new code.",
          errorCode: "CODE_ALREADY_USED",
        });
      }

      // Update password inside transaction
      const updateRequest = new (require("mssql").Request)(transaction);
      await updateRequest
        .input("userId", userId)
        .input("password", hashedPassword).query(`
          UPDATE dbo.UserLogin
          SET Password = @password
          WHERE UserID = @userId
        `);
    } else {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Verification code or reset token is required",
      });
    }

    // Commit transaction - all operations succeeded
    await transaction.commit();

    logger.debug("Password reset successful for user:", userId);

    res.status(200).json({
      success: true,
      message: "Password reset successful!",
    });
  } catch (error) {
    // Rollback transaction on any error
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      logger.error("Rollback error", { error: rollbackError.message });
    }
    logger.error("Reset Password Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Something went wrong while resetting password.",
    });
  }
});

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout user
 *     description: Revoke refresh token and invalidate all access tokens
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post("/logout", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();

    // Clear refresh token AND set TokenInvalidatedAt to invalidate all access tokens
    // Any access token issued before this timestamp will be rejected
    await pool.request().input("userId", userId).query(`
        UPDATE dbo.UserLogin
        SET RefreshToken = NULL, 
            RefreshTokenExpires = NULL,
            TokenInvalidatedAt = GETDATE()
        WHERE UserID = @userId
      `);

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    logger.error("Logout Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error during logout",
    });
  }
});

/**
 * @swagger
 * /auth/status:
 *   get:
 *     summary: Get authentication status
 *     description: Get current user's authentication settings and verification status
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Auth status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthStatus'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: User not found
 */
router.get("/status", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();

    const result = await pool.request().input("userId", userId).query(`
        SELECT L.Email, L.PreferredLoginMethod, L.MFAEnabled, L.MFAMethod, 
               L.BiometricEnabled, P.PhoneNumber, P.PhoneVerified
        FROM dbo.UserLogin L
        INNER JOIN dbo.UserProfile P ON L.UserID = P.UserID
        WHERE L.UserID = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.recordset[0];

    res.status(200).json({
      success: true,
      authStatus: {
        email: user.Email,
        phoneNumber: user.PhoneNumber,
        phoneVerified: user.PhoneVerified,
        preferredLoginMethod: user.PreferredLoginMethod,
        mfaEnabled: user.MFAEnabled,
        mfaMethod: user.MFAMethod,
        biometricEnabled: user.BiometricEnabled,
      },
    });
  } catch (error) {
    logger.error("Get Auth Status Error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error fetching auth status",
    });
  }
});

/**
 * @swagger
 * /auth/checkemail:
 *   get:
 *     summary: Check if email exists
 *     description: Check if an email address is already registered
 *     tags: [Authentication]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *         description: Email address to check
 *     responses:
 *       200:
 *         description: Email check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 exists:
 *                   type: boolean
 *       400:
 *         description: Email parameter required
 */
router.get("/checkemail", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res
      .status(400)
      .json({ message: "Email query parameter is required" });
  }

  try {
    // Normalize email to lowercase for case-insensitive matching
    const normalizedEmail = email.toLowerCase().trim();
    const pool = getPool();

    // Use LOWER() for backward compatibility with old accounts that may have uppercase emails
    const result = await pool
      .request()
      .input("email", normalizedEmail)
      .query(
        "SELECT COUNT(*) AS count FROM dbo.UserLogin WHERE LOWER(Email) = @email"
      );

    const exists = result.recordset[0].count > 0;
    return res.json({ exists });
  } catch (error) {
    logger.error("Error checking email", { error: error.message });
    res.status(500).json({ message: "Server error while checking email" });
  }
});

/**
 * @swagger
 * /auth/checkphone:
 *   get:
 *     summary: Check if phone number exists
 *     description: Check if a phone number is already registered and verified
 *     tags: [Authentication]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: phoneNumber
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number to check (E.164 format)
 *     responses:
 *       200:
 *         description: Phone check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 exists:
 *                   type: boolean
 *       400:
 *         description: Phone number parameter required
 */
router.get("/checkphone", async (req, res) => {
  const { phoneNumber } = req.query;

  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      message: "Phone number query parameter is required",
    });
  }

  try {
    const pool = getPool();

    const result = await pool.request().input("phoneNumber", phoneNumber)
      .query(`
        SELECT COUNT(*) AS count 
        FROM dbo.UserProfile 
        WHERE PhoneNumber = @phoneNumber AND PhoneVerified = 1
      `);

    const exists = result.recordset[0].count > 0;
    return res.json({
      success: true,
      exists,
    });
  } catch (error) {
    logger.error("Error checking phone", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Server error while checking phone number",
    });
  }
});

/**
 * @swagger
 * /auth/update-profile/{userId}:
 *   patch:
 *     summary: Update user profile
 *     description: Update user profile information. User can only update their own profile.
 *     tags: [Authentication]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID to update
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               firstname:
 *                 type: string
 *               lastname:
 *                 type: string
 *               gender:
 *                 type: string
 *               fitnessGoal:
 *                 type: string
 *               weight:
 *                 type: number
 *               height:
 *                 type: number
 *               fitnessLevel:
 *                 type: string
 *               age:
 *                 type: integer
 *               profileImage:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       403:
 *         description: Can only update own profile
 *       404:
 *         description: User not found
 */
router.patch(
  "/update-profile/:userId",
  authenticateToken,
  upload.single("profileImage"),
  async (req, res) => {
    const userId = req.params.userId;

    // Authorization check - user can only update their own profile
    if (req.user.userId !== parseInt(userId)) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own profile",
      });
    }

    const {
      lastname,
      firstname,
      gender,
      fitnessGoal,
      weight,
      height,
      bodyFat,
      muscle,
      fitnessLevel,
      age,
    } = req.body;

    const file = req.file;
    let profileImageUrl = null;

    try {
      if (file && containerClient) {
        const blobName = `profile_${userId}_${Date.now()}.jpg`;
        const blockBlobClient = containerClient.getBlockBlobClient(
          `profile-pictures/${blobName}`
        );

        await blockBlobClient.uploadData(file.buffer, {
          blobHTTPHeaders: { blobContentType: file.mimetype },
        });

        profileImageUrl = blockBlobClient.url;
      } else if (file && !containerClient) {
        logger.warn("Profile image upload skipped - Azure Blob Storage not configured");
      }

      const pool = await getPool();
      const request = pool.request();

      request.input("userId", userId);

      // Build dynamic SET clause - only update fields that are provided
      const setClauses = [];

      if (firstname !== undefined && firstname !== null) {
        request.input("firstname", firstname);
        setClauses.push("FirstName = @firstname");
      }
      if (lastname !== undefined && lastname !== null) {
        request.input("lastname", lastname);
        setClauses.push("LastName = @lastname");
      }
      if (gender !== undefined && gender !== null) {
        request.input("gender", gender);
        setClauses.push("Gender = @gender");
      }
      if (fitnessGoal !== undefined && fitnessGoal !== null) {
        request.input("fitnessGoal", fitnessGoal);
        setClauses.push("FitnessGoal = @fitnessGoal");
      }
      if (weight !== undefined && weight !== null && weight !== '') {
        request.input("weight", weight);
        setClauses.push("Weight = @weight");
      }
      if (height !== undefined && height !== null && height !== '') {
        request.input("height", height);
        setClauses.push("Height = @height");
      }
      if (bodyFat !== undefined && bodyFat !== null && bodyFat !== '') {
        request.input("bodyFat", bodyFat);
        setClauses.push("BodyFat = @bodyFat");
      }
      if (muscle !== undefined && muscle !== null && muscle !== '') {
        request.input("muscle", muscle);
        setClauses.push("Muscle = @muscle");
      }
      if (fitnessLevel !== undefined && fitnessLevel !== null) {
        request.input("fitnessLevel", fitnessLevel);
        setClauses.push("FitnessLevel = @fitnessLevel");
      }
      if (age !== undefined && age !== null && age !== '') {
        request.input("age", age);
        setClauses.push("Age = @age");
      }
      if (profileImageUrl) {
        request.input("profileImageUrl", profileImageUrl);
        setClauses.push("ProfileImageUrl = @profileImageUrl");
      }

      // Only run update if there are fields to update
      if (setClauses.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No fields to update.",
        });
      }

      const updateQuery = `
      UPDATE dbo.UserProfile
      SET ${setClauses.join(", ")}
      WHERE UserID = @userId
    `;

      await request.query(updateQuery);
      res.status(200).json({
        success: true,
        message: "User profile updated successfully.",
      });
    } catch (error) {
      logger.error("Update Profile Error", {
        error: error.message,
        requestBody: req.body,
        fileInfo: req.file,
      });
      res.status(500).json({
        success: false,
        message: "Error updating user profile",
      });
    }
  }
);

// --------------- DEVICE DATA ---------------

// --------------- OURA --------------
router.get("/oura/getCode/:userId", (req, res) => {
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

router.get('/oura/callback', async (req, res) => {
  console.log('[OuraCallback] Route hit');
  console.log('[OuraCallback] Query params:', req.query);

  const code = req.query.code;
  const userId = req.query.state;

  if (!code) {
    console.log('[OuraCallback] Missing code');
    return res.status(400).send('Missing code');
  }

  if (!userId) {
    console.log('[OuraCallback] Missing userId(state)');
    return res.status(400).send('Missing userId (state)');
  }

  try {
    console.log('[OuraToken] Exchanging code for token:', code);

    const tokenData = await exchangeCodeForToken(code);

    console.log('[OuraToken] Token response:', tokenData);

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;

    const pool = await getPool();

    await pool.request()
      .input('userId', userId)
      .input('accessToken', accessToken)
      .input('refreshToken', refreshToken)
      .query(`
        IF EXISTS (SELECT 1 FROM OuraTokens WHERE userId = @userId)
        BEGIN
          UPDATE OuraTokens
          SET 
            accessToken = @accessToken,
            refreshToken = @refreshToken,
            updatedAt = GETDATE()
          WHERE userId = @userId;
        END
        ELSE
        BEGIN
          INSERT INTO OuraTokens 
            (userId, accessToken, refreshToken, createdAt, updatedAt)
          VALUES 
            (@userId, @accessToken, @refreshToken, GETDATE(), GETDATE());
        END
      `);

    console.log('[OuraCallback] Token saved successfully');

    res.send('Oura connected successfully! You can close this window.');

  } catch (err) {
    console.error('[OuraCallback] Error exchanging code:', err);
    res.status(500).send('Error processing callback');
  }
});

// -------------------------------------------------------------------------

// ------------------- GARMIN -----------------------------------
router.get("/garmin/getCode/:userId", (req, res) => {
  const userId = req.params.userId;  // <-- userId comes from the route param

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  // 1. Generate PKCE values
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // 2. Store verifier for later
  const pool = getPool();
  const result = pool.request()
  .input("userId", userId)
  .input("codeVerifier", codeVerifier)
  .query(`
    MERGE GarminPKCE AS target
    USING (SELECT @userId AS UserID, @codeVerifier AS CodeVerifier) AS source
    ON target.UserID = source.UserID
    WHEN MATCHED THEN
      UPDATE SET CodeVerifier = source.CodeVerifier, CreatedAt = SYSDATETIME()
    WHEN NOT MATCHED THEN
      INSERT (UserID, CodeVerifier)
      VALUES (source.UserID, source.CodeVerifier);
  `);


  const base = "https://connect.garmin.com/oauth2Confirm";

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.GARMIN_CLIENT_ID,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: process.env.GARMIN_REDIRECT_URI,
    state: userId.toString() // <-- send your user ID
  });

  res.redirect(`${base}?${params.toString()}`);
});

router.get('/garmin/callback', async (req, res) => {
  console.log('[GarminCallback] Route hit');
  console.log('[GarminCallback] Query params:', req.query);

  const code = req.query.code;
  const userId = req.query.state;

  if (!code) {
    console.log('[GarminCallback] Missing code');
    return res.status(400).send('Missing code');
  }

  if (!userId) {
    console.log('[GarminCallback] Missing userId(state)');
    return res.status(400).send('Missing userId (state)');
  }

  try {
    console.log('[GarminToken] Exchanging code for token:', code);
    const pool = await getPool();

    const result = await pool.request()
    .input("userId", userId) // or `state` if you're using state as the key
    .query(`
    SELECT CodeVerifier
    FROM GarminPKCE
    WHERE UserID = @userId
    `);

    if (!result.recordset.length) {
      return res.status(400).send("Missing PKCE code verifier");
    }

    const codeVerifier = result.recordset[0].CodeVerifier;
    await pool.request()
      .input("userId", userId)
      .query(`
      DELETE FROM GarminPCKE
     WHERE UserID = @userId
    `);

    const tokenData = await exchangeGarminCodeForToken(code, constVerifier);

    console.log('[GarminToken] Token response:', tokenData);

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;

    await pool.request()
      .input('userId', userId)
      .input('accessToken', accessToken)
      .input('refreshToken', refreshToken)
      .query(`
        IF EXISTS (SELECT 1 FROM GarminTokens WHERE userId = @userId)
        BEGIN
          UPDATE GarminTokens
          SET 
            accessToken = @accessToken,
            refreshToken = @refreshToken,
            updatedAt = GETDATE()
          WHERE userId = @userId;
        END
        ELSE
        BEGIN
          INSERT INTO GarminTokens 
            (userId, accessToken, refreshToken, createdAt, updatedAt)
          VALUES 
            (@userId, @accessToken, @refreshToken, GETDATE(), GETDATE());
        END
      `);

    console.log('[GarminCallback] Token saved successfully');

    res.send('Garmin connected successfully! You can close this window.');

  } catch (err) {
    console.error('[GarminCallback] Error exchanging code:', err);
    res.status(500).send('Error processing callback');
  }
});

module.exports = router;
