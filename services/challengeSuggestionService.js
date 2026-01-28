/**
 * Challenge Suggestion Service
 *
 * AI-powered service for generating personalized, progressive challenge SUGGESTIONS
 * that users can Accept or Decline. Suggestions are ephemeral (not stored until accepted).
 *
 * Uses Gemini AI with compact prompts optimized for ~2-3 second response times.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getPool } = require("../config/db");
const logger = require("../utils/logger");
const levelCalculator = require("./levelCalculator");

// API Configuration
const GOOGLE_API_KEY = process.env.GEMINI_API_KEY || "undefined";
const MODEL_NAME = process.env.GEMINI_MODEL_NAME || "gemini-2.0-flash";

// FitPoints by difficulty
const FITPOINTS_BY_DIFFICULTY = {
  Easy: 15,
  Medium: 30,
  Hard: 50,
};

// Rate limits for suggestion generation
const SUGGESTION_RATE_LIMITS = {
  HOURLY: 10,  // Max 10 suggestions per hour
  DAILY: 20,   // Max 20 suggestions per day (24 hours)
};

// Preferred difficulty by tier
const TIER_DIFFICULTY_PREFERENCE = {
  BRONZE: "Easy",
  SILVER: "Medium",
  GOLD: "Medium",
  EXCLUSIVE: "Hard",
  CHAMPION: "Hard",
};

// Compact system instruction (~200 tokens)
const SUGGESTION_SYSTEM_PROMPT = `You are FitPoints Challenge AI. Generate progressive fitness challenges.

RULES:
- Push 10-20% beyond user's recent performance
- Match difficulty to user's tier
- Avoid patterns user has declined
- NEVER suggest anything similar to items listed in ACTIVE - these are challenges user already has
- Return ONLY valid JSON array

AVOID (already covered by static rewards - generate SPECIFIC versions instead):
- "Log water" / "Track hydration" → use specific amounts like "Drink 150oz this week"
- "Complete a workout" → use specific counts like "Complete 5 workouts this week"
- "Sign in" / "Open the app" → use streaks like "7-day login streak"
- "Log sleep" / "Track sleep" → use quality goals like "Get 7+ hours 5 nights this week"
- "Log your stats" → use specific metrics like "Hit 10k steps 4 days this week"

OUTPUT: [{"title":"...","description":"...","difficulty":"Easy|Medium|Hard","requiredCount":N,"fitPoints":15|30|50}]`;

/**
 * Initialize Gemini AI model with optimized settings for fast responses
 */
function initializeModel() {
  const apiKeyValid = GOOGLE_API_KEY && GOOGLE_API_KEY !== "undefined" && String(GOOGLE_API_KEY).trim() !== "";
  if (!apiKeyValid) {
    logger.warn("Gemini API key not configured for challenge suggestions");
    return null;
  }

  try {
    const ai = new GoogleGenerativeAI(GOOGLE_API_KEY);
    return ai.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 512, // Limit response size for speed
      },
      systemInstruction: SUGGESTION_SYSTEM_PROMPT,
    });
  } catch (error) {
    logger.error("Failed to initialize Gemini model for suggestions", { error: error.message });
    return null;
  }
}

/**
 * Gather user's recent performance context for progressive suggestions
 * Optimized with parallel queries (~200ms)
 *
 * @param {number} userId - User ID
 * @returns {Promise<Object>} User context data
 */
