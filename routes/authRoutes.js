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

const router = express.Router();

const upload = require("../middleware/multerUpload");
const { containerClient } = require("../middleware/blobClient");

// ============================================
// SIGN UP - Enhanced with phone number support
// ============================================
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

    // Validate phone number if provided
    if (phoneNumber && !isValidE164(phoneNumber)) {
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

    if (file && containerClient) {
      const blobName = `profile_${Date.now()}.jpg`;
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: { blobContentType: file.mimetype },
      });
      profileImageUrl = blockBlobClient.url;
    } else if (file && !containerClient) {
      console.warn(
        "Profile image upload skipped - Azure Blob Storage not configured"
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const pool = getPool();
    const currentDate = new Date();

    // Check if email already exists
    const existingUser = await pool
      .request()
      .input("email", email)
      .query(
        "SELECT COUNT(*) as count FROM dbo.UserLogin WHERE Email = @email"
      );

    if (existingUser.recordset[0].count > 0) {
      return res.status(409).json({
        success: false,
        message: "Email already registered",
      });
    }

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

      console.log("Phone verification check during signup:", {
        phoneNumber: phoneNumber.slice(-4),
        foundApprovedOTP: phoneVerified,
        recordCount: otpCheck.recordset.length,
      });
    }

    // Begin transaction
    const transaction = pool.transaction();
    await transaction.begin();

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
      .input("email", email)
      .input("password", hashedPassword)
      .input("createDate", currentDate)
      .input("preferredLoginMethod", preferredLoginMethod)
      .input("mfaEnabled", 0)
      .input("biometricEnabled", 0).query(`
        INSERT INTO dbo.UserLogin (UserID, Email, Password, CreateDate, PreferredLoginMethod, MFAEnabled, BiometricEnabled)
        VALUES (@userId, @email, @password, @createDate, @preferredLoginMethod, @mfaEnabled, @biometricEnabled)
      `);

    await transaction.commit();

    // Generate token pair
    const tokens = generateTokenPair({ userId });

    // Store refresh token in database
    const refreshTokenExpiry = getRefreshTokenExpiry();
    await pool
      .request()
      .input("userId", userId)
      .input("refreshToken", tokens.refreshToken)
      .input("refreshTokenExpires", refreshTokenExpiry).query(`
        UPDATE dbo.UserLogin 
        SET RefreshToken = @refreshToken, RefreshTokenExpires = @refreshTokenExpires
        WHERE UserID = @userId
      `);

    res.status(200).json({
      success: true,
      message: "User created successfully!",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      userId,
      user: {
        id: userId,
        email,
        phoneNumber,
        phoneVerified,
        preferredLoginMethod,
      },
    });
  } catch (error) {
    console.error("Signup Error:", error);
    res.status(500).json({
      success: false,
      message: "Error signing up user",
    });
  }
});

