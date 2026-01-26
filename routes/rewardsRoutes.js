// routes/rewardsRoutes.js
const express = require("express");
const sql = require("mssql");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");
const rewardCalculator = require("../services/rewardCalculator");
const levelCalculator = require("../services/levelCalculator");
const {
  awardDailySignIn,
  getUserStreaks: getXpEventStreaks,
} = require("../services/xpEventService");
const { getUserBadges, checkAllBadges } = require("../services/badgeService");
const { getPRHistory, getCurrentPRs, getRecentPRs } = require("../services/prService");
const challengeGenerator = require("../services/challengeGenerator");
const logger = require("../utils/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Gemini AI Configuration
const GOOGLE_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = process.env.GEMINI_MODEL_NAME || "gemini-2.5-pro";

// AI Reconcile System Prompt
const REWARDS_RECONCILE_PROMPT = `You are the FitNext Rewards AI. Analyze user activity and evaluate reward/challenge progress.

Rules:
• Only evaluate based on actual logged activity data provided
• Return valid JSON matching the schema exactly
• Be conservative - only mark rewards complete if data clearly supports it
• Calculate streaks accurately from consecutive days
• For partial progress, estimate percentage based on requirement

Return a JSON object with:
{
  "rewardsToUpdate": [
    {
      "rewardKey": "string (e.g., 'weekly_goal', 'step_streak_7')",
      "newProgress": number (0-100 percentage),
      "isCompleted": boolean,
      "reason": "string explanation"
    }
  ],
  "challengesToUpdate": [
    {
      "challengeId": number,
      "newProgress": number,
      "isCompleted": boolean,
      "reason": "string explanation"
    }
  ],
  "fpToAward": number (total FitPoints to add),
  "summary": "string (brief explanation of changes)"
}`;

const router = express.Router();

// Tier thresholds (legacy)
const TIERS = {
  BRONZE: { minXP: 0, maxXP: 100 },
  SILVER: { minXP: 100, maxXP: 500 },
  GOLD: { minXP: 500, maxXP: 1000 },
  EXCLUSIVE: { minXP: 1000, maxXP: Infinity },
};

function calculateTier(totalXP) {
  if (totalXP >= TIERS.EXCLUSIVE.minXP) return "EXCLUSIVE";
  if (totalXP >= TIERS.GOLD.minXP) return "GOLD";
  if (totalXP >= TIERS.SILVER.minXP) return "SILVER";
  return "BRONZE";
}

function getWeekStartDateUTC(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0=Sun
  const diffToMonday = (day + 6) % 7; // Monday=0
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return date;
}

// =====================================================
// EXISTING ROUTES (UNCHANGED, from your current file)
// =====================================================

router.get("/user", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();

    let userRewardsResult = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT TotalFitPoints, CurrentTier, LastUpdated
        FROM dbo.UserRewards
        WHERE UserID = @userId
      `);

    if (userRewardsResult.recordset.length === 0) {
      await pool
        .request()
        .input("userId", userId)
        .query(`
          INSERT INTO dbo.UserRewards (UserID, TotalFitPoints, CurrentTier)
          VALUES (@userId, 0, 'BRONZE')
        `);

      userRewardsResult = await pool
        .request()
        .input("userId", userId)
        .query(`
          SELECT TotalFitPoints, CurrentTier, LastUpdated
          FROM dbo.UserRewards
          WHERE UserID = @userId
        `);
    }

    const userRewards = userRewardsResult.recordset[0];

    const rewardDefsResult = await pool.request().query(`
        SELECT RewardID, RewardKey, Category, Name, Description, XPValue, RequiredCount, RequiredStreak
        FROM dbo.RewardDefinitions
        WHERE IsActive = 1
      `);

    const progressResult = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT RewardID, CurrentProgress, IsCompleted, IsClaimed, CompletedAt, ClaimedAt
        FROM dbo.UserRewardProgress
        WHERE UserID = @userId
      `);

    const progressMap = {};
    progressResult.recordset.forEach((p) => {
      progressMap[p.RewardID] = p;
    });

    const dailyStatusResult = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT 'daily_signin' as rewardKey, 1 as completed
        FROM dbo.DailySignIn
        WHERE UserID = @userId AND SignInDate = CAST(GETDATE() AS DATE)
        UNION ALL
        SELECT
          CASE AwardType
            WHEN 'water_log' THEN 'log_water'
            WHEN 'sleep_log' THEN 'log_sleep'
            WHEN 'step_goal' THEN 'step_goal'
            WHEN 'form_review' THEN 'form_ai_review'
            WHEN 'daily_combo' THEN 'daily_combo'
            ELSE AwardType
          END as rewardKey,
          1 as completed
        FROM dbo.DailyXPAwards
        WHERE UserID = @userId AND AwardDate = CAST(GETDATE() AS DATE)
      `);

    const todayDailyStatus = {};
    dailyStatusResult.recordset.forEach((row) => {
      todayDailyStatus[row.rewardKey] = true;
    });

    const dailyRewardKeys = [
      "daily_signin",
      "log_water",
      "log_sleep",
      "step_goal",
      "form_ai_review",
      "daily_combo",
    ];

    const rewardProgress = {};
    rewardDefsResult.recordset.forEach((reward) => {
      const progress = progressMap[reward.RewardID] || {
        CurrentProgress: 0,
        IsCompleted: false,
        IsClaimed: false,
      };

      const progressPercent =
        reward.RequiredCount > 0
          ? Math.min(
              100,
              Math.round((progress.CurrentProgress / reward.RequiredCount) * 100)
            )
          : 0;

      const isDailyReward = dailyRewardKeys.includes(reward.RewardKey);
      const isCompletedToday = isDailyReward
        ? todayDailyStatus[reward.RewardKey] || false
        : progress.IsCompleted;
      const isClaimedToday = isDailyReward
        ? todayDailyStatus[reward.RewardKey] || false
        : progress.IsClaimed;

      rewardProgress[reward.RewardKey] = {
        rewardId: reward.RewardID,
        completed: isCompletedToday,
        claimed: isClaimedToday,
        canClaim: !isDailyReward && progress.IsCompleted && !progress.IsClaimed,
        progress: isDailyReward ? (isCompletedToday ? 100 : 0) : progressPercent,
        currentCount: isDailyReward
          ? isCompletedToday
            ? 1
            : 0
          : progress.CurrentProgress,
        requiredCount: reward.RequiredCount,
        xp: reward.XPValue,
        name: reward.Name,
        description: reward.Description,
        category: reward.Category,
        completedAt: progress.CompletedAt,
        claimedAt: progress.ClaimedAt,
        isDaily: isDailyReward,
      };
    });

    const completedResult = await pool
      .request()
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

    const totalFitPoints = Number(
      userRewards.TotalFitPoints ?? userRewards.TotalXP ?? 0
    );
    const levelProgress = levelCalculator.getLevelProgress(totalFitPoints);

    res.status(200).json({
      totalFitPoints,
      totalXP: totalFitPoints,
      currentTier: userRewards.CurrentTier,
      level: levelProgress.level,
      levelProgress: {
        level: levelProgress.level,
        xpIntoLevel: levelProgress.xpIntoLevel,
        xpToNextLevel: levelProgress.xpToNextLevel,
        progressPercent: levelProgress.progressPercent,
        tier: levelProgress.tier,
        tierName: levelProgress.tierName,
      },
      tierProgress: {
        current: userRewards.CurrentTier,
        currentXP: totalFitPoints,
        nextTier:
          userRewards.CurrentTier === "EXCLUSIVE"
            ? null
            : calculateTier(totalFitPoints + 1),
        xpToNextTier:
          userRewards.CurrentTier === "EXCLUSIVE"
            ? 0
            : TIERS[calculateTier(totalFitPoints + 100)].minXP - totalFitPoints,
      },
      rewardProgress,
      completedRewards: completedResult.recordset.map((r) => ({
        id: r.RewardKey,
        name: r.Name,
        xp: r.XPValue,
        category: r.Category,
        completedAt: r.ClaimedAt,
      })),
      lastUpdated: userRewards.LastUpdated,
    });
  } catch (error) {
    logger.error("Get User Rewards Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get user rewards" });
  }
});

router.post("/:rewardId/claim", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const rewardId = parseInt(req.params.rewardId);

  if (isNaN(rewardId)) {
    return res.status(400).json({ message: "Invalid reward ID" });
  }

  try {
    const pool = getPool();

    const rewardResult = await pool.request().input("rewardId", rewardId).query(`
        SELECT RewardID, RewardKey, Name, XPValue
        FROM dbo.RewardDefinitions
        WHERE RewardID = @rewardId AND IsActive = 1
      `);

    if (rewardResult.recordset.length === 0) {
      return res.status(404).json({ message: "Reward not found" });
    }

    const reward = rewardResult.recordset[0];

    const progressResult = await pool
      .request()
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

    if (!progress.IsCompleted)
      return res.status(400).json({ message: "Reward not yet completed" });
    if (progress.IsClaimed)
      return res.status(400).json({ message: "Reward already claimed" });

    const transaction = pool.transaction();
    await transaction.begin();

    try {
      await transaction.request().input("progressId", progress.ProgressID).query(`
          UPDATE dbo.UserRewardProgress
          SET IsClaimed = 1, ClaimedAt = SYSDATETIMEOFFSET()
          WHERE ProgressID = @progressId
        `);

      const xpResult = await transaction
        .request()
        .input("userId", userId)
        .input("xp", reward.XPValue)
        .query(`
          UPDATE dbo.UserRewards
          SET TotalFitPoints = TotalFitPoints + @xp, LastUpdated = SYSDATETIMEOFFSET()
          OUTPUT INSERTED.TotalFitPoints
          WHERE UserID = @userId
        `);

      const newTotalFitPoints =
        xpResult.recordset[0]?.TotalFitPoints || reward.XPValue;
      const oldFitPoints = newTotalFitPoints - reward.XPValue;

      const levelUpResult = levelCalculator.checkLevelUp(
        oldFitPoints,
        newTotalFitPoints
      );
      const newLevel = levelCalculator.calculateLevel(newTotalFitPoints);
      const newTier = levelCalculator.getTierFromLevel(newLevel);

      await transaction
        .request()
        .input("userId", userId)
        .input("tier", newTier)
        .input("level", newLevel)
        .input("levelUpAt", levelUpResult.leveledUp ? new Date() : null)
        .query(`
          UPDATE dbo.UserRewards
          SET CurrentTier = @tier,
              CurrentLevel = @level,
              LevelUpAt = CASE WHEN @levelUpAt IS NOT NULL THEN @levelUpAt ELSE LevelUpAt END
          WHERE UserID = @userId
        `);

      await transaction
        .request()
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
        newTotalFitPoints,
        newTotalXP: newTotalFitPoints,
        newTier,
        newLevel,
        leveledUp: levelUpResult.leveledUp,
        levelUpInfo: levelUpResult.leveledUp ? levelUpResult : null,
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

    if (search) query += ` AND (rd.Name LIKE @search OR h.Reason LIKE @search)`;
    query += ` ORDER BY h.EarnedAt DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;

    const request = pool
      .request()
      .input("userId", userId)
      .input("offset", offset)
      .input("limit", parseInt(limit));
    if (search) request.input("search", `%${search}%`);
    const result = await request.query(query);

    let countQuery = `
      SELECT COUNT(*) as total
      FROM dbo.UserRewardHistory h
      LEFT JOIN dbo.RewardDefinitions rd ON h.RewardID = rd.RewardID
      WHERE h.UserID = @userId
    `;
    if (search) countQuery += ` AND (rd.Name LIKE @search OR h.Reason LIKE @search)`;

    const countRequest = pool.request().input("userId", userId);
    if (search) countRequest.input("search", `%${search}%`);
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

router.post("/progress/:rewardKey", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const rewardKey = req.params.rewardKey;
  const { increment = 1 } = req.body;

  try {
    const pool = getPool();

    const rewardResult = await pool.request().input("rewardKey", rewardKey).query(`
        SELECT RewardID, RequiredCount, XPValue, Name
        FROM dbo.RewardDefinitions
        WHERE RewardKey = @rewardKey AND IsActive = 1
      `);

    if (rewardResult.recordset.length === 0) {
      return res.status(404).json({ message: "Reward not found" });
    }

    const reward = rewardResult.recordset[0];

    let progressResult = await pool
      .request()
      .input("userId", userId)
      .input("rewardId", reward.RewardID)
      .query(`
        SELECT ProgressID, CurrentProgress, IsCompleted
        FROM dbo.UserRewardProgress
        WHERE UserID = @userId AND RewardID = @rewardId
      `);

    if (progressResult.recordset.length === 0) {
      await pool
        .request()
        .input("userId", userId)
        .input("rewardId", reward.RewardID)
        .query(`
          INSERT INTO dbo.UserRewardProgress (UserID, RewardID, CurrentProgress)
          VALUES (@userId, @rewardId, 0)
        `);

      progressResult = await pool
        .request()
        .input("userId", userId)
        .input("rewardId", reward.RewardID)
        .query(`
          SELECT ProgressID, CurrentProgress, IsCompleted
          FROM dbo.UserRewardProgress
          WHERE UserID = @userId AND RewardID = @rewardId
        `);
    }

    const progress = progressResult.recordset[0];

    if (progress.IsCompleted) {
      return res.status(200).json({
        success: true,
        alreadyCompleted: true,
        currentProgress: progress.CurrentProgress,
        requiredCount: reward.RequiredCount,
      });
    }

    const newProgress = Math.min(
      progress.CurrentProgress + increment,
      reward.RequiredCount
    );
    const isNowCompleted = newProgress >= reward.RequiredCount;

    await pool
      .request()
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
    logger.error("Update Reward Progress Error", {
      error: error.message,
      userId,
      rewardKey,
    });
    res.status(500).json({ message: "Failed to update reward progress" });
  }
});