async function getUserProgressContext(userId) {
  const pool = getPool();

  // Run all context queries in parallel for speed
  const [
    profileResult,
    yesterdayResult,
    weeklyResult,
    completedResult,
    feedbackResult,
    activeChallengesResult,
    activeRewardsResult,
  ] = await Promise.all([
    // User profile and tier
    pool.request()
      .input("userId", userId)
      .query(`
        SELECT
          ur.TotalFitPoints, ur.CurrentTier, ur.CurrentLevel,
          up.FitnessGoal, up.FitnessLevel
        FROM dbo.UserRewards ur
        LEFT JOIN dbo.UserProfile up ON ur.UserID = up.UserID
        WHERE ur.UserID = @userId
      `),

    // Yesterday's stats
    pool.request()
      .input("userId", userId)
      .query(`
        SELECT Steps, WaterIntake, Sleep
        FROM dbo.DailyLogs
        WHERE UserID = @userId
          AND EffectiveDate = CAST(DATEADD(DAY, -1, GETDATE()) AS DATE)
      `),

    // Weekly averages and counts
    pool.request()
      .input("userId", userId)
      .query(`
        SELECT
          AVG(Steps) as avgSteps,
          COUNT(DISTINCT CASE WHEN Steps >= 10000 THEN EffectiveDate END) as daysOver10k,
          COUNT(DISTINCT EffectiveDate) as daysLogged
        FROM dbo.DailyLogs
        WHERE UserID = @userId
          AND EffectiveDate >= DATEADD(DAY, -7, GETDATE())
      `),

    // Recently completed challenges (last 14 days)
    pool.request()
      .input("userId", userId)
      .query(`
        SELECT TOP 5 ChallengeTitle, Difficulty, RequiredCount
        FROM dbo.GeneratedChallenges
        WHERE UserID = @userId
          AND IsCompleted = 1
          AND CompletedAt >= DATEADD(DAY, -14, GETDATE())
        ORDER BY CompletedAt DESC
      `),

    // Feedback patterns (declined challenges in last 90 days)
    pool.request()
      .input("userId", userId)
      .query(`
        SELECT FeedbackType, COUNT(*) as Count
        FROM dbo.ChallengeFeedback
        WHERE UserID = @userId
          AND CreatedAt >= DATEADD(DAY, -90, GETDATE())
        GROUP BY FeedbackType
        ORDER BY Count DESC
      `),

    // Currently active AI-generated challenges (not completed, not expired)
    pool.request()
      .input("userId", userId)
      .query(`
        SELECT ChallengeTitle, Difficulty, RequiredCount, CurrentProgress
        FROM dbo.GeneratedChallenges
        WHERE UserID = @userId
          AND IsActive = 1
          AND IsCompleted = 0
          AND IsDeleted = 0
          AND (ExpiresAt IS NULL OR ExpiresAt > SYSDATETIMEOFFSET())
      `),

    // Currently in-progress static rewards (started but not completed)
    pool.request()
      .input("userId", userId)
      .query(`
        SELECT rd.Name, rd.Description, rd.Category, urp.CurrentProgress, rd.RequiredCount
        FROM dbo.UserRewardProgress urp
        JOIN dbo.RewardDefinitions rd ON urp.RewardID = rd.RewardID
        WHERE urp.UserID = @userId
          AND urp.IsCompleted = 0
          AND urp.CurrentProgress > 0
          AND rd.IsActive = 1
      `),
  ]);

  // Also get workout count for the week
  const workoutResult = await pool.request()
    .input("userId", userId)
    .query(`
      SELECT COUNT(DISTINCT CAST(Date AS DATE)) as workoutDays
      FROM dbo.ExerciseExistence
      WHERE UserID = @userId
        AND Completed = 1
        AND Date >= DATEADD(DAY, -7, GETDATE())
    `);

  const profile = profileResult.recordset[0] || {};
  const yesterday = yesterdayResult.recordset[0] || {};
  const weekly = weeklyResult.recordset[0] || {};
  const workouts = workoutResult.recordset[0] || {};

  // Format completed challenges
  const completed = completedResult.recordset.map(c => c.ChallengeTitle);

  // Format feedback patterns (type -> count)
  const feedbackPatterns = {};
  feedbackResult.recordset.forEach(row => {
    feedbackPatterns[row.FeedbackType] = row.Count;
  });

  // Format active AI challenges (currently in progress)
  const activeChallenges = activeChallengesResult.recordset.map(c => c.ChallengeTitle);

  // Format active static rewards (in progress but not completed)
  const activeRewards = activeRewardsResult.recordset.map(r => r.Name);

  // Get level info
  const totalFitPoints = profile.TotalFitPoints || 0;
  const levelProgress = levelCalculator.getLevelProgress(totalFitPoints);

  return {
    // Profile
    tier: levelProgress.tier,
    level: levelProgress.level,
    totalFitPoints,
    fitnessGoal: profile.FitnessGoal || "general fitness",
    fitnessLevel: profile.FitnessLevel || "beginner",

    // Yesterday's performance
    yesterdaySteps: yesterday.Steps || 0,
    yesterdayWater: yesterday.WaterIntake || 0,
    yesterdaySleep: yesterday.Sleep || 0,

    // Weekly performance
    avgSteps: Math.round(weekly.avgSteps || 0),
    daysOver10k: weekly.daysOver10k || 0,
    daysLogged: weekly.daysLogged || 0,
    workoutsThisWeek: workouts.workoutDays || 0,

    // History
    completedChallenges: completed,
    feedbackPatterns,

    // Currently active (to avoid duplicates)
    activeChallenges,
    activeRewards,
  };
}