// ============================================
// SIGN IN - Enhanced with MFA support
// ============================================
router.post("/signin", checkAuthRateLimit, async (req, res) => {
  const { email, password } = req.body;

  try {
    const pool = getPool();

    const result = await pool.request().input("email", email).query(`
        SELECT 
          A.UserID, A.Email, A.Password, A.MFAEnabled, A.MFAMethod, 
          A.PreferredLoginMethod, A.BiometricEnabled,
          P.PhoneNumber, P.PhoneVerified
        FROM dbo.UserLogin A
        INNER JOIN dbo.UserProfile P ON A.UserID = P.UserID
        INNER JOIN (SELECT Email, MAX(UserID) as MaxUserID FROM dbo.UserLogin GROUP BY Email) B
          ON A.UserID = B.MaxUserID AND A.Email = B.Email
        WHERE A.Email = @email
      `);

    // Debug: Check for duplicate accounts
    const allAccounts = await pool.request().input("email", email).query(`
        SELECT UserID, Email, Password FROM dbo.UserLogin WHERE Email = @email ORDER BY UserID
      `);
    console.log("Signin attempt for email:", email);
    console.log(
      "Total accounts found with this email:",
      allAccounts.recordset.length
    );
    if (allAccounts.recordset.length > 1) {
      console.log("WARNING: Multiple accounts detected for email:", email);
      console.log(
        "Account UserIDs:",
        allAccounts.recordset.map((a) => a.UserID)
      );
    }

    if (result.recordset.length === 0) {
      console.log("No account found matching email (after MAX filter):", email);
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const user = result.recordset[0];
    console.log(
      "Found user for signin - UserID:",
      user.UserID,
      "Has password:",
      !!user.Password,
      "Password length:",
      user.Password?.length
    );

    const isPasswordMatch = await bcrypt.compare(password, user.Password);
    console.log("Password match result:", isPasswordMatch);

    if (!isPasswordMatch) {
      console.log("Password mismatch for UserID:", user.UserID);
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

      // Also store in OTPVerifications for tracking
      await pool
        .request()
        .input("userId", user.UserID)
        .input(
          "phoneOrEmail",
          user.MFAMethod === "sms" ? user.PhoneNumber : user.Email
        )
        .input("purpose", "mfa").query(`
          INSERT INTO dbo.OTPVerifications (UserID, PhoneOrEmail, Purpose, Status, ExpiresAt)
          VALUES (@userId, @phoneOrEmail, @purpose, 'pending', DATEADD(MINUTE, 10, SYSDATETIMEOFFSET()))
        `);

      // Send MFA code
      let otpResult;
      if (user.MFAMethod === "sms" && user.PhoneNumber) {
        otpResult = await sendPhoneOTP(user.PhoneNumber);
      } else {
        otpResult = await sendEmailOTP(user.Email);
      }

      if (!otpResult.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to send MFA code",
          error: otpResult.error,
        });
      }

      return res.status(200).json({
        success: true,
        message: "MFA code sent",
        mfaRequired: true,
        mfaMethod: user.MFAMethod,
        mfaSessionToken,
        userId: user.UserID,
      });
    }

    // No MFA required - generate tokens
    const tokens = generateTokenPair({ userId: user.UserID });

    // Store refresh token
    const refreshTokenExpiry = getRefreshTokenExpiry();
    await pool
      .request()
      .input("userId", user.UserID)
      .input("refreshToken", tokens.refreshToken)
      .input("refreshTokenExpires", refreshTokenExpiry).query(`
        UPDATE dbo.UserLogin 
        SET RefreshToken = @refreshToken, RefreshTokenExpires = @refreshTokenExpires
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
    console.error("Signin Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
});

// ============================================
// REFRESH TOKEN - Exchange refresh token for new tokens
// ============================================
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
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
        errorCode: "TOKEN_INVALID",
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

    // Update refresh token in database
    await pool
      .request()
      .input("userId", userId)
      .input("refreshToken", tokens.refreshToken)
      .input("refreshTokenExpires", refreshTokenExpiry).query(`
        UPDATE dbo.UserLogin 
        SET RefreshToken = @refreshToken, RefreshTokenExpires = @refreshTokenExpires
        WHERE UserID = @userId
      `);

    res.status(200).json({
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    });
  } catch (error) {
    console.error("Refresh Token Error:", error);
    res.status(500).json({
      success: false,
      message: "Error refreshing token",
    });
  }
});

// ============================================
// SEND PHONE OTP - Initiate phone verification
// ============================================
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
        console.log("Phone signin failed - phone not registered:", {
          phoneNumber: phoneNumber.slice(-4),
        });
        return res.status(404).json({
          success: false,
          message: "Phone number not registered",
        });
      }

      const user = userResult.recordset[0];
      console.log("Phone signin check:", {
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
        console.log(
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
          console.log(
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
        console.log("Phone signin failed - phone not verified:", {
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
    console.error("Send Phone OTP Error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending verification code",
    });
  }
});

// ============================================
// VERIFY PHONE OTP - Verify code and sign in
// ============================================
router.post("/verify-phone-otp", checkAuthRateLimit, async (req, res) => {
  const { phoneNumber, code, purpose = "signin" } = req.body;

  try {
    console.log("Verify phone OTP request:", {
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
      console.log("Phone OTP verification failed:", {
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

    console.log("Phone OTP verified successfully:", {
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
      console.log(
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

      // Store refresh token
      await pool
        .request()
        .input("userId", user.UserID)
        .input("refreshToken", tokens.refreshToken)
        .input("refreshTokenExpires", refreshTokenExpiry).query(`
          UPDATE dbo.UserLogin 
          SET RefreshToken = @refreshToken, RefreshTokenExpires = @refreshTokenExpires
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
    console.error("Verify Phone OTP Error:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying code",
    });
  }
});

