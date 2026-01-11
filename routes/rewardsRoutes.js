// routes/rewardsRoutes.js
const express = require("express");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");

const logger = require("../utils/logger");

const router = express.Router();

// Tier thresholds
const TIERS = {
  BRONZE: { minXP: 0, maxXP: 100 },
  SILVER: { minXP: 100, maxXP: 500 },
  GOLD: { minXP: 500, maxXP: 1000 },
  EXCLUSIVE: { minXP: 1000, maxXP: Infinity },
};

/**
 * Calculate tier based on XP
 */
function calculateTier(totalXP) {
  if (totalXP >= TIERS.EXCLUSIVE.minXP) return "EXCLUSIVE";
  if (totalXP >= TIERS.GOLD.minXP) return "GOLD";
  if (totalXP >= TIERS.SILVER.minXP) return "SILVER";
  return "BRONZE";
}

/**
 * @swagger
 * /rewards/user:
 *   get:
 *     summary: Get user rewards data
 *     description: Retrieve user's XP, tier, and reward progress
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: User rewards data
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get("/user", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();

    // Get or create user rewards record
    let userRewardsResult = await pool.request()
      .input("userId", userId)
      .query(`
        SELECT TotalXP, CurrentTier, LastUpdated
        FROM dbo.UserRewards
        WHERE UserID = @userId
      `);

    // If no record exists, create one
    if (userRewardsResult.recordset.length === 0) {
      await pool.request()
        .input("userId", userId)
        .query(`
          INSERT INTO dbo.UserRewards (UserID, TotalXP, CurrentTier)
          VALUES (@userId, 0, 'BRONZE')
        `);

      userRewardsResult = await pool.request()
        .input("userId", userId)
        .query(`
          SELECT TotalXP, CurrentTier, LastUpdated
          FROM dbo.UserRewards
          WHERE UserID = @userId
        `);
    }

    const userRewards = userRewardsResult.recordset[0];

    // Get all reward definitions
    const rewardDefsResult = await pool.request()
      .query(`
        SELECT RewardID, RewardKey, Category, Name, Description, XPValue, RequiredCount, RequiredStreak
        FROM dbo.RewardDefinitions
        WHERE IsActive = 1
      `);

    // Get user's progress on rewards
    const progressResult = await pool.request()
      .input("userId", userId)
      .query(`
        SELECT RewardID, CurrentProgress, IsCompleted, IsClaimed, CompletedAt, ClaimedAt
        FROM dbo.UserRewardProgress
        WHERE UserID = @userId
      `);

    // Build progress map by RewardID
    const progressMap = {};
    progressResult.recordset.forEach((p) => {
      progressMap[p.RewardID] = p;
    });

    // Build flat reward progress keyed by rewardKey (for frontend compatibility)
    const rewardProgress = {};
    rewardDefsResult.recordset.forEach((reward) => {
      const progress = progressMap[reward.RewardID] || {
        CurrentProgress: 0,
        IsCompleted: false,
        IsClaimed: false,
      };

      // Calculate progress percentage (0-100)
      const progressPercent = reward.RequiredCount > 0
        ? Math.min(100, Math.round((progress.CurrentProgress / reward.RequiredCount) * 100))
        : 0;

      // Flat map keyed by rewardKey
      rewardProgress[reward.RewardKey] = {
        rewardId: reward.RewardID,
        completed: progress.IsCompleted,
        claimed: progress.IsClaimed,
        canClaim: progress.IsCompleted && !progress.IsClaimed,
        progress: progressPercent,
        currentCount: progress.CurrentProgress,
        requiredCount: reward.RequiredCount,
        xp: reward.XPValue,
        name: reward.Name,
        description: reward.Description,
        category: reward.Category,
        completedAt: progress.CompletedAt,
        claimedAt: progress.ClaimedAt,
      };
    });

    // Get completed (claimed) rewards for history
    const completedResult = await pool.request()
      .input("userId", userId)
      .query(`
        SELECT
          rd.RewardKey, rd.Name, rd.XPValue, rd.Category,
          urp.ClaimedAt
        FROM dbo.UserRewardProgress urp
        JOIN dbo.RewardDefinitions rd ON urp.RewardID = rd.RewardID
        WHERE urp.UserID = @userId AND urp.IsClaimed = 1
        ORDER BY urp.ClaimedAt DESC
      `);

    res.status(200).json({
      totalXP: userRewards.TotalXP,
      currentTier: userRewards.CurrentTier,
      tierProgress: {
        current: userRewards.CurrentTier,
        currentXP: userRewards.TotalXP,
        nextTier: userRewards.CurrentTier === "EXCLUSIVE" ? null : calculateTier(userRewards.TotalXP + 1),
        xpToNextTier: userRewards.CurrentTier === "EXCLUSIVE"
          ? 0
          : TIERS[calculateTier(userRewards.TotalXP + 100)].minXP - userRewards.TotalXP,
      },
      rewardProgress,
      completedRewards: completedResult.recordset.map((r) => ({
        id: r.RewardKey,
        name: r.Name,
        xp: r.XPValue,
        category: r.Category,
        completedAt: r.ClaimedAt, // Frontend expects completedAt
      })),
      lastUpdated: userRewards.LastUpdated,
    });
  } catch (error) {
    logger.error("Get User Rewards Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get user rewards" });
  }
});

/**
 * @swagger
 * /rewards/{rewardId}/claim:
 *   post:
 *     summary: Claim a completed reward
 *     description: Claim XP for a completed reward
 *     tags: [Rewards]
 *     parameters:
 *       - in: path
 *         name: rewardId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Reward claimed successfully
 *       400:
 *         description: Reward not completed or already claimed
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Reward not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post("/:rewardId/claim", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const rewardId = parseInt(req.params.rewardId);

  if (isNaN(rewardId)) {
    return res.status(400).json({ message: "Invalid reward ID" });
  }

  try {
    const pool = getPool();

    // Get reward definition
    const rewardResult = await pool.request()
      .input("rewardId", rewardId)
      .query(`
        SELECT RewardID, RewardKey, Name, XPValue
        FROM dbo.RewardDefinitions
        WHERE RewardID = @rewardId AND IsActive = 1
      `);

    if (rewardResult.recordset.length === 0) {
      return res.status(404).json({ message: "Reward not found" });
    }

    const reward = rewardResult.recordset[0];

    // Check user's progress
    const progressResult = await pool.request()
      .input("userId", userId)
      .input("rewardId", rewardId)
      .query(`
        SELECT ProgressID, IsCompleted, IsClaimed
        FROM dbo.UserRewardProgress
        WHERE UserID = @userId AND RewardID = @rewardId
      `);

    if (progressResult.recordset.length === 0) {
      return res.status(400).json({ message: "Reward progress not found" });
    }

    const progress = progressResult.recordset[0];

    if (!progress.IsCompleted) {
      return res.status(400).json({ message: "Reward not yet completed" });
    }

    if (progress.IsClaimed) {
      return res.status(400).json({ message: "Reward already claimed" });
    }

    // Claim the reward - update progress and add XP
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Mark as claimed
      await transaction.request()
        .input("progressId", progress.ProgressID)
        .query(`
          UPDATE dbo.UserRewardProgress
          SET IsClaimed = 1, ClaimedAt = SYSDATETIMEOFFSET()
          WHERE ProgressID = @progressId
        `);

      // Update user's total XP
      const xpResult = await transaction.request()
        .input("userId", userId)
        .input("xp", reward.XPValue)
        .query(`
          UPDATE dbo.UserRewards
          SET TotalXP = TotalXP + @xp, LastUpdated = SYSDATETIMEOFFSET()
          OUTPUT INSERTED.TotalXP
          WHERE UserID = @userId
        `);

      const newTotalXP = xpResult.recordset[0]?.TotalXP || reward.XPValue;
      const newTier = calculateTier(newTotalXP);

      // Update tier if changed
      await transaction.request()
        .input("userId", userId)
        .input("tier", newTier)
        .query(`
          UPDATE dbo.UserRewards
          SET CurrentTier = @tier
          WHERE UserID = @userId AND CurrentTier != @tier
        `);

      // Add to history
      await transaction.request()
        .input("userId", userId)
        .input("rewardId", rewardId)
        .input("xp", reward.XPValue)
        .input("reason", `Claimed reward: ${reward.Name}`)
        .query(`
          INSERT INTO dbo.UserRewardHistory (UserID, RewardID, XPEarned, Reason)
          VALUES (@userId, @rewardId, @xp, @reason)
        `);

      await transaction.commit();

      res.status(200).json({
        success: true,
        xpEarned: reward.XPValue,
        newTotalXP,
        newTier,
        message: `Claimed ${reward.XPValue} XP for ${reward.Name}`,
      });
    } catch (txError) {
      await transaction.rollback();
      throw txError;
    }
  } catch (error) {
    logger.error("Claim Reward Error", { error: error.message, userId, rewardId });
    res.status(500).json({ message: "Failed to claim reward" });
  }
});

/**
 * @swagger
 * /rewards/history:
 *   get:
 *     summary: Get reward history
 *     description: Get history of earned XP with optional search
 *     tags: [Rewards]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
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
 *         description: Reward history
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get("/history", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const pool = getPool();

    let query = `
      SELECT
        h.HistoryID, h.XPEarned, h.Reason, h.EarnedAt,
        rd.RewardKey, rd.Name as RewardName, rd.Category
      FROM dbo.UserRewardHistory h
      LEFT JOIN dbo.RewardDefinitions rd ON h.RewardID = rd.RewardID
      WHERE h.UserID = @userId
    `;

    if (search) {
      query += ` AND (rd.Name LIKE @search OR h.Reason LIKE @search)`;
    }

    query += ` ORDER BY h.EarnedAt DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;

    const request = pool.request()
      .input("userId", userId)
      .input("offset", offset)
      .input("limit", parseInt(limit));

    if (search) {
      request.input("search", `%${search}%`);
    }

    const result = await request.query(query);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM dbo.UserRewardHistory h
      LEFT JOIN dbo.RewardDefinitions rd ON h.RewardID = rd.RewardID
      WHERE h.UserID = @userId
    `;

    if (search) {
      countQuery += ` AND (rd.Name LIKE @search OR h.Reason LIKE @search)`;
    }

    const countRequest = pool.request().input("userId", userId);
    if (search) {
      countRequest.input("search", `%${search}%`);
    }

    const countResult = await countRequest.query(countQuery);
    const total = countResult.recordset[0].total;

    res.status(200).json({
      rewards: result.recordset.map((r) => ({
        id: r.HistoryID,
        xp: r.XPEarned,
        reason: r.Reason,
        rewardKey: r.RewardKey,
        rewardName: r.RewardName,
        category: r.Category,
        earnedAt: r.EarnedAt,
      })),
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    logger.error("Get Reward History Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get reward history" });
  }
});

/**
 * @swagger
 * /rewards/progress/{rewardKey}:
 *   post:
 *     summary: Update reward progress
 *     description: Increment progress on a specific reward (internal use)
 *     tags: [Rewards]
 *     parameters:
 *       - in: path
 *         name: rewardKey
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               increment:
 *                 type: integer
 *                 default: 1
 *     responses:
 *       200:
 *         description: Progress updated
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Reward not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post("/progress/:rewardKey", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const rewardKey = req.params.rewardKey;
  const { increment = 1 } = req.body;

  try {
    const pool = getPool();

    // Get reward definition
    const rewardResult = await pool.request()
      .input("rewardKey", rewardKey)
      .query(`
        SELECT RewardID, RequiredCount, XPValue, Name
        FROM dbo.RewardDefinitions
        WHERE RewardKey = @rewardKey AND IsActive = 1
      `);

    if (rewardResult.recordset.length === 0) {
      return res.status(404).json({ message: "Reward not found" });
    }

    const reward = rewardResult.recordset[0];

    // Get or create progress record
    let progressResult = await pool.request()
      .input("userId", userId)
      .input("rewardId", reward.RewardID)
      .query(`
        SELECT ProgressID, CurrentProgress, IsCompleted
        FROM dbo.UserRewardProgress
        WHERE UserID = @userId AND RewardID = @rewardId
      `);

    if (progressResult.recordset.length === 0) {
      // Create progress record
      await pool.request()
        .input("userId", userId)
        .input("rewardId", reward.RewardID)
        .query(`
          INSERT INTO dbo.UserRewardProgress (UserID, RewardID, CurrentProgress)
          VALUES (@userId, @rewardId, 0)
        `);

      progressResult = await pool.request()
        .input("userId", userId)
        .input("rewardId", reward.RewardID)
        .query(`
          SELECT ProgressID, CurrentProgress, IsCompleted
          FROM dbo.UserRewardProgress
          WHERE UserID = @userId AND RewardID = @rewardId
        `);
    }

    const progress = progressResult.recordset[0];

    // Don't update if already completed
    if (progress.IsCompleted) {
      return res.status(200).json({
        success: true,
        alreadyCompleted: true,
        currentProgress: progress.CurrentProgress,
        requiredCount: reward.RequiredCount,
      });
    }

    // Update progress
    const newProgress = Math.min(progress.CurrentProgress + increment, reward.RequiredCount);
    const isNowCompleted = newProgress >= reward.RequiredCount;

    await pool.request()
      .input("progressId", progress.ProgressID)
      .input("newProgress", newProgress)
      .input("isCompleted", isNowCompleted)
      .query(`
        UPDATE dbo.UserRewardProgress
        SET
          CurrentProgress = @newProgress,
          IsCompleted = @isCompleted,
          CompletedAt = CASE WHEN @isCompleted = 1 THEN SYSDATETIMEOFFSET() ELSE CompletedAt END
        WHERE ProgressID = @progressId
      `);

    res.status(200).json({
      success: true,
      currentProgress: newProgress,
      requiredCount: reward.RequiredCount,
      isCompleted: isNowCompleted,
      readyToClaim: isNowCompleted,
      xpAvailable: isNowCompleted ? reward.XPValue : 0,
    });
  } catch (error) {
    logger.error("Update Reward Progress Error", { error: error.message, userId, rewardKey });
    res.status(500).json({ message: "Failed to update reward progress" });
  }
});

module.exports = router;