/**
 * Build compact prompt for AI (~300 tokens total)
 *
 * @param {Object} context - User context from getUserProgressContext
 * @param {number} count - Number of suggestions to generate
 * @returns {string} Formatted prompt
 */
function buildCompactPrompt(context, count) {
  // Format feedback to avoid
  const avoidPatterns = Object.entries(context.feedbackPatterns)
    .filter(([, cnt]) => cnt >= 2) // Only avoid if declined 2+ times
    .map(([type]) => type.replace(/_/g, " "))
    .join(", ") || "none";

  // Preferred difficulty based on tier
  const preferredDifficulty = TIER_DIFFICULTY_PREFERENCE[context.tier] || "Medium";

  // Combine active challenges and rewards to avoid duplicates
  const activeItems = [
    ...context.activeChallenges,
    ...context.activeRewards,
  ].slice(0, 10); // Limit to 10 to keep prompt size reasonable
  const activeList = activeItems.length > 0 ? activeItems.join(", ") : "none";

  return `Generate ${count} progressive challenges for this user:

RECENT: ${context.yesterdaySteps} steps yesterday, ${context.workoutsThisWeek} workouts last week, avg ${context.avgSteps} daily steps
COMPLETED: ${context.completedChallenges.slice(0, 3).join(", ") || "None recently"}
ACTIVE (DO NOT DUPLICATE): ${activeList}
AVOID: ${avoidPatterns}
TIER: ${context.tier} (${preferredDifficulty} difficulty preferred)
GOAL: ${context.fitnessGoal}

Rules: Push 10-20% beyond recent performance. DO NOT suggest anything similar to ACTIVE items. Return JSON array only.
[{"title":"...","description":"...","difficulty":"Easy|Medium|Hard","requiredCount":N,"fitPoints":15|30|50}]`;
}

/**
 * Generate fallback suggestions when AI is unavailable
 * Based on user's tier and recent performance
 *
 * @param {Object} context - User context
 * @param {number} count - Number of suggestions
 * @returns {Array} Fallback suggestions
 */