// ============================================
// VERIFY PHONE NUMBER - For existing authenticated users
// ============================================
router.post("/verify-phone-number", authenticateToken, async (req, res) => {
  const { phoneNumber, code } = req.body;
  const userId = req.user.userId;

  try {
    // If code is provided, verify it
    if (code) {
      const verifyResult = await verifyPhoneOTP(phoneNumber, code);

      if (!verifyResult.success) {
        console.log("Phone number verification failed:", {
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
    console.error("Verify Phone Number Error:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying phone number",
    });
  }
});

// ============================================
// SEND MFA CODE - Send MFA code during login
// ============================================
router.post("/send-mfa-code", async (req, res) => {
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
    console.error("Send MFA Code Error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending MFA code",
    });
  }
});

// ============================================
// VERIFY MFA LOGIN - Complete MFA verification during login flow
// Validates the mfaSessionToken from signin response
// ============================================
router.post("/verify-mfa-login", async (req, res) => {
  const { mfaSessionToken, code, userId } = req.body;

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
      // Clear expired session
      await pool.request().input("userId", userId).query(`
        UPDATE dbo.UserLogin 
        SET MFASessionToken = NULL, MFASessionExpires = NULL
        WHERE UserID = @userId
      `);
      return res.status(401).json({
        success: false,
        message: "MFA session expired. Please sign in again.",
        errorCode: "MFA_SESSION_EXPIRED",
      });
    }

    const mfaMethod = user.MFAMethod || "email";
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
        errorCode: "OTP_INVALID",
      });
    }

    // Record successful MFA verification
    await recordMFAVerification(pool, userId, mfaMethod);
    await updateOTPStatus(pool, destination, "mfa", "approved");

    // Clear MFA session token (one-time use)
    await pool.request().input("userId", userId).query(`
      UPDATE dbo.UserLogin 
      SET MFASessionToken = NULL, MFASessionExpires = NULL
      WHERE UserID = @userId
    `);

    // Generate tokens
    const tokens = generateTokenPair({ userId: user.UserID });
    const refreshTokenExpiry = getRefreshTokenExpiry();

    // Store refresh token
    await pool
      .request()
      .input("userId", user.UserID)
      .input("refreshToken", tokens.refreshToken)
      .input("refreshTokenExpires", refreshTokenExpiry).query(`
        UPDATE dbo.UserLogin 
        SET RefreshToken = @refreshToken, RefreshTokenExpires = @refreshTokenExpires
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
    console.error("Verify MFA Login Error:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying MFA code",
    });
  }
});

// ============================================
// VERIFY MFA CODE - Complete MFA verification (legacy endpoint)
// ============================================
router.post("/verify-mfa-code", async (req, res) => {
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

    // Store refresh token
    await pool
      .request()
      .input("userId", user.UserID)
      .input("refreshToken", tokens.refreshToken)
      .input("refreshTokenExpires", refreshTokenExpiry).query(`
        UPDATE dbo.UserLogin 
        SET RefreshToken = @refreshToken, RefreshTokenExpires = @refreshTokenExpires
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
    console.error("Verify MFA Code Error:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying MFA code",
    });
  }
});

// ============================================
// SETUP MFA - Enable MFA for user account
// ============================================
router.post("/setup-mfa", authenticateToken, async (req, res) => {
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
      message: "Verification code sent. Enter the code to complete MFA setup.",
      method,
    });
  } catch (error) {
    console.error("Setup MFA Error:", error);
    res.status(500).json({
      success: false,
      message: "Error setting up MFA",
    });
  }
});

