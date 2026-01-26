/**
 * Challenge Generator Service
 *
 * AI-powered service for generating personalized fitness challenges
 * using Google Gemini API.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getPool } = require("../config/db");
const logger = require("../utils/logger");
const levelCalculator = require("./levelCalculator");

// API Configuration
const GOOGLE_API_KEY = process.env.GEMINI_API_KEY || "undefined";
const MODEL_NAME = process.env.GEMINI_MODEL_NAME || "gemini-2.5-pro";

// FitPoints by difficulty
const FITPOINTS_BY_DIFFICULTY = {
  Easy: 15,
  Medium: 30,
  Hard: 50,
};

// Difficulty distribution by tier (percentages)
const DIFFICULTY_DISTRIBUTION = {
  BRONZE: { Easy: 60, Medium: 35, Hard: 5 },
  SILVER: { Easy: 40, Medium: 50, Hard: 10 },
  GOLD: { Easy: 25, Medium: 50, Hard: 25 },
  EXCLUSIVE: { Easy: 15, Medium: 45, Hard: 40 },
  CHAMPION: { Easy: 10, Medium: 40, Hard: 50 },
};

// Tier benefits (in-app only for now)
const TIER_BENEFITS = {
  BRONZE: ["Basic workout tracking", "Daily challenges", "Water & sleep logging"],
  SILVER: ["AI workout suggestions", "Weekly challenges", "Form review (1/week)"],
  GOLD: ["Unlimited AI Form Reviews", "Monthly challenges", "Priority AI responses"],
  EXCLUSIVE: ["Custom AI challenges", "Early access to features", "Exclusive challenges"],
  CHAMPION: ["Champion-only challenges", "Beta feature access", "Community recognition"],
};

// System instruction for challenge generation
const CHALLENGE_SYSTEM_INSTRUCTION = `You are the FitPoints Challenge Generator for Apogee Fit app.

RULES:
• Generate personalized fitness challenges based on user context
• Challenges must be specific, measurable, and achievable
• Difficulty must match the requested level (Easy/Medium/Hard)
• Avoid challenges similar to ones the user previously deleted
• Return ONLY valid JSON array, no other text

DIFFICULTY GUIDELINES:
• Easy: Single-action tasks, 1-3 reps/completions, achievable in one session
• Medium: Multi-step tasks, 5-10 reps/completions, may span multiple sessions
• Hard: Ambitious goals, 15+ reps/completions, requires sustained effort

CATEGORY GUIDELINES:
• Daily: Quick wins, reset every day (e.g., "Log water intake", "Complete 10 pushups")
• Weekly: Consistent effort over 7 days (e.g., "Complete 3 workouts this week")
• Monthly: Major milestones (e.g., "Run 50km total this month")
• Universal: Ongoing achievements (e.g., "Complete 100 total workouts")

OUTPUT FORMAT (JSON array):
[
  {
    "title": "Challenge title (max 50 chars)",
    "description": "What to do and why (max 150 chars)",
    "difficulty": "Easy|Medium|Hard",
    "requiredCount": 1-30,
    "fitPoints": 15|30|50
  }
]`;

/**
 * Initialize Gemini AI model
 */
function initializeModel() {
  if (!GOOGLE_API_KEY || GOOGLE_API_KEY === "undefined") {
    logger.warn("Gemini API key not configured for challenge generation");
    return null;
  }

  try {
    const ai = new GoogleGenerativeAI(GOOGLE_API_KEY);
    return ai.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
      systemInstruction: CHALLENGE_SYSTEM_INSTRUCTION,
    });
  } catch (error) {
    logger.error("Failed to initialize Gemini model for challenges", { error: error.message });
    return null;
  }
}

/**
 * Get user context for challenge generation
 * @param {number} userId - User ID
 * @returns {Promise<Object>} User context data
 */