router.post("/recalculate", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const updates = await rewardCalculator.checkAndUpdateRewards(userId);
    res.status(200).json({ success: true, message: "Rewards recalculated", updates });
  } catch (error) {
    logger.error("Recalculate Rewards Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to recalculate rewards" });
  }
});

router.get("/level", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();

    const result = await pool.request().input("userId", userId).query(`
        SELECT TotalFitPoints, CurrentLevel, CurrentTier, LevelUpAt
        FROM dbo.UserRewards
        WHERE UserID = @userId
      `);

    if (result.recordset.length === 0) {
      await pool
        .request()
        .input("userId", userId)
        .query(`
          INSERT INTO dbo.UserRewards (UserID, TotalFitPoints, CurrentLevel, CurrentTier)
          VALUES (@userId, 0, 1, 'BRONZE')
        `);

      return res.status(200).json(levelCalculator.getLevelProgress(0));
    }

    const user = result.recordset[0];
    const totalFitPoints = Number(user.TotalFitPoints ?? user.TotalXP ?? 0);
    const levelProgress = levelCalculator.getLevelProgress(totalFitPoints);
    const streaks = await getXpEventStreaks(userId);

    res.status(200).json({
      ...levelProgress,
      streakBonus: streaks.workout?.current >= 7,
      workoutStreak: streaks.workout?.current || 0,
      lastLevelUp: user.LevelUpAt,
    });
  } catch (error) {
    logger.error("Get Level Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get level info" });
  }
});