// ============================================
// ENABLE MFA DIRECT - Enable MFA without additional verification
// Use when phone/email was already verified (e.g., during signup)
// ============================================
router.post("/enable-mfa-direct", authenticateToken, async (req, res) => {
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
    await pool.request().input("userId", userId).input("method", method).query(`
        UPDATE dbo.UserLogin
        SET MFAEnabled = 1, MFAMethod = @method
        WHERE UserID = @userId
      `);

    console.log(
      `MFA enabled directly for user ${userId} with method: ${method}`
    );

    res.status(200).json({
      success: true,
      message: "MFA enabled successfully",
      mfaEnabled: true,
      mfaMethod: method,
    });
  } catch (error) {
    console.error("Enable MFA Direct Error:", error);
    res.status(500).json({
      success: false,
      message: "Error enabling MFA",
    });
  }
});

// ============================================
// DISABLE MFA - Remove MFA from account
// ============================================
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
      console.error("Disable MFA Error:", error);
      res.status(500).json({
        success: false,
        message: "Error disabling MFA",
      });
    }
  }
);

// ============================================
// UPDATE LOGIN PREFERENCE
// ============================================
router.patch(
  "/update-login-preference",
  authenticateToken,
  async (req, res) => {
    const { preferredLoginMethod } = req.body;
    const userId = req.user.userId;

    try {
      const validMethods = ["email", "phone", "biometric"];
      if (!validMethods.includes(preferredLoginMethod)) {
        return res.status(400).json({
          success: false,
          message: "Invalid login method. Must be email, phone, or biometric",
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

      // If biometric, verify biometric is enabled
      if (preferredLoginMethod === "biometric") {
        const biometricCheck = await pool.request().input("userId", userId)
          .query(`
          SELECT BiometricEnabled FROM dbo.UserLogin WHERE UserID = @userId
        `);

        if (!biometricCheck.recordset[0]?.BiometricEnabled) {
          return res.status(400).json({
            success: false,
            message:
              "Biometric authentication must be enabled before setting as preferred login method",
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
      console.error("Update Login Preference Error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating login preference",
      });
    }
  }
);

// ============================================
// ENABLE BIOMETRIC - Store biometric token
// ============================================
router.post("/enable-biometric", authenticateToken, async (req, res) => {
  const { biometricToken } = req.body;
  const userId = req.user.userId;

  try {
    if (!biometricToken) {
      return res.status(400).json({
        success: false,
        message: "Biometric token is required",
      });
    }

    const pool = getPool();

    // Hash the biometric token before storing
    const hashedToken = await bcrypt.hash(biometricToken, 12);

    await pool
      .request()
      .input("userId", userId)
      .input("biometricToken", hashedToken).query(`
        UPDATE dbo.UserLogin
        SET BiometricEnabled = 1, BiometricToken = @biometricToken
        WHERE UserID = @userId
      `);

    res.status(200).json({
      success: true,
      message: "Biometric authentication enabled",
    });
  } catch (error) {
    console.error("Enable Biometric Error:", error);
    res.status(500).json({
      success: false,
      message: "Error enabling biometric authentication",
    });
  }
});

// ============================================
// BIOMETRIC LOGIN - Verify biometric and sign in
// ============================================
router.post("/biometric-login", checkAuthRateLimit, async (req, res) => {
  const { userId, biometricToken } = req.body;

  try {
    if (!userId || !biometricToken) {
      return res.status(400).json({
        success: false,
        message: "User ID and biometric token are required",
      });
    }

    const pool = getPool();

    // Get user and biometric token
    const result = await pool.request().input("userId", userId).query(`
        SELECT L.UserID, L.Email, L.BiometricEnabled, L.BiometricToken,
               L.PreferredLoginMethod, L.MFAEnabled,
               P.PhoneNumber, P.PhoneVerified
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

    if (!user.BiometricEnabled || !user.BiometricToken) {
      return res.status(400).json({
        success: false,
        message: "Biometric authentication not enabled for this account",
      });
    }

    // Verify biometric token
    const isTokenValid = await bcrypt.compare(
      biometricToken,
      user.BiometricToken
    );

    if (!isTokenValid) {
      return res.status(401).json({
        success: false,
        message: "Biometric verification failed",
      });
    }

    // Reset rate limit on success
    resetAuthRateLimit(req);

    // Generate tokens
    const tokens = generateTokenPair({ userId: user.UserID });
    const refreshTokenExpiry = getRefreshTokenExpiry();

    // Store refresh token
    await pool
      .request()
      .input("userId", user.UserID)
      .input("refreshToken", tokens.refreshToken)
      .input("refreshTokenExpires", refreshTokenExpiry).query(`
        UPDATE dbo.UserLogin 
        SET RefreshToken = @refreshToken, RefreshTokenExpires = @refreshTokenExpires
        WHERE UserID = @userId
      `);

    res.status(200).json({
      success: true,
      message: "Biometric login successful",
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
    console.error("Biometric Login Error:", error);
    res.status(500).json({
      success: false,
      message: "Error during biometric login",
    });
  }
});

// ============================================
// DISABLE BIOMETRIC
// ============================================
router.post("/disable-biometric", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();

    // Check if biometric is the preferred login method
    const userResult = await pool.request().input("userId", userId).query(`
        SELECT PreferredLoginMethod FROM dbo.UserLogin WHERE UserID = @userId
      `);

    if (userResult.recordset[0]?.PreferredLoginMethod === "biometric") {
      // Reset to email as default
      await pool.request().input("userId", userId).query(`
          UPDATE dbo.UserLogin
          SET BiometricEnabled = 0, BiometricToken = NULL, PreferredLoginMethod = 'email'
          WHERE UserID = @userId
        `);
    } else {
      await pool.request().input("userId", userId).query(`
          UPDATE dbo.UserLogin
          SET BiometricEnabled = 0, BiometricToken = NULL
          WHERE UserID = @userId
        `);
    }

    res.status(200).json({
      success: true,
      message: "Biometric authentication disabled",
    });
  } catch (error) {
    console.error("Disable Biometric Error:", error);
    res.status(500).json({
      success: false,
      message: "Error disabling biometric authentication",
    });
  }
});

// ============================================
// SEND EMAIL OTP - Send verification code via email (Twilio Verify)
// Used for password reset and other email verification flows
// ============================================
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

    const pool = getPool();

    // For password_reset, check if user exists (but don't reveal this in error)
    let userId = null;
    if (purpose === "password_reset") {
      const userResult = await pool.request().input("email", email).query(`
        SELECT TOP 1 UserID
        FROM dbo.UserLogin
        WHERE Email = @email
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

    // Check rate limit
    const rateLimitResult = await checkRateLimit(pool, userId, email, purpose);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: rateLimitResult.error,
        remainingAttempts: 0,
      });
    }

    // Send OTP via Twilio
    const otpResult = await sendEmailOTP(email);

    if (!otpResult.success) {
      console.error("Failed to send email OTP:", otpResult.error);
      return res.status(500).json({
        success: false,
        message: otpResult.error || "Failed to send verification code",
      });
    }

    // Record OTP attempt
    await recordOTPAttempt(
      pool,
      userId,
      email,
      otpResult.verificationSid,
      purpose
    );

    console.log("Email OTP sent successfully:", {
      email: email.substring(0, 3) + "***",
      purpose,
      verificationSid: otpResult.verificationSid,
    });

    res.status(200).json({
      success: true,
      message: "Verification code sent successfully",
      remainingAttempts: rateLimitResult.remainingAttempts - 1,
    });
  } catch (error) {
    console.error("Send Email OTP Error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending verification code",
    });
  }
});

// ============================================
// VERIFY EMAIL OTP - Verify email verification code (Twilio Verify)
// Used for password reset and other email verification flows
// ============================================
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

    // Verify OTP with Twilio
    const verifyResult = await verifyEmailOTP(email, code);

    if (!verifyResult.success) {
      console.log("Email OTP verification failed:", {
        email: email.substring(0, 3) + "***",
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

    // Update OTP status
    await updateOTPStatus(pool, email, purpose, "approved");

    // Reset rate limit on success
    resetAuthRateLimit(req);

    console.log("Email OTP verified successfully:", {
      email: email.substring(0, 3) + "***",
      purpose,
    });

    // For password_reset, return a token that can be used to reset the password
    if (purpose === "password_reset") {
      // Get user ID for the email
      const userResult = await pool.request().input("email", email).query(`
        SELECT TOP 1 UserID
        FROM dbo.UserLogin
        WHERE Email = @email
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

    res.status(200).json({
      success: true,
      message: "Email verified successfully",
      verified: true,
    });
  } catch (error) {
    console.error("Verify Email OTP Error:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying code",
    });
  }
});

// ============================================
// FORGOT PASSWORD - Updated to use Twilio
// ============================================
router.post("/forgot-password", checkAuthRateLimit, async (req, res) => {
  const { email } = req.body;
  const pool = getPool();

  try {
    // Get latest UserID for the email
    const userResult = await pool.request().input("email", email).query(`
        SELECT TOP 1 UserID
        FROM dbo.UserLogin
        WHERE Email = @email
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

    // Check rate limit
    const rateLimitResult = await checkRateLimit(
      pool,
      userId,
      email,
      "password_reset"
    );
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: rateLimitResult.error,
      });
    }

    // Send OTP via Twilio
    const otpResult = await sendEmailOTP(email);

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

      await sendPasswordResetEmail(email, code);
    } else {
      // Record OTP attempt for Twilio
      await recordOTPAttempt(
        pool,
        userId,
        email,
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
    console.error("Forgot Password Error:", error);
    res.status(500).json({
      success: false,
      message: "Something went wrong while sending reset code.",
    });
  }
});

// ============================================
// RESET PASSWORD - Updated to support Twilio OTP and reset token
// ============================================
router.post("/reset-password", async (req, res) => {
  const { email, code, newPassword, useTwilio = false, resetToken } = req.body;
  const pool = getPool();

  try {
    // Validate new password
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // Get latest UserID for the email
    const userResult = await pool.request().input("email", email).query(`
        SELECT TOP 1 UserID, PasswordResetToken, PasswordResetExpires
        FROM dbo.UserLogin
        WHERE Email = @email
        ORDER BY UserID DESC
      `);

    if (userResult.recordset.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset attempt",
      });
    }

    const user = userResult.recordset[0];
    const userId = user.UserID;

    // Method 1: Verify using resetToken (from verify-email-otp endpoint)
    if (resetToken) {
      // Validate reset token
      if (user.PasswordResetToken !== resetToken) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired reset token",
        });
      }

      // Check if token has expired
      if (
        user.PasswordResetExpires &&
        new Date(user.PasswordResetExpires) < new Date()
      ) {
        return res.status(400).json({
          success: false,
          message: "Reset token has expired. Please request a new code.",
        });
      }

      // Clear the reset token after use
      await pool.request().input("userId", userId).query(`
        UPDATE dbo.UserLogin
        SET PasswordResetToken = NULL, PasswordResetExpires = NULL
        WHERE UserID = @userId
      `);
    }
    // Method 2: Verify OTP directly with Twilio
    else if (useTwilio && code) {
      const verifyResult = await verifyEmailOTP(email, code);

      if (!verifyResult.success) {
        return res.status(400).json({
          success: false,
          message: verifyResult.error || "Invalid or expired reset code",
        });
      }

      await updateOTPStatus(pool, email, "password_reset", "approved");
    }
    // Method 3: Legacy verification with PasswordResets table
    else if (code) {
      await pool
        .request()
        .query(`DELETE FROM dbo.PasswordResets WHERE ExpiresAt < GETDATE()`);

      const result = await pool
        .request()
        .input("userId", userId)
        .input("code", code).query(`
          SELECT *
          FROM dbo.PasswordResets
          WHERE UserID = @userId AND Code = @code AND Used = 0
        `);

      if (result.recordset.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired reset code",
        });
      }

      // Mark code as used
      await pool.request().input("userId", userId).input("code", code).query(`
          UPDATE dbo.PasswordResets
          SET Used = 1
          WHERE UserID = @userId AND Code = @code
        `);
    } else {
      return res.status(400).json({
        success: false,
        message: "Verification code or reset token is required",
      });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await pool
      .request()
      .input("userId", userId)
      .input("password", hashedPassword).query(`
        UPDATE dbo.UserLogin
        SET Password = @password
        WHERE UserID = @userId
      `);

    console.log("Password reset successful for user:", userId);

    res.status(200).json({
      success: true,
      message: "Password reset successful!",
    });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({
      success: false,
      message: "Something went wrong while resetting password.",
    });
  }
});