function generateFallbackSuggestions(context, count) {
  // Combine active challenges and rewards for duplicate checking
  const activeItems = [
    ...(context.activeChallenges || []),
    ...(context.activeRewards || []),
  ].map(item => item.toLowerCase());

  // Helper to check if a title is similar to active items
  const isSimilarToActive = (title) => {
    const lowerTitle = title.toLowerCase();
    return activeItems.some(active => {
      // Check for exact match or significant overlap
      const activeWords = active.split(/\s+/);
      const titleWords = lowerTitle.split(/\s+/);
      const commonWords = activeWords.filter(w => titleWords.includes(w) && w.length > 3);
      return active === lowerTitle || commonWords.length >= 2;
    });
  };

  // Progressive suggestions based on yesterday's performance
  const suggestions = [];

  // Step-based suggestion (10-20% increase)
  if (context.yesterdaySteps > 0) {
    const targetSteps = Math.round(context.yesterdaySteps * 1.15 / 1000) * 1000; // Round to nearest 1000
    const stepChallenge = {
      title: `Hit ${targetSteps.toLocaleString()} Steps Today`,
      description: `Beat yesterday's ${context.yesterdaySteps.toLocaleString()} steps by aiming for ${targetSteps.toLocaleString()}`,
      difficulty: targetSteps >= 12000 ? "Hard" : targetSteps >= 8000 ? "Medium" : "Easy",
      requiredCount: 1,
      fitPoints: FITPOINTS_BY_DIFFICULTY[targetSteps >= 12000 ? "Hard" : targetSteps >= 8000 ? "Medium" : "Easy"],
    };
    if (!isSimilarToActive(stepChallenge.title)) {
      suggestions.push(stepChallenge);
    }
  } else {
    const basicStepChallenge = {
      title: "Take 5,000 Steps Today",
      description: "Start building your step streak with a manageable goal",
      difficulty: "Easy",
      requiredCount: 1,
      fitPoints: 15,
    };
    if (!isSimilarToActive(basicStepChallenge.title)) {
      suggestions.push(basicStepChallenge);
    }
  }

  // Workout-based suggestion
  const targetWorkouts = Math.max(context.workoutsThisWeek + 1, 3);
  const workoutChallenge = {
    title: `Complete ${targetWorkouts} Workouts This Week`,
    description: `You've done ${context.workoutsThisWeek} so far - keep the momentum going!`,
    difficulty: targetWorkouts >= 5 ? "Hard" : targetWorkouts >= 3 ? "Medium" : "Easy",
    requiredCount: targetWorkouts,
    fitPoints: FITPOINTS_BY_DIFFICULTY[targetWorkouts >= 5 ? "Hard" : targetWorkouts >= 3 ? "Medium" : "Easy"],
  };
  if (!isSimilarToActive(workoutChallenge.title)) {
    suggestions.push(workoutChallenge);
  }

  // Consistency suggestion (specific, not generic "log stats")
  const consistencyChallenge = {
    title: "Hit 8k Steps 5 Days This Week",
    description: "Build consistency by reaching 8,000 steps on 5 different days",
    difficulty: "Medium",
    requiredCount: 5,
    fitPoints: 30,
  };
  if (!isSimilarToActive(consistencyChallenge.title)) {
    suggestions.push(consistencyChallenge);
  }

  // Harder suggestion for higher tiers
  if (context.tier === "GOLD" || context.tier === "EXCLUSIVE" || context.tier === "CHAMPION") {
    const streakChallenge = {
      title: "7-Day Step Streak",
      description: "Hit 10,000 steps for 7 consecutive days",
      difficulty: "Hard",
      requiredCount: 7,
      fitPoints: 50,
    };
    if (!isSimilarToActive(streakChallenge.title)) {
      suggestions.push(streakChallenge);
    }
  }

  // Additional fallback suggestions if we filtered too many out
  const additionalSuggestions = [
    {
      title: "Morning Movement: 3 Workouts Before Noon",
      description: "Complete 3 workouts before 12 PM this week",
      difficulty: "Medium",
      requiredCount: 3,
      fitPoints: 30,
    },
    {
      title: "Hydration Hero: 100oz Water 5 Days",
      description: "Drink at least 100oz of water on 5 different days",
      difficulty: "Medium",
      requiredCount: 5,
      fitPoints: 30,
    },
    {
      title: "Active Rest Day",
      description: "Hit 7,000 steps on a non-workout day",
      difficulty: "Easy",
      requiredCount: 1,
      fitPoints: 15,
    },
  ];

  for (const s of additionalSuggestions) {
    if (suggestions.length >= count + 2) break; // Keep a buffer
    if (!isSimilarToActive(s.title)) {
      suggestions.push(s);
    }
  }

  // Shuffle and return requested count
  const shuffled = suggestions.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Generate personalized, progressive challenge suggestions
 * Suggestions are ephemeral - NOT stored until user accepts
 *
 * @param {number} userId - User ID
 * @param {number} count - Number of suggestions to generate (default: 3)
 * @returns {Promise<Object>} { suggestions: Array, fromAI: boolean }
 */
async function generateProgressiveSuggestions(userId, count = 3) {
  const startTime = Date.now();

  try {
    // Get user context (~200ms)
    const context = await getUserProgressContext(userId);

    // Initialize AI model
    const model = initializeModel();

    if (!model) {
      logger.info("AI not available, using fallback suggestions", { userId });
      return {
        suggestions: generateFallbackSuggestions(context, count),
        fromAI: false,
        context: {
          tier: context.tier,
          level: context.level,
          yesterdaySteps: context.yesterdaySteps,
          workoutsThisWeek: context.workoutsThisWeek,
        },
        generationTimeMs: Date.now() - startTime,
      };
    }

    // Build compact prompt
    const prompt = buildCompactPrompt(context, count);

    // Call Gemini with timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI timeout")), 10000)
    );

    const aiPromise = model.generateContent(prompt);
    const result = await Promise.race([aiPromise, timeoutPromise]);

    const responseText = result.response?.text() || "";

    // Parse JSON from response
    let suggestions;
    try {
      // Try direct parse first
      suggestions = JSON.parse(responseText);
    } catch {
      // Extract JSON array from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("Could not parse AI response as JSON");
      }
      suggestions = JSON.parse(jsonMatch[0]);
    }

    // Validate and normalize suggestions
    const normalized = suggestions.map(s => ({
      title: (s.title || "Fitness Challenge").substring(0, 100),
      description: (s.description || "Complete this challenge").substring(0, 200),
      difficulty: ["Easy", "Medium", "Hard"].includes(s.difficulty) ? s.difficulty : "Medium",
      requiredCount: Math.max(1, Math.min(100, parseInt(s.requiredCount) || 1)),
      fitPoints: FITPOINTS_BY_DIFFICULTY[s.difficulty] || 30,
    }));

    const generationTimeMs = Date.now() - startTime;
    logger.info("AI suggestions generated", { userId, count: normalized.length, timeMs: generationTimeMs });

    return {
      suggestions: normalized.slice(0, count),
      fromAI: true,
      context: {
        tier: context.tier,
        level: context.level,
        yesterdaySteps: context.yesterdaySteps,
        workoutsThisWeek: context.workoutsThisWeek,
      },
      generationTimeMs,
    };

  } catch (error) {
    const generationTimeMs = Date.now() - startTime;
    logger.error("AI suggestion generation failed, using fallback", {
      error: error.message,
      userId,
      timeMs: generationTimeMs,
    });

    // Fall back to non-AI suggestions
    const context = await getUserProgressContext(userId);
    return {
      suggestions: generateFallbackSuggestions(context, count),
      fromAI: false,
      fallbackReason: error.message,
      context: {
        tier: context.tier,
        level: context.level,
        yesterdaySteps: context.yesterdaySteps,
        workoutsThisWeek: context.workoutsThisWeek,
      },
      generationTimeMs,
    };
  }
}