router.get("/badges", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const badges = await getUserBadges(userId);
    const earnedCount = badges.filter((b) => b.isEarned).length;

    res.status(200).json({
      badges,
      totalBadges: badges.length,
      earnedBadges: earnedCount,
    });
  } catch (error) {
    logger.error("Get Badges Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get badges" });
  }
});

router.post("/badges/check", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await checkAllBadges(userId);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error("Check Badges Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to check badges" });
  }
});

router.get("/personal-records", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { exerciseId, limit = 50 } = req.query;

  try {
    const history = await getPRHistory(userId, exerciseId, parseInt(limit));
    const currentPRs = await getCurrentPRs(userId);
    const recentPRs = await getRecentPRs(userId, 5);

    res.status(200).json({
      history,
      currentPRs,
      recentPRs,
      totalPRs: history.length,
    });
  } catch (error) {
    logger.error("Get Personal Records Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get personal records" });
  }
});

router.post("/daily-signin", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await awardDailySignIn(userId);
    res.status(200).json(result);
  } catch (error) {
    logger.error("Daily Sign-in Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to record daily sign-in" });
  }
});

router.get("/streaks", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const streaks = await getXpEventStreaks(userId);
    res.status(200).json({
      streaks,
      hasStreakBonus: (streaks.workout?.current || 0) >= 7,
    });
  } catch (error) {
    logger.error("Get Streaks Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get streaks" });
  }
});

// =====================================================
// NEW: REWARDS V2 ENDPOINTS (TABLE-BASED)
// =====================================================
// These directly map to the tables you listed.
// Mount path stays the same: /api/rewards (router is mounted at /rewards).
// V2 paths: /rewards/v2/*

/**
 * RewardDefinitions
 * - GET  /rewards/v2/definitions
 * - POST /rewards/v2/definitions (upsert by RewardKey)
 */
router.get("/v2/definitions", authenticateToken, async (_req, res) => {
  try {
    const pool = getPool();
    const defs = await pool.request().query(`
      SELECT RewardID, RewardKey, Category, Name, Description, XPValue, RequiredCount, RequiredStreak, IsActive, CreatedAt
      FROM dbo.RewardDefinitions
      ORDER BY CreatedAt DESC
    `);
    res.status(200).json({ success: true, data: defs.recordset || [] });
  } catch (error) {
    logger.error("V2 Get Definitions Error", { error: error.message });
    res.status(500).json({ message: "Failed to get reward definitions" });
  }
});