async function getUserContext(userId) {
  const pool = getPool();

  // Get user profile
  const profileResult = await pool.request()
    .input("userId", userId)
    .query(`
      SELECT
        up.FitnessGoal, up.FitnessLevel, up.Age,
        ur.TotalFitPoints, ur.CurrentTier, ur.CurrentLevel
      FROM dbo.UserProfile up
      LEFT JOIN dbo.UserRewards ur ON up.UserID = ur.UserID
      WHERE up.UserID = @userId
    `);

  const profile = profileResult.recordset[0] || {};

  // Get recent workout history (30 days)
  const workoutResult = await pool.request()
    .input("userId", userId)
    .query(`
      SELECT TOP 30
        ExerciseName, COUNT(*) as Count
      FROM dbo.ExerciseExistence
      WHERE UserID = @userId
        AND CreatedAt >= DATEADD(day, -30, GETDATE())
      GROUP BY ExerciseName
      ORDER BY Count DESC
    `);

  // Get feedback patterns
  const feedbackResult = await pool.request()
    .input("userId", userId)
    .query(`
      SELECT
        FeedbackType,
        COUNT(*) as Count
      FROM dbo.ChallengeFeedback
      WHERE UserID = @userId
        AND CreatedAt >= DATEADD(day, -90, GETDATE())
      GROUP BY FeedbackType
    `);

  const feedbackPatterns = {};
  feedbackResult.recordset.forEach(row => {
    feedbackPatterns[row.FeedbackType] = row.Count;
  });

  // Calculate level info
  const totalFitPoints = profile.TotalFitPoints || 0;
  const levelProgress = levelCalculator.getLevelProgress(totalFitPoints);

  return {
    fitnessGoal: profile.FitnessGoal || "general fitness",
    fitnessLevel: profile.FitnessLevel || "beginner",
    age: profile.Age || null,
    currentTier: levelProgress.tier,
    currentLevel: levelProgress.level,
    totalFitPoints,
    recentWorkouts: workoutResult.recordset.map(w => w.ExerciseName).slice(0, 10),
    feedbackPatterns,
  };
}

/**
 * Get active challenges count by category for user
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Count by category
 */
async function getActiveChallengesByCategory(userId) {
  const pool = getPool();

  const result = await pool.request()
    .input("userId", userId)
    .query(`
      SELECT Category, COUNT(*) as Count
      FROM dbo.GeneratedChallenges
      WHERE UserID = @userId
        AND IsActive = 1
        AND IsDeleted = 0
        AND (ExpiresAt IS NULL OR ExpiresAt > SYSDATETIMEOFFSET())
      GROUP BY Category
    `);

  const counts = {
    daily: 0,
    weekly: 0,
    monthly: 0,
    universal: 0,
  };

  result.recordset.forEach(row => {
    counts[row.Category.toLowerCase()] = row.Count;
  });

  return counts;
}

/**
 * Determine difficulty based on tier distribution
 * @param {string} tier - User's current tier
 * @returns {string} Selected difficulty
 */
function selectDifficulty(tier) {
  const distribution = DIFFICULTY_DISTRIBUTION[tier] || DIFFICULTY_DISTRIBUTION.BRONZE;
  const rand = Math.random() * 100;

  if (rand < distribution.Easy) return "Easy";
  if (rand < distribution.Easy + distribution.Medium) return "Medium";
  return "Hard";
}

/**
 * Build prompt for AI challenge generation
 * @param {Object} context - User context
 * @param {string} category - Challenge category
 * @param {number} count - Number of challenges to generate
 * @param {string} targetDifficulty - Target difficulty (optional, for replacements)
 * @returns {string} Formatted prompt
 */