/**
 * Determine challenge category based on expiry timeframe
 *
 * @param {Date|null} expiresAt - Challenge expiration date
 * @returns {string} Category: 'daily', 'weekly', or 'monthly'
 */
function getCategoryByExpiry(expiresAt) {
  if (!expiresAt) return "monthly"; // No expiry = monthly
  const hoursUntilExpiry = (new Date(expiresAt) - new Date()) / (1000 * 60 * 60);
  if (hoursUntilExpiry <= 24) return "daily";
  if (hoursUntilExpiry <= 168) return "weekly"; // 7 days
  return "monthly";
}

/**
 * Accept a suggestion - store it as an active challenge
 *
 * @param {number} userId - User ID
 * @param {Object} suggestion - The suggestion object to accept
 * @returns {Promise<Object>} Stored challenge with ID
 */
async function acceptSuggestion(userId, suggestion) {
  const pool = getPool();

  // Check for existing active challenge with same title to prevent duplicates
  const existingCheck = await pool.request()
    .input('userId', userId)
    .input('title', suggestion.title)
    .query(`
      SELECT
        GeneratedChallengeID as id,
        ChallengeTitle as title,
        ChallengeDescription as description,
        FitPointsValue as fitPoints,
        Category as category,
        Difficulty as difficulty,
        RequiredCount as requiredCount,
        CurrentProgress as currentProgress,
        ExpiresAt as expiresAt,
        IsActive as isActive,
        CreatedAt as createdAt
      FROM dbo.GeneratedChallenges
      WHERE UserID = @userId
        AND ChallengeTitle = @title
        AND IsActive = 1
        AND (ExpiresAt IS NULL OR ExpiresAt > SYSDATETIMEOFFSET())
    `);

  if (existingCheck.recordset.length > 0) {
    // Return existing challenge instead of creating duplicate
    logger.info("Duplicate challenge prevented", { userId, title: suggestion.title });
    return existingCheck.recordset[0];
  }

  // Calculate expiration based on difficulty/type
  let expiresAt = null;
  const now = new Date();

  // Default: weekly expiration for accepted suggestions
  if (suggestion.requiredCount <= 1) {
    expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours for single-action
  } else if (suggestion.requiredCount <= 7) {
    expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  } else {
    expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days for larger goals
  }

  // Set category based on expiry timeframe (daily/weekly/monthly)
  const category = getCategoryByExpiry(expiresAt);

  const result = await pool.request()
    .input("userId", userId)
    .input("title", suggestion.title)
    .input("description", suggestion.description)
    .input("fitPoints", suggestion.fitPoints || FITPOINTS_BY_DIFFICULTY[suggestion.difficulty] || 30)
    .input("category", category) // Category based on expiry timeframe
    .input("difficulty", suggestion.difficulty)
    .input("requiredCount", suggestion.requiredCount)
    .input("expiresAt", expiresAt)
    .query(`
      INSERT INTO dbo.GeneratedChallenges
        (UserID, ChallengeTitle, ChallengeDescription, FitPointsValue, Category, Difficulty, RequiredCount, ExpiresAt, IsActive, CurrentProgress)
      OUTPUT
        INSERTED.GeneratedChallengeID as id,
        INSERTED.ChallengeTitle as title,
        INSERTED.ChallengeDescription as description,
        INSERTED.FitPointsValue as fitPoints,
        INSERTED.Category as category,
        INSERTED.Difficulty as difficulty,
        INSERTED.RequiredCount as requiredCount,
        INSERTED.CurrentProgress as currentProgress,
        INSERTED.ExpiresAt as expiresAt,
        INSERTED.IsActive as isActive,
        INSERTED.CreatedAt as createdAt
      VALUES (@userId, @title, @description, @fitPoints, @category, @difficulty, @requiredCount, @expiresAt, 1, 0)
    `);

  const stored = result.recordset[0];
  logger.info("Suggestion accepted", { userId, challengeId: stored.id, title: stored.title });

  return stored;
}

