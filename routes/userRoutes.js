// routes/userRoutes.js
const express = require("express");
const mssql = require("mssql");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");
const { requireMFA } = require("../middleware/mfaMiddleware");
const bcrypt = require("bcrypt");
const { sendInquiryEmail, isEmailConfigured } = require("../utils/mailer");
const multer = require("multer");

const logger = require("../utils/logger");

const router = express.Router();

const MAX_INQUIRY_ATTACHMENTS = 5;
const MAX_INQUIRY_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_ATTACHMENT_PREFIXES = ["image/", "video/"];
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

const isAllowedAttachmentType = (mimetype) => {
  const normalized = String(mimetype || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  if (ALLOWED_ATTACHMENT_MIME_TYPES.has(normalized)) {
    return true;
  }
  return ALLOWED_ATTACHMENT_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
};

const inquiryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_INQUIRY_ATTACHMENT_BYTES,
    files: MAX_INQUIRY_ATTACHMENTS,
  },
  fileFilter: (req, file, cb) => {
    const mimetype = String(file?.mimetype || "").toLowerCase();
    const allowed = isAllowedAttachmentType(mimetype);
    if (!allowed) {
      return cb(
        new Error(
          "Only image, video, PDF, document, spreadsheet, or text attachments are allowed"
        )
      );
    }
    return cb(null, true);
  },
}).array("attachments", MAX_INQUIRY_ATTACHMENTS);