router.post("/v2/definitions", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const {
      RewardKey,
      Category,
      Name,
      Description,
      XPValue,
      RequiredCount,
      RequiredStreak,
      IsActive = true,
    } = req.body || {};

    if (!RewardKey || !Name) {
      return res.status(400).json({ message: "RewardKey and Name are required" });
    }

    await pool
      .request()
      .input("RewardKey", sql.NVarChar(100), String(RewardKey))
      .input("Category", sql.NVarChar(50), Category != null ? String(Category) : null)
      .input("Name", sql.NVarChar(200), String(Name))
      .input(
        "Description",
        sql.NVarChar(1000),
        Description != null ? String(Description) : null
      )
      .input("XPValue", sql.Int, Number(XPValue) || 0)
      .input(
        "RequiredCount",
        sql.Int,
        RequiredCount != null ? Number(RequiredCount) : null
      )
      .input(
        "RequiredStreak",
        sql.Int,
        RequiredStreak != null ? Number(RequiredStreak) : null
      )
      .input("IsActive", sql.Bit, IsActive ? 1 : 0)
      .query(`
        MERGE dbo.RewardDefinitions AS tgt
        USING (SELECT @RewardKey AS RewardKey) AS src
        ON tgt.RewardKey = src.RewardKey
        WHEN MATCHED THEN
          UPDATE SET
            Category=@Category,
            Name=@Name,
            Description=@Description,
            XPValue=@XPValue,
            RequiredCount=@RequiredCount,
            RequiredStreak=@RequiredStreak,
            IsActive=@IsActive
        WHEN NOT MATCHED THEN
          INSERT (RewardKey, Category, Name, Description, XPValue, RequiredCount, RequiredStreak, IsActive, CreatedAt)
          VALUES (@RewardKey, @Category, @Name, @Description, @XPValue, @RequiredCount, @RequiredStreak, @IsActive, SYSDATETIMEOFFSET());
      `);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error("V2 Upsert Definition Error", { error: error.message });
    res.status(500).json({ message: "Failed to upsert reward definition" });
  }
});

/**
 * UserRewardProgress
 * - GET  /rewards/v2/progress
 * - POST /rewards/v2/progress/:rewardKey   { increment }
 */
router.get("/v2/progress", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const pool = getPool();
    const rows = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT
          p.ProgressID, p.UserID, p.RewardID, p.CurrentProgress, p.IsCompleted, p.IsClaimed, p.CompletedAt, p.ClaimedAt,
          d.RewardKey, d.Category, d.Name, d.Description, d.XPValue, d.RequiredCount, d.RequiredStreak
        FROM dbo.UserRewardProgress p
        JOIN dbo.RewardDefinitions d ON d.RewardID = p.RewardID
        WHERE p.UserID = @userId
      `);

    res.status(200).json({ success: true, data: rows.recordset || [] });
  } catch (error) {
    logger.error("V2 Get Progress Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get reward progress" });
  }
});

router.post("/v2/progress/:rewardKey", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const rewardKey = String(req.params.rewardKey || "").trim();
  const increment = Number(req.body?.increment ?? 1) || 1;

  try {
    const pool = getPool();

    const rewardResult = await pool.request().input("rewardKey", rewardKey).query(`
      SELECT RewardID, RequiredCount
      FROM dbo.RewardDefinitions
      WHERE RewardKey = @rewardKey AND IsActive = 1
    `);

    if (rewardResult.recordset.length === 0)
      return res.status(404).json({ message: "Reward not found" });
    const reward = rewardResult.recordset[0];

    // Upsert progress row
    await pool
      .request()
      .input("userId", userId)
      .input("rewardId", reward.RewardID)
      .input("inc", increment)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.UserRewardProgress WHERE UserID=@userId AND RewardID=@rewardId)
        BEGIN
          INSERT INTO dbo.UserRewardProgress (UserID, RewardID, CurrentProgress, IsCompleted, IsClaimed)
          VALUES (@userId, @rewardId, 0, 0, 0);
        END

        UPDATE dbo.UserRewardProgress
        SET CurrentProgress = ISNULL(CurrentProgress,0) + @inc
        WHERE UserID=@userId AND RewardID=@rewardId;

        -- Mark complete if reaches required count
        UPDATE dbo.UserRewardProgress
        SET IsCompleted = CASE WHEN @RequiredCount IS NOT NULL AND CurrentProgress >= @RequiredCount THEN 1 ELSE IsCompleted END,
            CompletedAt = CASE WHEN @RequiredCount IS NOT NULL AND CurrentProgress >= @RequiredCount AND CompletedAt IS NULL THEN SYSDATETIMEOFFSET() ELSE CompletedAt END
        FROM dbo.UserRewardProgress p
        CROSS APPLY (SELECT @RequiredCount = (SELECT RequiredCount FROM dbo.RewardDefinitions WHERE RewardID=@rewardId)) x
        WHERE p.UserID=@userId AND p.RewardID=@rewardId;
      `);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error("V2 Update Progress Error", { error: error.message, userId, rewardKey });
    res.status(500).json({ message: "Failed to update reward progress" });
  }
});

/**
 * UserRewardHistory
 * - GET /rewards/v2/history
 */
router.get("/v2/history", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

  try {
    const pool = getPool();
    const rows = await pool
      .request()
      .input("userId", userId)
      .input("limit", limit)
      .query(`
        SELECT TOP (@limit)
          h.HistoryID, h.UserID, h.RewardID, h.XPEarned, h.Reason, h.EarnedAt,
          d.RewardKey, d.Name, d.Category
        FROM dbo.UserRewardHistory h
        LEFT JOIN dbo.RewardDefinitions d ON d.RewardID = h.RewardID
        WHERE h.UserID=@userId
        ORDER BY h.EarnedAt DESC
      `);

    res.status(200).json({ success: true, data: rows.recordset || [] });
  } catch (error) {
    logger.error("V2 Get History Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get reward history" });
  }
});

/**
 * UserRewards (tier/points)
 * - GET /rewards/v2/tier
 */
router.get("/v2/tier", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const pool = getPool();
    const r = await pool.request().input("userId", userId).query(`
      SELECT TOP 1 UserID, TotalFitPoints, CurrentTier, LastUpdated, CurrentLevel, LevelUpAt
      FROM dbo.UserRewards
      WHERE UserID=@userId
    `);
    res.status(200).json({ success: true, data: r.recordset[0] || null });
  } catch (error) {
    logger.error("V2 Get Tier Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get user rewards tier" });
  }
});

