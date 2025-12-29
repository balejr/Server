// utils/twilioService.js
// Twilio Verify service utility for OTP management

const twilio = require("twilio");

// Initialize Twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

let client;

/**
 * Initialize Twilio client (lazy initialization)
 */
const getClient = () => {
  if (!client) {
    if (!accountSid || !authToken) {
      throw new Error("Twilio credentials not configured");
    }
    client = twilio(accountSid, authToken);
  }
  return client;
};

/**
 * Validate phone number format (E.164)
 * @param {string} phoneNumber - Phone number to validate
 * @returns {boolean} - Whether the phone number is valid
 */
const isValidE164 = (phoneNumber) => {
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(phoneNumber);
};

/**
 * Send OTP via SMS to a phone number
 * @param {string} phoneNumber - Phone number in E.164 format (e.g., +12345678900)
 * @returns {Promise<{success: boolean, verificationSid?: string, error?: string}>}
 */
const sendPhoneOTP = async (phoneNumber) => {
  try {
    // Validate phone number format
    if (!isValidE164(phoneNumber)) {
      return {
        success: false,
        error:
          "Invalid phone number format. Use E.164 format (e.g., +12345678900)",
      };
    }

    const twilioClient = getClient();

    const verification = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .verifications.create({
        to: phoneNumber,
        channel: "sms",
      });

    return {
      success: true,
      verificationSid: verification.sid,
      status: verification.status,
    };
  } catch (error) {
    console.error("Twilio sendPhoneOTP error:", error);

    // Handle specific Twilio errors
    if (error.code === 60200) {
      return { success: false, error: "Invalid phone number" };
    }
    if (error.code === 60203) {
      return {
        success: false,
        error: "Max verification attempts reached. Please try again later.",
      };
    }
    if (error.code === 60202) {
      return {
        success: false,
        error:
          "Rate limit exceeded. Please wait before requesting another code.",
      };
    }

    return {
      success: false,
      error: error.message || "Failed to send verification code",
    };
  }
};

/**
 * Verify phone OTP code
 * @param {string} phoneNumber - Phone number in E.164 format
 * @param {string} code - 6-digit verification code
 * @returns {Promise<{success: boolean, status?: string, error?: string}>}
 */
const verifyPhoneOTP = async (phoneNumber, code) => {
  try {
    // Validate inputs
    if (!isValidE164(phoneNumber)) {
      return {
        success: false,
        error: "Invalid phone number format",
      };
    }

    if (!code || !/^\d{6}$/.test(code)) {
      return {
        success: false,
        error: "Invalid verification code format. Must be 6 digits.",
      };
    }

    const twilioClient = getClient();

    const verificationCheck = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .verificationChecks.create({
        to: phoneNumber,
        code: code,
      });

    if (verificationCheck.status === "approved") {
      return {
        success: true,
        status: "approved",
      };
    }

    return {
      success: false,
      status: verificationCheck.status,
      error: "Invalid verification code",
    };
  } catch (error) {
    console.error("Twilio verifyPhoneOTP error:", {
      code: error.code,
      message: error.message,
      status: error.status,
      moreInfo: error.moreInfo,
    });

    // Handle specific Twilio errors
    if (error.code === 20404) {
      return {
        success: false,
        error:
          "Verification expired or already used. Please request a new code.",
      };
    }
    if (error.code === 60202) {
      return {
        success: false,
        error: "Max verification attempts reached. Please request a new code.",
      };
    }
    if (error.code === 60200) {
      return { success: false, error: "Invalid verification code" };
    }
    // Handle Twilio authentication errors
    if (error.code === 20003 || error.status === 401) {
      console.error("Twilio authentication failed - check TWILIO_AUTH_TOKEN");
      return {
        success: false,
        error:
          "Verification service temporarily unavailable. Please try again.",
      };
    }

    return {
      success: false,
      error: "Invalid verification code. Please check the code and try again.",
    };
  }
};