// ============================================
// LOGOUT - Revoke refresh token
// ============================================
router.post("/logout", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();

    // Clear refresh token
    await pool.request().input("userId", userId).query(`
        UPDATE dbo.UserLogin
        SET RefreshToken = NULL, RefreshTokenExpires = NULL
        WHERE UserID = @userId
      `);

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout Error:", error);
    res.status(500).json({
      success: false,
      message: "Error during logout",
    });
  }
});

// ============================================
// GET AUTH STATUS - Get current user auth settings
// ============================================
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
    console.error("Get Auth Status Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching auth status",
    });
  }
});

// ============================================
// CHECK EMAIL (existing endpoint)
// ============================================
router.get("/checkemail", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res
      .status(400)
      .json({ message: "Email query parameter is required" });
  }

  try {
    const pool = getPool();

    const result = await pool
      .request()
      .input("email", email)
      .query(
        "SELECT COUNT(*) AS count FROM dbo.UserLogin WHERE Email = @email"
      );

    const exists = result.recordset[0].count > 0;
    return res.json({ exists });
  } catch (error) {
    console.error("Error checking email:", error);
    res.status(500).json({ message: "Server error while checking email" });
  }
});

// ============================================
// CHECK PHONE - Check if phone number is registered
// ============================================
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
    console.error("Error checking phone:", error);
    res.status(500).json({
      success: false,
      message: "Server error while checking phone number",
    });
  }
});

