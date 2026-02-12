// routes/userRoutes.js
const express = require("express");
const mssql = require("mssql");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");
const { requireMFA } = require("../middleware/mfaMiddleware");
const bcrypt = require("bcrypt");
const { sendInquiryEmail, isEmailConfigured } = require("../utils/mailer");
const {
  generateUploadSas,
  generateReadSas,
} = require("../middleware/blobClient");
const crypto = require("crypto");
const multer = require("multer");

const logger = require("../utils/logger");

const router = express.Router();

const INQUIRY_TOPICS = {
  workout_advice: "Workout Advice",
  nutrition: "Nutrition",
  form_check: "Form Check",
  injury_recovery: "Injury / Recovery",
  general: "General",
};
const VALID_TOPICS = Object.keys(INQUIRY_TOPICS);

const MAX_INQUIRY_ATTACHMENTS = 5;
const MAX_INQUIRY_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_INQUIRY_TOTAL_BYTES = 100 * 1024 * 1024; // 100MB total
const ALLOWED_ATTACHMENT_PREFIXES = ["image/", "video/"];
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
  "application/vnd.apple.pages",
  "application/vnd.apple.numbers",
  "application/vnd.apple.keynote",
  "text/plain",
  "text/csv",
]);

const isAllowedAttachmentType = (mimetype) => {
  const normalized = String(mimetype || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized === "image/svg+xml") return false;
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
          "Only image, video, PDF, document, spreadsheet, presentation, or text attachments are allowed"
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

// --- Upload SAS rate limiter: 10 req/user/min ---
const uploadRateLimitMap = new Map();
const UPLOAD_RATE_WINDOW = 60 * 1000;
const UPLOAD_RATE_MAX = 10;

const checkUploadRateLimit = (userId) => {
  const now = Date.now();
  let entry = uploadRateLimitMap.get(userId);
  if (!entry || now - entry.windowStart > UPLOAD_RATE_WINDOW) {
    entry = { windowStart: now, count: 0 };
    uploadRateLimitMap.set(userId, entry);
  }
  entry.count++;
  return entry.count <= UPLOAD_RATE_MAX;
};

setInterval(() => {
  const now = Date.now();
  for (const [uid, entry] of uploadRateLimitMap.entries()) {
    if (now - entry.windowStart > UPLOAD_RATE_WINDOW) {
      uploadRateLimitMap.delete(uid);
    }
  }
}, 60 * 1000);

// --- Inquiry submission rate limiter: 5 req/user/hour ---
const inquiryRateLimitMap = new Map();
const INQUIRY_RATE_WINDOW = 60 * 60 * 1000;
const INQUIRY_RATE_MAX = 5;

const checkInquiryRateLimit = (userId) => {
  const now = Date.now();
  let entry = inquiryRateLimitMap.get(userId);
  if (!entry || now - entry.windowStart > INQUIRY_RATE_WINDOW) {
    entry = { windowStart: now, count: 0 };
    inquiryRateLimitMap.set(userId, entry);
  }
  entry.count++;
  return entry.count <= INQUIRY_RATE_MAX;
};

setInterval(() => {
  const now = Date.now();
  for (const [uid, entry] of inquiryRateLimitMap.entries()) {
    if (now - entry.windowStart > INQUIRY_RATE_WINDOW) {
      inquiryRateLimitMap.delete(uid);
    }
  }
}, 60 * 1000);

const MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024; // 50MB per file
const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024; // 100MB total
const BLOB_URL_PREFIX =
  "https://apogeehnp.blob.core.windows.net/inquiry-attachments/";

const sanitizeFilename = (name) =>
  String(name || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .substring(0, 200);

/**
 * @swagger
 * /user/inquiry/upload-urls:
 *   post:
 *     summary: Get SAS upload URLs for inquiry attachments
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [files]
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     filename:
 *                       type: string
 *                     contentType:
 *                       type: string
 *                     size:
 *                       type: number
 *     responses:
 *       200:
 *         description: Upload targets returned
 *       400:
 *         description: Validation error
 *       429:
 *         description: Rate limit exceeded
 */
router.post(
  "/inquiry/upload-urls",
  authenticateToken,
  async (req, res) => {
    const userId = req.user.userId;

    if (!checkUploadRateLimit(userId)) {
      return res.status(429).json({
        success: false,
        message: "Too many upload requests. Please try again shortly.",
      });
    }

    const { files } = req.body;

    if (!Array.isArray(files) || files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "files array is required" });
    }

    if (files.length > MAX_INQUIRY_ATTACHMENTS) {
      return res.status(400).json({
        success: false,
        message: `Too many files (max ${MAX_INQUIRY_ATTACHMENTS})`,
      });
    }

    let totalSize = 0;
    for (const file of files) {
      const size = Number(file?.size || 0);
      if (!file?.filename || !file?.contentType || size <= 0) {
        return res.status(400).json({
          success: false,
          message:
            "Each file must have filename, contentType, and a positive size",
        });
      }
      if (!isAllowedAttachmentType(file.contentType)) {
        return res.status(400).json({
          success: false,
          message: `File type not allowed: ${file.contentType}`,
        });
      }
      if (size > MAX_UPLOAD_FILE_BYTES) {
        return res.status(400).json({
          success: false,
          message: `File too large: ${file.filename} (max 50MB)`,
        });
      }
      totalSize += size;
    }

    if (totalSize > MAX_UPLOAD_TOTAL_BYTES) {
      return res.status(400).json({
        success: false,
        message: "Total upload size exceeds 100MB",
      });
    }

    try {
      const timestamp = Date.now();
      const uploadTargets = files.map((file) => {
        const uuid = crypto.randomUUID();
        const safeName = sanitizeFilename(file.filename);
        const blobName = `inquiries/${userId}/${timestamp}-${uuid}-${safeName}`;
        const sasUrl = generateUploadSas(blobName, file.contentType);
        const blobUrl = `${BLOB_URL_PREFIX}${blobName}`;
        return { sasUrl, blobUrl, blobName };
      });

      return res.status(200).json({ success: true, uploadTargets });
    } catch (error) {
      logger.error("Upload URL generation error", {
        userId,
        error: error.message,
      });
      return res.status(500).json({
        success: false,
        message: "Failed to generate upload URLs",
      });
    }
  }
);

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

  if (!checkInquiryRateLimit(userId)) {
    return res.status(429).json({
      success: false,
      message: "Too many inquiries. Please try again later.",
    });
  }

  const message = String(req.body?.message || "").trim();
  const rawTopic = String(req.body?.topic || "general").trim().toLowerCase();

  if (!message || message.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "Inquiry message is required" });
  }
  if (message.length > 5000) {
    return res.status(400).json({
      success: false,
      message: "Message is too long (maximum 5,000 characters)",
    });
  }

  const topic = VALID_TOPICS.includes(rawTopic) ? rawTopic : "general";

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

    // Separate blob-based and legacy base64 attachments
    const blobAttachments = [];
    const inlineJsonAttachments = [];

    for (const attachment of jsonAttachments) {
      if (attachment?.blobUrl) {
        blobAttachments.push(attachment);
      } else {
        inlineJsonAttachments.push(attachment);
      }
    }

    // Validate blob URL attachments
    for (const attachment of blobAttachments) {
      const blobUrl = String(attachment.blobUrl || "");
      if (
        !blobUrl.startsWith(
          "https://apogeehnp.blob.core.windows.net/inquiry-attachments/inquiries/"
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid attachment URL",
        });
      }
      // Verify blob belongs to this user
      const blobPath = blobUrl.replace(
        "https://apogeehnp.blob.core.windows.net/inquiry-attachments/inquiries/",
        ""
      );
      const blobUserId = parseInt(blobPath.split("/")[0], 10);
      if (blobUserId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Attachment does not belong to this user",
        });
      }
      if (!attachment.contentType || !isAllowedAttachmentType(attachment.contentType)) {
        return res.status(400).json({
          success: false,
          message: "File type not allowed or missing: " + (attachment.contentType || "unknown"),
        });
      }
    }

    // Process legacy base64 attachments
    let preparedInlineAttachments = [];
    try {
      preparedInlineAttachments = inlineJsonAttachments.map(
        (attachment, index) => {
          const contentBase64 = String(
            attachment?.contentBase64 || ""
          ).trim();
          const content = Buffer.from(contentBase64, "base64");

          if (!contentBase64 || content.length === 0) {
            throw new Error("Invalid attachment content");
          }

          if (content.length > MAX_INQUIRY_ATTACHMENT_BYTES) {
            throw new Error(
              `Attachment too large (max ${MAX_INQUIRY_ATTACHMENT_BYTES / (1024 * 1024)}MB)`
            );
          }

          const contentType = String(
            attachment?.contentType || ""
          ).toLowerCase();
          if (contentType && !isAllowedAttachmentType(contentType)) {
            throw new Error(
              "Only image, video, PDF, document, spreadsheet, presentation, or text attachments are allowed"
            );
          }

          return {
            filename: String(
              attachment?.filename || `attachment_${index + 1}`
            ),
            content,
            contentType: contentType || "application/octet-stream",
          };
        }
      );
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

    const topicDisplay = INQUIRY_TOPICS[topic];
    const subject = `FitNxt Customer Inquiry - ${topicDisplay}`;
    const totalAttachments =
      fileAttachments.length +
      preparedInlineAttachments.length +
      blobAttachments.length;

    const userEmail = result.recordset[0].Email;

    // Insert inquiry FIRST
    const insertResult = await pool
      .request()
      .input("userId", mssql.Int, userId)
      .input("topic", mssql.NVarChar(50), topic)
      .input("subject", mssql.NVarChar(255), subject)
      .input("message", mssql.NVarChar(mssql.MAX), message)
      .input("attachmentCount", mssql.Int, totalAttachments)
      .query(`
        INSERT INTO dbo.Inquiries (UserId, Topic, Subject, Message, AttachmentCount)
        OUTPUT INSERTED.Id, INSERTED.Topic, INSERTED.Status, INSERTED.CreatedAt
        VALUES (@userId, @topic, @subject, @message, @attachmentCount)
      `);

    const inquiry = insertResult.recordset[0];

    // Then send email
    const sendResult = await sendInquiryEmail({
      userEmail,
      message,
      subject,
      topic: topicDisplay,
      attachments: [...fileAttachments, ...preparedInlineAttachments],
      blobAttachments: blobAttachments.map((a) => ({
        filename: a.filename || "attachment",
        blobUrl: a.blobUrl,
        contentType: a.contentType || "application/octet-stream",
        size: a.size || 0,
      })),
    });

    if (!sendResult.success) {
      logger.error("Inquiry email failed but recorded in DB", {
        inquiryId: inquiry.Id,
        userId,
        blobUrls: blobAttachments.map((a) => a.blobUrl),
      });
      return res.status(500).json({
        success: false,
        message: "Inquiry recorded but email delivery failed. Support has been notified.",
      });
    }

    return res.status(200).json({
      success: true,
      inquiry: {
        id: inquiry.Id,
        topic: inquiry.Topic,
        status: inquiry.Status,
        createdAt: inquiry.CreatedAt,
      },
    });
  } catch (error) {
    logger.error("Inquiry Email Error", { userId, error: error.message });
    return res
      .status(500)
      .json({ success: false, message: "Failed to send inquiry email" });
  }
});