/**
 * Send OTP via email
 * @param {string} email - Email address to send OTP to
 * @returns {Promise<{success: boolean, verificationSid?: string, error?: string}>}
 */
const sendEmailOTP = async (email) => {
  try {
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        success: false,
        error: "Invalid email format",
      };
    }

    const twilioClient = getClient();

    const verification = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .verifications.create({
        to: email,
        channel: "email",
      });

    return {
      success: true,
      verificationSid: verification.sid,
      status: verification.status,
    };
  } catch (error) {
    console.error("Twilio sendEmailOTP error:", error);

    if (error.code === 60203) {
      return {
        success: false,
        error: "Max verification attempts reached. Please try again later.",
      };
    }
    if (error.code === 60202) {
      return {
        success: false,
        error:
          "Rate limit exceeded. Please wait before requesting another code.",
      };
    }

    return {
      success: false,
      error: error.message || "Failed to send email verification code",
    };
  }
};

/**
 * Verify email OTP code
 * @param {string} email - Email address
 * @param {string} code - 6-digit verification code
 * @returns {Promise<{success: boolean, status?: string, error?: string}>}
 */
const verifyEmailOTP = async (email, code) => {
  try {
    // Validate inputs
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        success: false,
        error: "Invalid email format",
      };
    }

    if (!code || !/^\d{6}$/.test(code)) {
      return {
        success: false,
        error: "Invalid verification code format. Must be 6 digits.",
      };
    }

    const twilioClient = getClient();

    const verificationCheck = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .verificationChecks.create({
        to: email,
        code: code,
      });

    if (verificationCheck.status === "approved") {
      return {
        success: true,
        status: "approved",
      };
    }

    return {
      success: false,
      status: verificationCheck.status,
      error: "Invalid verification code",
    };
  } catch (error) {
    console.error("Twilio verifyEmailOTP error:", error);

    if (error.code === 20404) {
      return {
        success: false,
        error:
          "Verification expired or already used. Please request a new code.",
      };
    }
    if (error.code === 60202) {
      return {
        success: false,
        error: "Max verification attempts reached. Please request a new code.",
      };
    }

    return {
      success: false,
      error: error.message || "Failed to verify code",
    };
  }
};

/**
 * Check rate limiting for a user/destination
 * @param {object} pool - Database pool
 * @param {number} userId - User ID (can be 0 for anonymous)
 * @param {string} phoneOrEmail - Phone or email to check
 * @param {string} purpose - Purpose of OTP
 * @returns {Promise<{allowed: boolean, remainingAttempts?: number, error?: string}>}
 */
const checkRateLimit = async (pool, userId, phoneOrEmail, purpose) => {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const result = await pool
      .request()
      .input("phoneOrEmail", phoneOrEmail)
      .input("purpose", purpose)
      .input("oneHourAgo", oneHourAgo).query(`
        SELECT COUNT(*) as attemptCount
        FROM dbo.OTPVerifications
        WHERE PhoneOrEmail = @phoneOrEmail
          AND Purpose = @purpose
          AND CreatedAt > @oneHourAgo
      `);

    const attemptCount = result.recordset[0].attemptCount;
    const maxAttempts = 100; // TODO: Change back to 3 for production

    if (attemptCount >= maxAttempts) {
      return {
        allowed: false,
        remainingAttempts: 0,
        error: `Rate limit exceeded. You can request ${maxAttempts} codes per hour. Please try again later.`,
      };
    }

    return {
      allowed: true,
      remainingAttempts: maxAttempts - attemptCount,
    };
  } catch (error) {
    console.error("Rate limit check error:", error);
    // On error, allow the request to proceed
    return { allowed: true, remainingAttempts: 3 };
  }
};

/**
 * Record OTP verification attempt in database
 * @param {object} pool - Database pool
 * @param {number} userId - User ID
 * @param {string} phoneOrEmail - Phone or email
 * @param {string} verificationSid - Twilio verification SID
 * @param {string} purpose - Purpose of OTP
 * @returns {Promise<void>}
 */