/**
 * Decline a suggestion - record feedback for AI learning
 * Does NOT store the challenge
 *
 * @param {number} userId - User ID
 * @param {Object} suggestion - The suggestion that was declined
 * @param {string} feedbackType - Reason for declining
 * @returns {Promise<Object>} Result
 */
async function declineSuggestion(userId, suggestion, feedbackType) {
  const pool = getPool();

  // Valid feedback types
  const validTypes = ["too_hard", "too_easy", "not_interested", "takes_too_long", "already_doing"];
  if (!validTypes.includes(feedbackType)) {
    return {
      success: false,
      message: `Invalid feedback type. Valid types: ${validTypes.join(", ")}`,
    };
  }

  // Get user's current tier for context
  const tierResult = await pool.request()
    .input("userId", userId)
    .query(`SELECT CurrentTier FROM dbo.UserRewards WHERE UserID = @userId`);

  const tier = tierResult.recordset[0]?.CurrentTier || "BRONZE";

  // Store feedback (without a challenge ID since it was never stored)
  await pool.request()
    .input("userId", userId)
    .input("feedbackType", feedbackType)
    .input("feedbackText", suggestion.title) // Store the declined title as context
    .input("difficulty", suggestion.difficulty)
    .input("tier", tier)
    .query(`
      INSERT INTO dbo.ChallengeFeedback
        (UserID, ChallengeID, FeedbackType, FeedbackText, DifficultyAtDeletion, UserTierAtDeletion)
      VALUES (@userId, NULL, @feedbackType, @feedbackText, @difficulty, @tier)
    `);

  logger.info("Suggestion declined", { userId, feedbackType, title: suggestion.title });

  return {
    success: true,
    feedbackRecorded: true,
    feedbackType,
  };
}