function buildPrompt(context, category, count, targetDifficulty = null) {
  // Determine difficulty weights or use specific difficulty
  let difficultyInstructions;
  if (targetDifficulty) {
    difficultyInstructions = `Generate ${count} ${targetDifficulty} difficulty challenge(s).`;
  } else {
    const dist = DIFFICULTY_DISTRIBUTION[context.currentTier] || DIFFICULTY_DISTRIBUTION.BRONZE;
    difficultyInstructions = `Difficulty distribution: ${dist.Easy}% Easy, ${dist.Medium}% Medium, ${dist.Hard}% Hard`;
  }

  // Format feedback patterns
  const feedbackText = Object.entries(context.feedbackPatterns)
    .map(([type, count]) => `- "${type.replace(/_/g, " ")}": ${count} times`)
    .join("\n") || "None recorded";

  // Format workout history
  const workoutText = context.recentWorkouts.length > 0
    ? context.recentWorkouts.join(", ")
    : "No recent workouts";

  return `USER PROFILE:
- Goal: ${context.fitnessGoal}
- Level: ${context.fitnessLevel}
- Age: ${context.age || "Not specified"}
- Current Tier: ${context.currentTier} (Level ${context.currentLevel})
- Total FitPoints: ${context.totalFitPoints}

RECENT ACTIVITY (last 30 days):
${workoutText}

FEEDBACK ON DELETED CHALLENGES:
${feedbackText}

REQUESTED: Generate ${count} ${category} challenge(s)
${difficultyInstructions}

Remember:
- FitPoints: Easy=15, Medium=30, Hard=50
- Make challenges specific to the user's fitness level and goals
- Avoid patterns that match deleted challenge feedback`;
}

/**
 * Generate challenges using AI
 * @param {number} userId - User ID
 * @param {string} category - Challenge category (daily, weekly, monthly, universal)
 * @param {number} count - Number of challenges to generate
 * @param {string} targetDifficulty - Specific difficulty (optional, for replacements)
 * @returns {Promise<Array>} Generated challenges
 */
async function generateChallenges(userId, category, count = 3, targetDifficulty = null) {
  const model = initializeModel();

  // Get user context
  const context = await getUserContext(userId);

  // Build prompt
  const prompt = buildPrompt(context, category, count, targetDifficulty);

  // If AI is not available, generate fallback challenges
  if (!model) {
    logger.info("AI not available, using fallback challenge generation");
    return generateFallbackChallenges(context, category, count, targetDifficulty);
  }

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Parse JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn("Could not parse AI response, using fallback", { response: text.substring(0, 200) });
      return generateFallbackChallenges(context, category, count, targetDifficulty);
    }

    const challenges = JSON.parse(jsonMatch[0]);

    // Validate and normalize challenges
    return challenges.map(c => ({
      title: (c.title || "Fitness Challenge").substring(0, 200),
      description: (c.description || "Complete this challenge").substring(0, 500),
      difficulty: ["Easy", "Medium", "Hard"].includes(c.difficulty) ? c.difficulty : "Medium",
      requiredCount: Math.max(1, Math.min(100, parseInt(c.requiredCount) || 1)),
      fitPoints: FITPOINTS_BY_DIFFICULTY[c.difficulty] || 30,
      category,
    }));
  } catch (error) {
    logger.error("AI challenge generation failed", { error: error.message, userId, category });
    return generateFallbackChallenges(context, category, count, targetDifficulty);
  }
}

/**
 * Generate fallback challenges when AI is unavailable
 * @param {Object} context - User context
 * @param {string} category - Challenge category
 * @param {number} count - Number of challenges
 * @param {string} targetDifficulty - Specific difficulty (optional)
 * @returns {Array} Fallback challenges
 */