const recordOTPAttempt = async (
  pool,
  userId,
  phoneOrEmail,
  verificationSid,
  purpose
) => {
  try {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool
      .request()
      .input("userId", userId)
      .input("phoneOrEmail", phoneOrEmail)
      .input("verificationSid", verificationSid)
      .input("purpose", purpose)
      .input("expiresAt", expiresAt).query(`
        INSERT INTO dbo.OTPVerifications 
        (UserID, PhoneOrEmail, VerificationSID, Purpose, Status, ExpiresAt, AttemptCount)
        VALUES (@userId, @phoneOrEmail, @verificationSid, @purpose, 'pending', @expiresAt, 0)
      `);
  } catch (error) {
    console.error("Record OTP attempt error:", error);
    // Non-critical error, don't throw
  }
};

/**
 * Update OTP verification status in database
 * @param {object} pool - Database pool
 * @param {string} phoneOrEmail - Phone or email
 * @param {string} purpose - Purpose of OTP
 * @param {string} status - New status ('approved', 'failed', 'expired')
 * @returns {Promise<void>}
 */
const updateOTPStatus = async (pool, phoneOrEmail, purpose, status) => {
  try {
    // First try to update with exact purpose match
    const result = await pool
      .request()
      .input("phoneOrEmail", phoneOrEmail)
      .input("purpose", purpose)
      .input("status", status).query(`
        UPDATE dbo.OTPVerifications
        SET Status = @status,
            AttemptCount = AttemptCount + 1
        WHERE PhoneOrEmail = @phoneOrEmail
          AND Purpose = @purpose
          AND Status = 'pending'
      `);

    // If no rows affected, try with related purposes
    if (result.rowsAffected[0] === 0) {
      // For signup-related purposes, also check related variants
      if (
        purpose === "signup" ||
        purpose === "verification" ||
        purpose === "phone_verify"
      ) {
        const fallbackResult = await pool
          .request()
          .input("phoneOrEmail", phoneOrEmail)
          .input("status", status).query(`
            UPDATE dbo.OTPVerifications
            SET Status = @status,
                AttemptCount = AttemptCount + 1
            WHERE PhoneOrEmail = @phoneOrEmail
              AND Purpose IN ('signup', 'verification', 'phone_verify')
              AND Status = 'pending'
          `);

        console.log("OTP status update (fallback):", {
          phoneOrEmail: phoneOrEmail.includes("@")
            ? phoneOrEmail
            : phoneOrEmail.slice(-4),
          purpose,
          newStatus: status,
          rowsAffected: fallbackResult.rowsAffected[0],
        });
      }
    } else {
      console.log("OTP status update result:", {
        phoneOrEmail: phoneOrEmail.includes("@")
          ? phoneOrEmail
          : phoneOrEmail.slice(-4),
        purpose,
        newStatus: status,
        rowsAffected: result.rowsAffected[0],
      });
    }
  } catch (error) {
    console.error("Update OTP status error:", error);
  }
};

/**
 * Clean up expired OTP records
 * @param {object} pool - Database pool
 * @returns {Promise<number>} - Number of records deleted
 */
const cleanupExpiredOTPs = async (pool) => {
  try {
    const result = await pool.request().query(`
        DELETE FROM dbo.OTPVerifications
        WHERE ExpiresAt < SYSDATETIMEOFFSET()
          OR Status IN ('approved', 'expired', 'failed')
      `);

    return result.rowsAffected[0];
  } catch (error) {
    console.error("Cleanup expired OTPs error:", error);
    return 0;
  }
};

module.exports = {
  sendPhoneOTP,
  verifyPhoneOTP,
  sendEmailOTP,
  verifyEmailOTP,
  isValidE164,
  checkRateLimit,
  recordOTPAttempt,
  updateOTPStatus,
  cleanupExpiredOTPs,
};