/**
 * Auto-track workout completion for AI challenges
 *
 * Called when a user completes a workout. Finds and updates any active
 * workout-related AI challenges (e.g., "Complete 3 workouts this week").
 *
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Updated challenges info
 */
async function trackWorkoutCompletion(userId) {
  const pool = getPool();

  // Patterns that indicate workout-related challenges
  const workoutPatterns = [
    "%workout%",
    "%exercise%",
    "%training%",
    "%session%",
    "%routine%",
  ];

  try {
    // Find active challenges that match workout patterns
    const patternConditions = workoutPatterns
      .map((_, i) => `ChallengeTitle LIKE @pattern${i} OR ChallengeDescription LIKE @pattern${i}`)
      .join(" OR ");

    const request = pool.request().input("userId", userId);
    workoutPatterns.forEach((pattern, i) => {
      request.input(`pattern${i}`, pattern);
    });

    const result = await request.query(`
      SELECT
        GeneratedChallengeID as id,
        ChallengeTitle as title,
        CurrentProgress as currentProgress,
        RequiredCount as requiredCount,
        FitPointsValue as fitPoints,
        IsCompleted as isCompleted
      FROM dbo.GeneratedChallenges
      WHERE UserID = @userId
        AND IsActive = 1
        AND IsDeleted = 0
        AND IsCompleted = 0
        AND (ExpiresAt IS NULL OR ExpiresAt > SYSDATETIMEOFFSET())
        AND (${patternConditions})
    `);

    const updatedChallenges = [];

    for (const challenge of result.recordset) {
      const newProgress = challenge.currentProgress + 1;
      const isNowCompleted = newProgress >= challenge.requiredCount;

      // Update progress
      await pool.request()
        .input("challengeId", challenge.id)
        .input("newProgress", newProgress)
        .input("isCompleted", isNowCompleted ? 1 : 0)
        .query(`
          UPDATE dbo.GeneratedChallenges
          SET CurrentProgress = @newProgress,
              IsCompleted = @isCompleted,
              CompletedAt = CASE WHEN @isCompleted = 1 THEN SYSDATETIMEOFFSET() ELSE NULL END
          WHERE GeneratedChallengeID = @challengeId
        `);

      updatedChallenges.push({
        id: challenge.id,
        title: challenge.title,
        previousProgress: challenge.currentProgress,
        newProgress,
        requiredCount: challenge.requiredCount,
        isCompleted: isNowCompleted,
        fitPoints: isNowCompleted ? challenge.fitPoints : 0,
      });

      logger.info("Auto-tracked workout for challenge", {
        userId,
        challengeId: challenge.id,
        title: challenge.title,
        progress: `${newProgress}/${challenge.requiredCount}`,
        completed: isNowCompleted,
      });
    }

    return {
      success: true,
      updatedCount: updatedChallenges.length,
      challenges: updatedChallenges,
    };
  } catch (error) {
    logger.error("trackWorkoutCompletion error:", error.message);
    return {
      success: false,
      error: error.message,
      updatedCount: 0,
      challenges: [],
    };
  }
}