function generateFallbackChallenges(context, category, count, targetDifficulty = null) {
  const FALLBACK_CHALLENGES = {
    daily: [
      { title: "Log Your Water Intake", description: "Track your hydration for the day", difficulty: "Easy", requiredCount: 1 },
      { title: "Complete 10 Pushups", description: "Quick upper body strength challenge", difficulty: "Easy", requiredCount: 10 },
      { title: "15-Minute Walk", description: "Get moving with a short walk", difficulty: "Easy", requiredCount: 1 },
      { title: "Log Your Sleep", description: "Track your sleep for better recovery", difficulty: "Easy", requiredCount: 1 },
      { title: "Complete a Workout", description: "Finish any workout session today", difficulty: "Medium", requiredCount: 1 },
      { title: "30 Squats Challenge", description: "Build leg strength with bodyweight squats", difficulty: "Medium", requiredCount: 30 },
    ],
    weekly: [
      { title: "3 Workouts This Week", description: "Consistency builds results", difficulty: "Medium", requiredCount: 3 },
      { title: "5 Days of Water Logging", description: "Track hydration for 5 days", difficulty: "Easy", requiredCount: 5 },
      { title: "Log Sleep Every Day", description: "Track all 7 days of sleep", difficulty: "Medium", requiredCount: 7 },
      { title: "Complete 5 Workouts", description: "Push yourself with extra sessions", difficulty: "Hard", requiredCount: 5 },
    ],
    monthly: [
      { title: "Complete 12 Workouts", description: "Build a workout habit this month", difficulty: "Medium", requiredCount: 12 },
      { title: "Log Daily for 20 Days", description: "Consistent tracking challenge", difficulty: "Medium", requiredCount: 20 },
      { title: "Perfect Month", description: "Log every single day this month", difficulty: "Hard", requiredCount: 30 },
    ],
    universal: [
      { title: "First Workout Logged", description: "Start your fitness journey", difficulty: "Easy", requiredCount: 1 },
      { title: "Complete 50 Workouts", description: "Major milestone achievement", difficulty: "Hard", requiredCount: 50 },
      { title: "Create Custom Routine", description: "Design your own workout plan", difficulty: "Medium", requiredCount: 1 },
    ],
  };

  const categoryFallbacks = FALLBACK_CHALLENGES[category] || FALLBACK_CHALLENGES.daily;

  // Filter by target difficulty if specified
  let filtered = categoryFallbacks;
  if (targetDifficulty) {
    filtered = categoryFallbacks.filter(c => c.difficulty === targetDifficulty);
    if (filtered.length === 0) filtered = categoryFallbacks;
  }

  // Shuffle and pick
  const shuffled = [...filtered].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  return selected.map(c => ({
    title: c.title,
    description: c.description,
    difficulty: c.difficulty,
    requiredCount: c.requiredCount,
    fitPoints: FITPOINTS_BY_DIFFICULTY[c.difficulty],
    category,
  }));
}

/**
 * Store generated challenges in database
 * @param {number} userId - User ID
 * @param {Array} challenges - Challenges to store
 * @returns {Promise<Array>} Stored challenges with IDs
 */
async function storeChallenges(userId, challenges) {
  const pool = getPool();
  const storedChallenges = [];

  for (const challenge of challenges) {
    // Calculate expiration based on category
    let expiresAt = null;
    const now = new Date();

    if (challenge.category === "daily") {
      expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
    } else if (challenge.category === "weekly") {
      expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
    } else if (challenge.category === "monthly") {
      expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
    }
    // universal challenges don't expire

    const result = await pool.request()
      .input("userId", userId)
      .input("title", challenge.title)
      .input("description", challenge.description)
      .input("fitPoints", challenge.fitPoints)
      .input("category", challenge.category)
      .input("difficulty", challenge.difficulty)
      .input("requiredCount", challenge.requiredCount)
      .input("expiresAt", expiresAt)
      .query(`
        INSERT INTO dbo.GeneratedChallenges
          (UserID, ChallengeTitle, ChallengeDescription, FitPointsValue, Category, Difficulty, RequiredCount, ExpiresAt)
        OUTPUT INSERTED.GeneratedChallengeID, INSERTED.ChallengeTitle, INSERTED.ChallengeDescription,
               INSERTED.FitPointsValue, INSERTED.Category, INSERTED.Difficulty, INSERTED.RequiredCount,
               INSERTED.CurrentProgress, INSERTED.ExpiresAt, INSERTED.IsActive, INSERTED.IsCompleted, INSERTED.CreatedAt
        VALUES (@userId, @title, @description, @fitPoints, @category, @difficulty, @requiredCount, @expiresAt)
      `);

    const stored = result.recordset[0];
    storedChallenges.push({
      id: stored.GeneratedChallengeID,
      title: stored.ChallengeTitle,
      description: stored.ChallengeDescription,
      fitPoints: stored.FitPointsValue,
      category: stored.Category,
      difficulty: stored.Difficulty,
      requiredCount: stored.RequiredCount,
      currentProgress: stored.CurrentProgress,
      expiresAt: stored.ExpiresAt,
      isActive: stored.IsActive,
      isCompleted: stored.IsCompleted,
      createdAt: stored.CreatedAt,
    });
  }

  return storedChallenges;
}