/**
 * UserUsage (chatbot inquiries)
 * - GET  /rewards/v2/usage
 * - POST /rewards/v2/usage/increment   { type: "general"|"workout", amount?: number }
 */
router.get("/v2/usage", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const pool = getPool();
    const weekStart = getWeekStartDateUTC(new Date());
    const weekStartStr = weekStart.toISOString().slice(0, 10);

    // Ensure row exists
    await pool
      .request()
      .input("userId", userId)
      .input("weekStart", weekStartStr)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.UserUsage WHERE UserId=@userId AND WeekStart=@weekStart)
        BEGIN
          INSERT INTO dbo.UserUsage (UserId, WeekStart, CreateDate, GeneralInquiryCount, WorkoutInquiryCount)
          VALUES (@userId, @weekStart, SYSDATETIMEOFFSET(), 0, 0);
        END
      `);

    const r = await pool
      .request()
      .input("userId", userId)
      .input("weekStart", weekStartStr)
      .query(`SELECT TOP 1 * FROM dbo.UserUsage WHERE UserId=@userId AND WeekStart=@weekStart`);

    res.status(200).json({ success: true, data: r.recordset[0] || null });
  } catch (error) {
    logger.error("V2 Get Usage Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get usage" });
  }
});

router.post("/v2/usage/increment", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const type = String(req.body?.type || "").toLowerCase();
  const amount = Math.max(1, Number(req.body?.amount || 1));

  if (!["general", "workout"].includes(type)) {
    return res.status(400).json({ message: "type must be 'general' or 'workout'" });
  }

  try {
    const pool = getPool();
    const weekStart = getWeekStartDateUTC(new Date());
    const weekStartStr = weekStart.toISOString().slice(0, 10);

    await pool
      .request()
      .input("userId", userId)
      .input("weekStart", weekStartStr)
      .input("amount", amount)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.UserUsage WHERE UserId=@userId AND WeekStart=@weekStart)
        BEGIN
          INSERT INTO dbo.UserUsage (UserId, WeekStart, CreateDate, GeneralInquiryCount, WorkoutInquiryCount)
          VALUES (@userId, @weekStart, SYSDATETIMEOFFSET(), 0, 0);
        END

        UPDATE dbo.UserUsage
        SET
          GeneralInquiryCount = GeneralInquiryCount + CASE WHEN @type='general' THEN @amount ELSE 0 END,
          WorkoutInquiryCount = WorkoutInquiryCount + CASE WHEN @type='workout' THEN @amount ELSE 0 END
        WHERE UserId=@userId AND WeekStart=@weekStart
      `.replace("@type", `'${type}'`));

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error("V2 Increment Usage Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to increment usage" });
  }
});

/**
 * UserStreaks
 * - GET /rewards/v2/streaks  (raw table rows)
 */
router.get("/v2/streaks", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const pool = getPool();
    const r = await pool.request().input("userId", userId).query(`
      SELECT UserId, StreakType, CurrentStreak, LongsStreak, LastActivityDate
      FROM dbo.UserStreaks
      WHERE UserId=@userId
    `);
    res.status(200).json({ success: true, data: r.recordset || [] });
  } catch (error) {
    logger.error("V2 Get Streaks Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get streaks" });
  }
});

/**
 * DailyXPAwards
 * - GET  /rewards/v2/daily-awards?date=YYYY-MM-DD
 * - POST /rewards/v2/daily-awards { AwardType, AwardDate?, XPAwardPoints }
 */
router.get("/v2/daily-awards", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const date = req.query.date ? String(req.query.date) : null;
  try {
    const pool = getPool();

    const q = date
      ? `
        SELECT UserId, AwardType, AwardDate, XPAwardPoints, Awarded_At_Date
        FROM dbo.DailyXPAwards
        WHERE UserId=@userId AND AwardDate=@date
        ORDER BY Awarded_At_Date DESC
      `
      : `
        SELECT TOP 50 UserId, AwardType, AwardDate, XPAwardPoints, Awarded_At_Date
        FROM dbo.DailyXPAwards
        WHERE UserId=@userId
        ORDER BY Awarded_At_Date DESC
      `;

    const reqq = pool.request().input("userId", userId);
    if (date) reqq.input("date", date);

    const r = await reqq.query(q);
    res.status(200).json({ success: true, data: r.recordset || [] });
  } catch (error) {
    logger.error("V2 Get Daily Awards Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get daily awards" });
  }
});

router.post("/v2/daily-awards", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { AwardType, AwardDate, XPAwardPoints } = req.body || {};
  if (!AwardType) return res.status(400).json({ message: "AwardType is required" });

  try {
    const pool = getPool();
    await pool
      .request()
      .input("userId", userId)
      .input("AwardType", String(AwardType))
      .input("AwardDate", AwardDate ? String(AwardDate) : null)
      .input("XPAwardPoints", Number(XPAwardPoints) || 0)
      .query(`
        INSERT INTO dbo.DailyXPAwards (UserId, AwardType, AwardDate, XPAwardPoints, Awarded_At_Date)
        VALUES (@userId, @AwardType, COALESCE(@AwardDate, CAST(GETDATE() AS DATE)), @XPAwardPoints, SYSDATETIMEOFFSET())
      `);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error("V2 Create Daily Award Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to create daily award" });
  }
});

/**
 * AI reconcile
 * - POST /rewards/v2/ai/reconcile
 *
 * Uses Gemini AI to:
 * - Analyze user activity (workouts, daily logs, streaks)
 * - Evaluate reward and challenge progress
 * - Award FitPoints for completed tasks
 * - Update progress in database
 */