/**
 * Check if user has exceeded suggestion generation rate limits
 *
 * @param {number} userId - User ID
 * @param {number} requestedCount - Number of suggestions being requested
 * @returns {Promise<Object>} Rate limit status
 */
async function checkSuggestionRateLimit(userId, requestedCount = 3) {
  const pool = getPool();

  try {
    const result = await pool.request()
      .input('userId', userId)
      .query(`
        SELECT
          ISNULL(SUM(CASE WHEN GeneratedAt >= DATEADD(HOUR, -1, SYSDATETIME()) THEN SuggestionCount ELSE 0 END), 0) AS HourlyUsed,
          ISNULL(SUM(CASE WHEN GeneratedAt >= DATEADD(HOUR, -24, SYSDATETIME()) THEN SuggestionCount ELSE 0 END), 0) AS DailyUsed
        FROM dbo.ChallengeSuggestionUsage
        WHERE UserID = @userId
      `);

    const { HourlyUsed, DailyUsed } = result.recordset[0];
    const hourlyRemaining = Math.max(0, SUGGESTION_RATE_LIMITS.HOURLY - HourlyUsed);
    const dailyRemaining = Math.max(0, SUGGESTION_RATE_LIMITS.DAILY - DailyUsed);

    // Check if this request would exceed limits
    const wouldExceedHourly = (HourlyUsed + requestedCount) > SUGGESTION_RATE_LIMITS.HOURLY;
    const wouldExceedDaily = (DailyUsed + requestedCount) > SUGGESTION_RATE_LIMITS.DAILY;

    return {
      allowed: !wouldExceedHourly && !wouldExceedDaily,
      hourlyUsed: HourlyUsed,
      dailyUsed: DailyUsed,
      hourlyRemaining,
      dailyRemaining,
      hourlyLimit: SUGGESTION_RATE_LIMITS.HOURLY,
      dailyLimit: SUGGESTION_RATE_LIMITS.DAILY,
      reason: wouldExceedHourly ? 'hourly_limit' : (wouldExceedDaily ? 'daily_limit' : null),
    };
  } catch (error) {
    // If table doesn't exist yet, allow the request (graceful degradation)
    if (error.message.includes('Invalid object name')) {
      logger.warn('ChallengeSuggestionUsage table not found - rate limiting disabled');
      return {
        allowed: true,
        hourlyUsed: 0,
        dailyUsed: 0,
        hourlyRemaining: SUGGESTION_RATE_LIMITS.HOURLY,
        dailyRemaining: SUGGESTION_RATE_LIMITS.DAILY,
        hourlyLimit: SUGGESTION_RATE_LIMITS.HOURLY,
        dailyLimit: SUGGESTION_RATE_LIMITS.DAILY,
        reason: null,
      };
    }
    logger.error('checkSuggestionRateLimit error:', error.message);
    throw error;
  }
}

/**
 * Record a suggestion generation for rate limiting
 *
 * @param {number} userId - User ID
 * @param {number} count - Number of suggestions generated
 */
async function recordSuggestionGeneration(userId, count) {
  const pool = getPool();

  try {
    await pool.request()
      .input('userId', userId)
      .input('count', count)
      .query(`
        INSERT INTO dbo.ChallengeSuggestionUsage (UserID, SuggestionCount)
        VALUES (@userId, @count)
      `);
  } catch (error) {
    // If table doesn't exist, log warning but don't fail
    if (error.message.includes('Invalid object name')) {
      logger.warn('ChallengeSuggestionUsage table not found - skipping usage recording');
      return;
    }
    logger.error('recordSuggestionGeneration error:', error.message);
    // Don't throw - recording failure shouldn't break suggestion generation
  }
}

module.exports = {
  getUserProgressContext,
  generateProgressiveSuggestions,
  acceptSuggestion,
  declineSuggestion,
  trackWorkoutCompletion,
  checkSuggestionRateLimit,
  recordSuggestionGeneration,
  FITPOINTS_BY_DIFFICULTY,
  SUGGESTION_RATE_LIMITS,
};