/**
 * Get active challenges for user
 * @param {number} userId - User ID
 * @param {string} category - Optional category filter
 * @returns {Promise<Array>} Active challenges
 */
async function getActiveChallenges(userId, category = null) {
  const pool = getPool();

  let query = `
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
      IsCompleted as isCompleted,
      CreatedAt as createdAt
    FROM dbo.GeneratedChallenges
    WHERE UserID = @userId
      AND IsActive = 1
      AND IsDeleted = 0
      AND (ExpiresAt IS NULL OR ExpiresAt > SYSDATETIMEOFFSET())
  `;

  if (category) {
    query += ` AND Category = @category`;
  }

  query += ` ORDER BY CreatedAt DESC`;

  const request = pool.request().input("userId", userId);
  if (category) {
    request.input("category", category);
  }

  const result = await request.query(query);
  return result.recordset;
}

/**
 * Ensure user has 3 challenges per category
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Generation results
 */
async function ensureChallengesExist(userId) {
  const counts = await getActiveChallengesByCategory(userId);
  const results = { generated: {}, total: {} };
  const CHALLENGES_PER_CATEGORY = 3;

  for (const category of ["daily", "weekly", "monthly", "universal"]) {
    const needed = CHALLENGES_PER_CATEGORY - counts[category];
    results.total[category] = counts[category];

    if (needed > 0) {
      const challenges = await generateChallenges(userId, category, needed);
      const stored = await storeChallenges(userId, challenges);
      results.generated[category] = stored.length;
      results.total[category] += stored.length;
    } else {
      results.generated[category] = 0;
    }
  }

  return results;
}

/**
 * Store feedback and soft-delete challenge
 * @param {number} userId - User ID
 * @param {number} challengeId - Challenge ID
 * @param {string} feedbackType - Type of feedback
 * @param {string} feedbackText - Optional additional text
 * @returns {Promise<Object>} Deletion result
 */
async function deleteChallenge(userId, challengeId, feedbackType, feedbackText = null) {
  const pool = getPool();

  // Get challenge details before deletion
  const challengeResult = await pool.request()
    .input("userId", userId)
    .input("challengeId", challengeId)
    .query(`
      SELECT gc.*, ur.CurrentTier
      FROM dbo.GeneratedChallenges gc
      LEFT JOIN dbo.UserRewards ur ON gc.UserID = ur.UserID
      WHERE gc.GeneratedChallengeID = @challengeId
        AND gc.UserID = @userId
        AND gc.IsDeleted = 0
    `);

  if (challengeResult.recordset.length === 0) {
    return { success: false, message: "Challenge not found or already deleted" };
  }

  const challenge = challengeResult.recordset[0];

  // Store feedback
  await pool.request()
    .input("userId", userId)
    .input("challengeId", challengeId)
    .input("feedbackType", feedbackType)
    .input("feedbackText", feedbackText)
    .input("difficulty", challenge.Difficulty)
    .input("tier", challenge.CurrentTier)
    .query(`
      INSERT INTO dbo.ChallengeFeedback
        (UserID, ChallengeID, FeedbackType, FeedbackText, DifficultyAtDeletion, UserTierAtDeletion)
      VALUES (@userId, @challengeId, @feedbackType, @feedbackText, @difficulty, @tier)
    `);

  // Soft-delete the challenge
  await pool.request()
    .input("challengeId", challengeId)
    .input("userId", userId)
    .query(`
      UPDATE dbo.GeneratedChallenges
      SET IsDeleted = 1, IsActive = 0
      WHERE GeneratedChallengeID = @challengeId AND UserID = @userId
    `);

  // Generate replacement challenge (avoiding similar type based on feedback)
  // Determine target difficulty - if user said "too_hard", make it easier
  let targetDifficulty = null;
  if (feedbackType === "too_hard") {
    targetDifficulty = challenge.Difficulty === "Hard" ? "Medium" : "Easy";
  } else if (feedbackType === "too_easy") {
    targetDifficulty = challenge.Difficulty === "Easy" ? "Medium" : "Hard";
  }

  const replacements = await generateChallenges(userId, challenge.Category, 1, targetDifficulty);
  const stored = await storeChallenges(userId, replacements);

  return {
    success: true,
    deletedChallengeId: challengeId,
    feedbackRecorded: true,
    replacement: stored[0] || null,
  };
}