router.post("/v2/ai/reconcile", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const pool = getPool();

  try {
    // Check if Gemini is configured
    if (!GOOGLE_API_KEY || GOOGLE_API_KEY === "undefined") {
      logger.info("AI reconcile skipped - Gemini not configured", { userId });
      return res.status(200).json({
        success: true,
        skipped: true,
        message: "AI reconcile not configured",
      });
    }

    // 1. Gather user context (last 30 days of activity)
    const [workoutsResult, dailyLogsResult, streaksResult, progressResult, challengesResult] = await Promise.all([
      // Recent workouts
      pool.request()
        .input("userId", userId)
        .query(`
          SELECT TOP 50 ExerciseName, Completed, WorkoutRoutineDate, Sets, Reps, Weight
          FROM dbo.ExerciseExistence
          WHERE UserID = @userId AND WorkoutRoutineDate >= DATEADD(DAY, -30, GETDATE())
          ORDER BY WorkoutRoutineDate DESC
        `),
      // Recent daily logs
      pool.request()
        .input("userId", userId)
        .query(`
          SELECT TOP 30 EffectiveDate, Steps, WaterIntake, SleepHours, CaloriesIn, CaloriesOut
          FROM dbo.DailyLogs
          WHERE UserID = @userId AND EffectiveDate >= DATEADD(DAY, -30, GETDATE())
          ORDER BY EffectiveDate DESC
        `),
      // Current streaks
      pool.request()
        .input("userId", userId)
        .query(`
          SELECT StreakType, CurrentStreak, LongestStreak, LastActivityDate
          FROM dbo.UserStreaks
          WHERE UserID = @userId
        `),
      // Current reward progress
      pool.request()
        .input("userId", userId)
        .query(`
          SELECT rd.RewardKey, rd.RewardName, rd.FitPointsValue, urp.CurrentProgress, urp.IsCompleted, urp.IsClaimed
          FROM dbo.RewardDefinitions rd
          LEFT JOIN dbo.UserRewardProgress urp ON rd.RewardID = urp.RewardID AND urp.UserID = @userId
          WHERE rd.IsActive = 1
        `),
      // Active challenges
      pool.request()
        .input("userId", userId)
        .query(`
          SELECT ChallengeID, Title, Description, Category, Difficulty, TargetValue, CurrentProgress, IsCompleted, FPReward
          FROM dbo.UserChallenges
          WHERE UserID = @userId AND IsCompleted = 0 AND ExpiresAt > GETDATE()
        `),
    ]);

    const workouts = workoutsResult.recordset || [];
    const dailyLogs = dailyLogsResult.recordset || [];
    const streaks = streaksResult.recordset || [];
    const rewardProgress = progressResult.recordset || [];
    const activeChallenges = challengesResult.recordset || [];

    // 2. Build context prompt for Gemini
    const contextPrompt = `
User Activity Summary (last 30 days):

WORKOUTS:
- Total workout sessions: ${workouts.filter(w => w.Completed).length}
- Unique workout days: ${new Set(workouts.filter(w => w.Completed).map(w => new Date(w.WorkoutRoutineDate).toDateString())).size}
- Recent exercises: ${workouts.slice(0, 10).map(w => w.ExerciseName).join(", ") || "None"}

DAILY LOGS:
- Days logged: ${dailyLogs.length}
- Average steps: ${dailyLogs.length > 0 ? Math.round(dailyLogs.reduce((s, d) => s + (d.Steps || 0), 0) / dailyLogs.length) : 0}
- Days with 10k+ steps: ${dailyLogs.filter(d => d.Steps >= 10000).length}
- Water logging days: ${dailyLogs.filter(d => d.WaterIntake > 0).length}
- Sleep logging days: ${dailyLogs.filter(d => d.SleepHours > 0).length}

CURRENT STREAKS:
${streaks.map(s => `- ${s.StreakType}: ${s.CurrentStreak} days (best: ${s.LongestStreak})`).join("\n") || "- No streaks recorded"}

REWARD PROGRESS:
${rewardProgress.map(r => `- ${r.RewardKey}: ${r.CurrentProgress || 0}% ${r.IsCompleted ? "(COMPLETED)" : ""} ${r.IsClaimed ? "(CLAIMED)" : ""}`).join("\n") || "- No reward progress"}

ACTIVE CHALLENGES:
${activeChallenges.map(c => `- [${c.ChallengeID}] ${c.Title} (${c.Category}/${c.Difficulty}): ${c.CurrentProgress}/${c.TargetValue} - ${c.FPReward} FP`).join("\n") || "- No active challenges"}

Based on this activity data, evaluate which rewards should be updated and calculate appropriate progress percentages.
Return JSON matching the schema.`;

    // 3. Call Gemini AI
    const ai = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const model = ai.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: { temperature: 0.2 },
      systemInstruction: REWARDS_RECONCILE_PROMPT,
    });

    const response = await model.generateContent(contextPrompt);
    const responseText = response.response?.text() || (typeof response.text === "function" ? response.text() : "");

    // 4. Parse response (handle markdown-wrapped JSON)
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseErr) {
      const raw = String(responseText || "");
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first >= 0 && last > first) {
        result = JSON.parse(raw.slice(first, last + 1));
      } else {
        throw new Error("Failed to parse AI response as JSON");
      }
    }

    logger.info("AI Reconcile parsed result", {
      userId,
      rewardsToUpdate: result.rewardsToUpdate?.length || 0,
      challengesToUpdate: result.challengesToUpdate?.length || 0,
      fpToAward: result.fpToAward || 0,
    });

    // 5. Apply updates in transaction
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      let totalFPAwarded = 0;

      // Update rewards
      for (const update of result.rewardsToUpdate || []) {
        if (!update.rewardKey) continue;

        const rewardResult = await transaction.request()
          .input("rewardKey", update.rewardKey)
          .query(`SELECT RewardID, FitPointsValue FROM dbo.RewardDefinitions WHERE RewardKey = @rewardKey`);

        if (rewardResult.recordset.length > 0) {
          const { RewardID, FitPointsValue } = rewardResult.recordset[0];

          // Upsert progress
          await transaction.request()
            .input("userId", userId)
            .input("rewardId", RewardID)
            .input("progress", Math.min(update.newProgress || 0, 100))
            .input("isCompleted", update.isCompleted ? 1 : 0)
            .query(`
              MERGE dbo.UserRewardProgress AS target
              USING (SELECT @userId AS UserID, @rewardId AS RewardID) AS source
              ON target.UserID = source.UserID AND target.RewardID = source.RewardID
              WHEN MATCHED THEN
                UPDATE SET CurrentProgress = @progress, IsCompleted = @isCompleted, UpdatedAt = GETDATE()
              WHEN NOT MATCHED THEN
                INSERT (UserID, RewardID, CurrentProgress, IsCompleted, IsClaimed, CreatedAt, UpdatedAt)
                VALUES (@userId, @rewardId, @progress, @isCompleted, 0, GETDATE(), GETDATE());
            `);

          // Award FP if newly completed and not yet claimed
          if (update.isCompleted) {
            const claimCheck = await transaction.request()
              .input("userId", userId)
              .input("rewardId", RewardID)
              .query(`SELECT IsClaimed FROM dbo.UserRewardProgress WHERE UserID = @userId AND RewardID = @rewardId`);

            if (claimCheck.recordset[0]?.IsClaimed === false) {
              totalFPAwarded += FitPointsValue || 0;
            }
          }
        }
      }

      // Update challenges
      for (const update of result.challengesToUpdate || []) {
        if (!update.challengeId) continue;

        await transaction.request()
          .input("challengeId", update.challengeId)
          .input("userId", userId)
          .input("progress", update.newProgress || 0)
          .input("isCompleted", update.isCompleted ? 1 : 0)
          .query(`
            UPDATE dbo.UserChallenges
            SET CurrentProgress = @progress,
                IsCompleted = @isCompleted,
                CompletedAt = CASE WHEN @isCompleted = 1 THEN GETDATE() ELSE NULL END
            WHERE ChallengeID = @challengeId AND UserID = @userId
          `);

        // Award FP for completed challenges
        if (update.isCompleted) {
          const challengeResult = await transaction.request()
            .input("challengeId", update.challengeId)
            .query(`SELECT FPReward FROM dbo.UserChallenges WHERE ChallengeID = @challengeId AND IsCompleted = 1`);

          if (challengeResult.recordset.length > 0) {
            totalFPAwarded += challengeResult.recordset[0].FPReward || 0;
          }
        }
      }

      // Update user's total FP if any awarded
      if (totalFPAwarded > 0) {
        await transaction.request()
          .input("userId", userId)
          .input("fp", totalFPAwarded)
          .query(`
            UPDATE dbo.UserRewards
            SET TotalFitPoints = TotalFitPoints + @fp, LastUpdated = GETDATE()
            WHERE UserID = @userId
          `);

        // Record in history
        await transaction.request()
          .input("userId", userId)
          .input("fp", totalFPAwarded)
          .input("reason", "AI Reconcile Award")
          .query(`
            INSERT INTO dbo.UserRewardHistory (UserID, FitPointsEarned, Reason, EarnedAt)
            VALUES (@userId, @fp, @reason, GETDATE())
          `);
      }

      await transaction.commit();

      res.status(200).json({
        success: true,
        updates: result.rewardsToUpdate || [],
        challengeUpdates: result.challengesToUpdate || [],
        fpAwarded: totalFPAwarded,
        summary: result.summary || "Reconciliation complete",
      });

    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }

  } catch (error) {
    logger.error("AI Reconcile Error", { error: error.message, stack: error.stack, userId });
    res.status(500).json({
      success: false,
      message: "AI reconcile failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================
// AI CHALLENGE ENDPOINTS
// ============================================

/**
 * @swagger
 * /rewards/challenges:
 *   get:
 *     summary: Get active AI-generated challenges
 *     description: Returns user's active challenges, optionally filtered by category
 *     tags: [Rewards]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly, universal]
 *     responses:
 *       200:
 *         description: Active challenges
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get("/challenges", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { category } = req.query;

  try {
    const challenges = await challengeGenerator.getActiveChallenges(userId, category);

    // Group by category if no filter
    let grouped = {};
    if (!category) {
      grouped = {
        daily: challenges.filter(c => c.category === "daily"),
        weekly: challenges.filter(c => c.category === "weekly"),
        monthly: challenges.filter(c => c.category === "monthly"),
        universal: challenges.filter(c => c.category === "universal"),
      };
    }

    res.status(200).json({
      challenges: category ? challenges : undefined,
      grouped: !category ? grouped : undefined,
      total: challenges.length,
    });
  } catch (error) {
    logger.error("Get Challenges Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get challenges" });
  }
});

/**
 * @swagger
 * /rewards/generate-challenges:
 *   post:
 *     summary: Generate AI-powered personalized challenges
 *     description: Ensures user has 3 challenges per category, generating new ones as needed
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: Challenge generation result
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post("/generate-challenges", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await challengeGenerator.ensureChallengesExist(userId);

    res.status(200).json({
      success: true,
      message: "Challenges generated",
      ...result,
    });
  } catch (error) {
    logger.error("Generate Challenges Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to generate challenges" });
  }
});

/**
 * @swagger
 * /rewards/challenges/{challengeId}:
 *   delete:
 *     summary: Delete a challenge with feedback
 *     description: Soft-deletes a challenge and records user feedback for AI improvement
 *     tags: [Rewards]
 *     parameters:
 *       - in: path
 *         name: challengeId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - feedbackType
 *             properties:
 *               feedbackType:
 *                 type: string
 *                 enum: [too_hard, too_easy, not_relevant, takes_too_long, already_doing]
 *               feedbackText:
 *                 type: string
 *     responses:
 *       200:
 *         description: Challenge deleted with replacement generated
 *       400:
 *         description: Invalid request
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Challenge not found
 */
router.delete("/challenges/:challengeId", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const challengeId = parseInt(req.params.challengeId);
  const { feedbackType, feedbackText } = req.body;

  if (isNaN(challengeId)) {
    return res.status(400).json({ message: "Invalid challenge ID" });
  }

  const validFeedbackTypes = ["too_hard", "too_easy", "not_relevant", "takes_too_long", "already_doing"];
  if (!feedbackType || !validFeedbackTypes.includes(feedbackType)) {
    return res.status(400).json({
      message: "Invalid feedback type",
      validTypes: validFeedbackTypes,
    });
  }

  try {
    const result = await challengeGenerator.deleteChallenge(
      userId,
      challengeId,
      feedbackType,
      feedbackText
    );

    if (!result.success) {
      return res.status(404).json({ message: result.message });
    }

    res.status(200).json(result);
  } catch (error) {
    logger.error("Delete Challenge Error", { error: error.message, userId, challengeId });
    res.status(500).json({ message: "Failed to delete challenge" });
  }
});

/**
 * @swagger
 * /rewards/challenges/{challengeId}/complete:
 *   post:
 *     summary: Mark a challenge as completed
 *     description: Awards FitPoints and generates a harder replacement challenge
 *     tags: [Rewards]
 *     parameters:
 *       - in: path
 *         name: challengeId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Challenge completed, FitPoints awarded
 *       400:
 *         description: Invalid request
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Challenge not found
 */
router.post("/challenges/:challengeId/complete", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const challengeId = parseInt(req.params.challengeId);

  if (isNaN(challengeId)) {
    return res.status(400).json({ message: "Invalid challenge ID" });
  }

  try {
    const result = await challengeGenerator.completeChallenge(userId, challengeId);

    if (!result.success) {
      return res.status(404).json({ message: result.message });
    }

    res.status(200).json(result);
  } catch (error) {
    logger.error("Complete Challenge Error", { error: error.message, userId, challengeId });
    res.status(500).json({ message: "Failed to complete challenge" });
  }
});

/**
 * @swagger
 * /rewards/challenges/{challengeId}/progress:
 *   post:
 *     summary: Update challenge progress
 *     description: Increment progress on a challenge (for manual tracking)
 *     tags: [Rewards]
 *     parameters:
 *       - in: path
 *         name: challengeId
 *         required: true
 *         schema:
 *           type: integer
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
 */
router.post("/challenges/:challengeId/progress", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const challengeId = parseInt(req.params.challengeId);
  const rawIncrement = req.body.increment;

  // Validate increment: must be a positive integer, default to 1
  const increment = rawIncrement !== undefined ? parseInt(rawIncrement, 10) : 1;
  if (isNaN(increment) || increment < 1 || increment > 100) {
    return res.status(400).json({
      message: "Invalid increment value. Must be a positive integer between 1 and 100."
    });
  }

  if (isNaN(challengeId)) {
    return res.status(400).json({ message: "Invalid challenge ID" });
  }

  try {
    const pool = getPool();

    // Get current challenge
    const result = await pool.request()
      .input("userId", userId)
      .input("challengeId", challengeId)
      .query(`
        SELECT GeneratedChallengeID, CurrentProgress, RequiredCount, IsCompleted
        FROM dbo.GeneratedChallenges
        WHERE GeneratedChallengeID = @challengeId
          AND UserID = @userId
          AND IsActive = 1
          AND IsDeleted = 0
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "Challenge not found" });
    }

    const challenge = result.recordset[0];

    if (challenge.IsCompleted) {
      return res.status(200).json({
        success: true,
        alreadyCompleted: true,
        currentProgress: challenge.CurrentProgress,
        requiredCount: challenge.RequiredCount,
      });
    }

    // Update progress
    const newProgress = Math.min(challenge.CurrentProgress + increment, challenge.RequiredCount);
    const isNowComplete = newProgress >= challenge.RequiredCount;

    await pool.request()
      .input("challengeId", challengeId)
      .input("newProgress", newProgress)
      .query(`
        UPDATE dbo.GeneratedChallenges
        SET CurrentProgress = @newProgress
        WHERE GeneratedChallengeID = @challengeId
      `);

    // If completed, trigger full completion
    if (isNowComplete) {
      const completionResult = await challengeGenerator.completeChallenge(userId, challengeId);
      return res.status(200).json(completionResult);
    }

    res.status(200).json({
      success: true,
      currentProgress: newProgress,
      requiredCount: challenge.RequiredCount,
      progressPercent: Math.round((newProgress / challenge.RequiredCount) * 100),
    });
  } catch (error) {
    logger.error("Update Challenge Progress Error", { error: error.message, userId, challengeId });
    res.status(500).json({ message: "Failed to update challenge progress" });
  }
});

/**
 * @swagger
 * /rewards/tier-benefits:
 *   get:
 *     summary: Get tier benefits information
 *     description: Returns benefits for all tiers with user's current tier highlighted
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: Tier benefits data
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get("/tier-benefits", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const pool = getPool();

    // Get user's current tier and level
    const result = await pool.request()
      .input("userId", userId)
      .query(`
        SELECT TotalFitPoints, CurrentTier, CurrentLevel
        FROM dbo.UserRewards
        WHERE UserID = @userId
      `);

    const user = result.recordset[0] || { TotalFitPoints: 0, CurrentTier: "BRONZE", CurrentLevel: 1 };
    const levelProgress = levelCalculator.getLevelProgress(user.TotalFitPoints || 0);

    // Build tier benefits with unlock status
    const tierOrder = ["BRONZE", "SILVER", "GOLD", "EXCLUSIVE", "CHAMPION"];
    const tierMinLevels = {
      BRONZE: 1,
      SILVER: 6,
      GOLD: 11,
      EXCLUSIVE: 16,
      CHAMPION: 21,
    };

    const tiers = tierOrder.map(tierName => ({
      name: tierName,
      displayName: levelCalculator.getTierNameFromLevel(tierMinLevels[tierName]),
      minLevel: tierMinLevels[tierName],
      benefits: challengeGenerator.TIER_BENEFITS[tierName] || [],
      isUnlocked: levelProgress.level >= tierMinLevels[tierName],
      isCurrent: levelProgress.tier === tierName,
    }));

    res.status(200).json({
      currentTier: levelProgress.tier,
      currentLevel: levelProgress.level,
      totalFitPoints: user.TotalFitPoints || 0,
      tiers,
    });
  } catch (error) {
    logger.error("Get Tier Benefits Error", { error: error.message, userId });
    res.status(500).json({ message: "Failed to get tier benefits" });
  }
});

module.exports = router;