// ============================================
// UPDATE PROFILE (existing endpoint with minor updates)
// ============================================
router.patch(
  "/update-profile/:userId",
  upload.single("profileImage"),
  async (req, res) => {
    const userId = req.params.userId;
    const {
      lastname,
      firstname,
      gender,
      fitnessGoal,
      weight,
      height,
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
        console.warn(
          "Profile image upload skipped - Azure Blob Storage not configured"
        );
      }

      const pool = await getPool();
      const request = pool.request();

      request.input("userId", userId);
      request.input("firstname", firstname);
      request.input("lastname", lastname);
      request.input("gender", gender);
      request.input("fitnessGoal", fitnessGoal);
      request.input("weight", weight);
      request.input("height", height);
      request.input("fitnessLevel", fitnessLevel);
      request.input("age", age);
      if (profileImageUrl) {
        request.input("profileImageUrl", profileImageUrl);
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
        ${profileImageUrl ? ", ProfileImageUrl = @profileImageUrl" : ""}
      WHERE UserID = @userId
    `;

      await request.query(updateQuery);
      res.status(200).json({
        success: true,
        message: "User profile updated successfully.",
      });
    } catch (error) {
      console.error("Update Profile Error:", {
        message: error.message,
        stack: error.stack,
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

// ============================================
// USER PROFILE UPDATE (existing endpoint)
// ============================================
router.patch("/user/profile/:userId", authenticateToken, async (req, res) => {
  const userId = req.params.userId;
  const fields = req.body;

  const allowedFields = [
    "FirstName",
    "LastName",
    "Gender",
    "FitnessGoal",
    "Weight",
    "Height",
    "FitnessLevel",
    "Age",
    "ProfileImageURL",
  ];

  const validKeys = Object.keys(fields).filter((key) =>
    allowedFields.includes(key)
  );
  console.log("Allowed updates:", validKeys);

  const pool = getPool();
  const request = pool.request().input("userId", userId);

  const updates = validKeys
    .map((key) => {
      request.input(key, fields[key]);
      return `${key} = @${key}`;
    })
    .join(", ");

  if (!updates) {
    return res.status(400).json({
      success: false,
      message: "No valid fields to update",
    });
  }

  try {
    await request.query(
      `UPDATE dbo.UserProfile SET ${updates} WHERE UserID = @userId`
    );
    res.status(200).json({
      success: true,
      message: "User profile updated",
    });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({
      success: false,
      message: "Failed to update user profile",
    });
  }
});

module.exports = router;