/**
 * @swagger
 * /user/inquiries:
 *   get:
 *     summary: Get inquiry history
 *     description: Retrieve the authenticated user's inquiry history (paginated)
 *     tags: [User]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Inquiry history retrieved
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get("/inquiries", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  try {
    const pool = getPool();

    const countResult = await pool
      .request()
      .input("userId", mssql.Int, userId)
      .query(`SELECT COUNT(*) AS total FROM dbo.Inquiries WHERE UserId = @userId`);

    const total = countResult.recordset[0].total;
    const totalPages = Math.ceil(total / limit);

    const result = await pool
      .request()
      .input("userId", mssql.Int, userId)
      .input("limit", mssql.Int, limit)
      .input("offset", mssql.Int, offset)
      .query(`
        SELECT Id, Topic, Subject, Message, AttachmentCount, Status, CreatedAt
        FROM dbo.Inquiries
        WHERE UserId = @userId
        ORDER BY CreatedAt DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    const inquiries = result.recordset.map((row) => ({
      id: row.Id,
      topic: row.Topic,
      subject: row.Subject,
      message: row.Message,
      attachmentCount: row.AttachmentCount,
      status: row.Status,
      createdAt: row.CreatedAt,
    }));

    return res.status(200).json({
      success: true,
      inquiries,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    logger.error("Get Inquiries Error", { userId, error: error.message });
    return res
      .status(500)
      .json({ success: false, message: "Failed to retrieve inquiries" });
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
        "Inquiries",
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