/**
 * Complete a challenge and generate replacement
 * @param {number} userId - User ID
 * @param {number} challengeId - Challenge ID
 * @returns {Promise<Object>} Completion result
 */
async function completeChallenge(userId, challengeId) {
  const pool = getPool();

  // Get challenge details
  const challengeResult = await pool.request()
    .input("userId", userId)
    .input("challengeId", challengeId)
    .query(`
      SELECT *
      FROM dbo.GeneratedChallenges
      WHERE GeneratedChallengeID = @challengeId
        AND UserID = @userId
        AND IsActive = 1
        AND IsCompleted = 0
    `);

  if (challengeResult.recordset.length === 0) {
    return { success: false, message: "Challenge not found or already completed" };
  }

  const challenge = challengeResult.recordset[0];

  // Mark as completed
  await pool.request()
    .input("challengeId", challengeId)
    .query(`
      UPDATE dbo.GeneratedChallenges
      SET IsCompleted = 1, IsActive = 0, CompletedAt = SYSDATETIMEOFFSET()
      WHERE GeneratedChallengeID = @challengeId
    `);

  // Award FitPoints
  const xpResult = await pool.request()
    .input("userId", userId)
    .input("fitPoints", challenge.FitPointsValue)
    .query(`
      UPDATE dbo.UserRewards
      SET TotalFitPoints = TotalFitPoints + @fitPoints, LastUpdated = SYSDATETIMEOFFSET()
      OUTPUT INSERTED.TotalFitPoints
      WHERE UserID = @userId
    `);

  const newTotal = xpResult.recordset[0]?.TotalFitPoints || challenge.FitPointsValue;

  // Add to history
  await pool.request()
    .input("userId", userId)
    .input("fitPoints", challenge.FitPointsValue)
    .input("reason", `Challenge completed: ${challenge.ChallengeTitle}`)
    .query(`
      INSERT INTO dbo.UserRewardHistory (UserID, XPEarned, Reason)
      VALUES (@userId, @fitPoints, @reason)
    `);

  // Check for level up
  const oldXP = newTotal - challenge.FitPointsValue;
  const levelUpResult = levelCalculator.checkLevelUp(oldXP, newTotal);

  // Generate harder replacement challenge
  let targetDifficulty = null;
  if (challenge.Difficulty === "Easy") targetDifficulty = "Medium";
  else if (challenge.Difficulty === "Medium") targetDifficulty = "Hard";
  // Hard stays Hard

  const replacements = await generateChallenges(userId, challenge.Category, 1, targetDifficulty);
  const stored = await storeChallenges(userId, replacements);

  return {
    success: true,
    fitPointsAwarded: challenge.FitPointsValue,
    newTotalFitPoints: newTotal,
    leveledUp: levelUpResult.leveledUp,
    levelUpInfo: levelUpResult.leveledUp ? levelUpResult : null,
    replacement: stored[0] || null,
  };
}

module.exports = {
  generateChallenges,
  storeChallenges,
  getActiveChallenges,
  getActiveChallengesByCategory,
  ensureChallengesExist,
  deleteChallenge,
  completeChallenge,
  getUserContext,
  TIER_BENEFITS,
  FITPOINTS_BY_DIFFICULTY,
};