const parseJsonAttachments = (rawAttachments) => {
  if (!rawAttachments) {
    return [];
  }

  let parsed = rawAttachments;
  if (typeof rawAttachments === "string") {
    try {
      parsed = JSON.parse(rawAttachments);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed;
};

/**
 * @swagger
 * /user/profile:
 *   get:
 *     summary: Get user profile
 *     description: Retrieve the current user's profile information
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Profile data retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfile'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get("/profile", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();
    const result = await pool.request().input("userId", userId).query(`
        SELECT FirstName, LastName, FitnessGoal, Age, Weight, Height, BodyFat, Muscle, Gender, FitnessLevel, ProfileImageUrl
        FROM dbo.UserProfile
        WHERE UserID = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(result.recordset[0]);
  } catch (error) {
    logger.error("Get Profile Error", { error: error.message });
    res.status(500).json({ message: "Failed to get user profile" });
  }
});

/**
 * @swagger
 * /user/profile:
 *   patch:
 *     summary: Update user profile
 *     description: Update the current user's profile information
 *     tags: [User]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProfileRequest'
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.patch("/profile", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const {
    firstName,
    lastName,
    fitnessGoal,
    age,
    weight,
    height,
    gender,
    fitnessLevel,
  } = req.body;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("userId", userId)
      .input("firstName", firstName)
      .input("lastName", lastName)
      .input("fitnessGoal", fitnessGoal)
      // Convert empty strings to null for numeric columns to prevent SQL conversion errors
      .input("age", age === '' ? null : age)
      .input("weight", weight === '' ? null : weight)
      .input("height", height === '' ? null : height)
      .input("gender", gender)
      .input("fitnessLevel", fitnessLevel).query(`
        UPDATE dbo.UserProfile
        SET FirstName = @firstName,
            LastName = @lastName,
            FitnessGoal = @fitnessGoal,
            Age = @age,
            Weight = @weight,
            Height = @height,
            Gender = @gender,
            FitnessLevel = @fitnessLevel
        WHERE UserID = @userId
      `);

    res.status(200).json({ message: "Profile updated successfully" });
  } catch (error) {
    logger.error("Profile Update Error", { error: error.message });
    res.status(500).json({ message: "Failed to update profile" });
  }
});

/**
 * @swagger
 * /user/inquiry:
 *   post:
 *     summary: Send customer inquiry
 *     description: Send a user inquiry email to fitness@hpapogee.com
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *               attachments:
 *                 type: array
 *                 description: Base64 attachments (optional)
 *                 items:
 *                   type: object
 *                   properties:
 *                     filename:
 *                       type: string
 *                     contentBase64:
 *                       type: string
 *                     contentType:
 *                       type: string
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Inquiry sent successfully
 *       400:
 *         description: Missing inquiry message
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: User email not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post("/inquiry", authenticateToken, (req, res, next) => {
  inquiryUpload(req, res, (err) => {
    if (!err) {
      return next();
    }

    let message = "Invalid attachments";
    if (err.code === "LIMIT_FILE_SIZE") {
      message = `Attachment too large (max ${MAX_INQUIRY_ATTACHMENT_BYTES / (1024 * 1024)}MB)`;
    } else if (err.code === "LIMIT_FILE_COUNT") {
      message = `Too many attachments (max ${MAX_INQUIRY_ATTACHMENTS})`;
    } else if (err.message) {
      message = err.message;
    }

    return res.status(400).json({ success: false, message });
  });
}, async (req, res) => {
  const userId = req.user.userId;
  const message = String(req.body?.message || "").trim();

  if (!message) {
    return res
      .status(400)
      .json({ success: false, message: "Inquiry message is required" });
  }

  if (!isEmailConfigured()) {
    return res.status(500).json({
      success: false,
      message: "Email service not configured",
    });
  }

  try {
    const jsonAttachments = parseJsonAttachments(req.body?.attachments);
    const fileAttachments = Array.isArray(req.files) ? req.files : [];

    if (
      jsonAttachments.length + fileAttachments.length >
      MAX_INQUIRY_ATTACHMENTS
    ) {
      return res.status(400).json({
        success: false,
        message: `Too many attachments (max ${MAX_INQUIRY_ATTACHMENTS})`,
      });
    }

    let preparedJsonAttachments = [];
    try {
      preparedJsonAttachments = jsonAttachments.map((attachment, index) => {
        const contentBase64 = String(attachment?.contentBase64 || "").trim();
        const content = Buffer.from(contentBase64, "base64");

        if (!contentBase64 || content.length === 0) {
          throw new Error("Invalid attachment content");
        }

        if (content.length > MAX_INQUIRY_ATTACHMENT_BYTES) {
          throw new Error(
            `Attachment too large (max ${MAX_INQUIRY_ATTACHMENT_BYTES / (1024 * 1024)}MB)`
          );
        }

        const contentType = String(attachment?.contentType || "").toLowerCase();
      if (contentType && !isAllowedAttachmentType(contentType)) {
        throw new Error(
          "Only image, video, PDF, document, spreadsheet, or text attachments are allowed"
        );
        }

        return {
          filename: String(attachment?.filename || `attachment_${index + 1}`),
          content,
          contentType: contentType || "application/octet-stream",
        };
      });
    } catch (attachmentError) {
      return res.status(400).json({
        success: false,
        message: attachmentError.message || "Invalid attachments",
      });
    }

    const pool = getPool();
    const result = await pool
      .request()
      .input("userId", userId)
      .query(`SELECT Email FROM dbo.UserLogin WHERE UserID = @userId`);

    if (result.recordset.length === 0 || !result.recordset[0].Email) {
      return res
        .status(404)
        .json({ success: false, message: "User email not found" });
    }

    const userEmail = result.recordset[0].Email;
    const sendResult = await sendInquiryEmail({
      userEmail,
      message,
      attachments: [...fileAttachments, ...preparedJsonAttachments],
    });

    if (!sendResult.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to send inquiry email",
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error("Inquiry Email Error", { userId, error: error.message });
    return res
      .status(500)
      .json({ success: false, message: "Failed to send inquiry email" });
  }
});

/**
 * @swagger
 * /user/profile:
 *   delete:
 *     summary: Delete user account
 *     description: Permanently delete user account and all associated data. Requires MFA verification if enabled.
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Account deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: MFA verification required
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete(
  "/profile",
  authenticateToken,
  requireMFA("delete_account"),
  async (req, res) => {
    const userId = req.user.userId;
    const pool = getPool();
    const transaction = new mssql.Transaction(pool);

    try {
      await transaction.begin();

      // Delete from all related tables (order matters due to foreign keys)
      // Child tables first, parent tables last
      const tablesToClean = [
        "OTPVerifications",
        "PasswordResets",
        "ChatMessages",
        "ChatbotSession",
        "DailyLogs",
        "DailySummary",
        "ExerciseExistence",
        "WorkoutRoutine",
        "WorkoutHistory",
        "UserUsage",
        "UserAchievements",
        "subscription_transactions",
        "user_subscriptions",
        "payments",
        "AIWorkoutPlans",
        "microcycles",
        "mesocycles",
        "OnboardingProfile",
        "PreWorkoutAssessment",
        "DeviceData",
        "OuraTokens",
        "UserLogin",
        "UserProfile", // Delete last (other tables may reference this)
      ];

      for (const table of tablesToClean) {
        const deleteRequest = new mssql.Request(transaction);
        await deleteRequest
          .input("userId", userId)
          .query(`DELETE FROM dbo.${table} WHERE UserID = @userId`);
      }

      await transaction.commit();
      res.status(200).json({
        success: true,
        message: "Account and all data deleted successfully",
      });
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        logger.error("Transaction rollback error", { error: rollbackError.message });
      }
      logger.error("Profile Delete Error", { error: error.message });
      res.status(500).json({
        success: false,
        message: "Failed to delete account",
      });
    }
  }
);

module.exports = router;
