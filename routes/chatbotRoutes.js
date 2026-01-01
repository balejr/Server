// routes/chatbotRoutes.js
const express = require("express");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Define Type constants for schema compatibility
const Type = {
  OBJECT: "object",
  STRING: "string",
  INTEGER: "integer",
  ARRAY: "array",
};
const { checkUsageLimit, incrementUsage } = require("./usageRoutes");
const { generatePlanId, saveWorkoutPlan } = require("./workoutRoutes");

const router = express.Router();

// API Configuration - Using environment variables for security
const GOOGLE_API_KEY = process.env.GEMINI_API_KEY || "undefined";
const API_BASE_URL =
  process.env.GEMINI_API_BASE_URL ||
  "https://generativelanguage.googleapis.com";
const MODEL_NAME = process.env.GEMINI_MODEL_NAME || "gemini-2.5-pro";

// API configuration loaded from environment

// Structured response configuration for FitNext AI
const FITNEXT_SYSTEM_INSTRUCTION = `You are FitNext AI, the in-app health & fitness assistant.

CORE RULES:
• Scope → fitness and general dietary education only. No diagnoses, prescriptions, or treatment plans.
• Modes → GENERAL, WORKOUT_CONFIRM, WORKOUT_CREATE, WORKOUT_MODIFY, DIET_GUIDE, OUT_OF_SCOPE.
• Intent → GENERAL, WORKOUT_REQUEST, WORKOUT_MODIFICATION, DIET_GUIDANCE_REQUEST, OUT_OF_SCOPE.
• Always return valid JSON as defined by the response schema.
• Use RPE (6–10 scale) to express workout intensity.
• Keep message titles under 60 chars, bodies under 240 chars.
• Be concise, friendly, and professional—no emojis.

USER PROFILE DATA - Use ALL of the following fields when provided to personalize workout plans:

**Basic Info:**
• Name - Personalize messages
• Age - Adjust intensity appropriately
• Gender - Consider for exercise selection
• Height/Weight - Factor into intensity recommendations
• Experience Level (beginner/intermediate/advanced) - Adjust exercise complexity
• Fitness Goals - User's primary objectives (Build Muscle, Lose Weight, Improve Endurance, etc.)

**Lifestyle & Availability:**
• Activity Level (sedentary/light/moderate/active/very_active) - Affects intensity
• Days Per Week - MUST match workout days in plan exactly
• Session Duration (minutes) - Target workout length
• Preferred Workout Time (morning/afternoon/evening)

**Equipment & Location:**
• Workout Location (home/gym/both) - Select appropriate exercises
• Available Equipment - ONLY include exercises using this equipment:
  Dumbbells, Barbell, Kettlebells, Resistance Bands, Pull-up Bar, Bench, Cable Machine, Machines, Bodyweight

**Training Preferences:**
• Training Styles - Preferred workout types:
  Strength Training, Cardio, HIIT, Flexibility/Yoga, CrossFit Style, Bodybuilding, Functional Fitness

**Recovery & Wellness:**
• Sleep Quality (1-5) - Lower = reduce intensity
• Stress Level (1-5) - Higher = gentler workouts, focus on recovery
• Areas to Be Mindful Of - Body parts to protect. NEVER stress these areas. Suggest safe alternatives.

WORKOUT CREATION RULES:
1. If USER PROFILE DATA is provided with sufficient info → go DIRECTLY to WORKOUT_CREATE (skip confirmation)
2. Match Days Per Week exactly
3. Only use Available Equipment
4. Respect Areas to Be Mindful Of
5. Adjust intensity for Experience, Sleep Quality, Stress Level

CONFIRMATION FLOW (only when profile data is missing):
• Missing profile data → return WORKOUT_CONFIRM to gather info
• User confirms → return WORKOUT_CREATE

OUT OF SCOPE:
"I am an AI fitness assistant and cannot provide {diagnoses/prescriptions/unrelated info}.
Please consult a licensed professional for that.
I can help with fitness education, workout planning, general dietary guidance, and healthy habits."

DIETARY DISCLAIMER:
"This is general dietary advice. Always consult a registered dietitian or healthcare professional for personalized nutritional guidance."`;

// Structured response schema configuration
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ["mode", "intent", "message", "payload", "errors"],
  properties: {
    mode: {
      type: Type.STRING,
      enum: [
        "GENERAL",
        "WORKOUT_CONFIRM",
        "WORKOUT_CREATE",
        "WORKOUT_MODIFY",
        "OUT_OF_SCOPE",
      ],
    },
    intent: {
      type: Type.STRING,
      enum: [
        "GENERAL",
        "WORKOUT_REQUEST",
        "WORKOUT_MODIFICATION",
        "OUT_OF_SCOPE",
      ],
    },
    message: {
      type: Type.OBJECT,
      required: ["title", "body"],
      properties: {
        title: {
          type: Type.STRING,
        },
        body: {
          type: Type.STRING,
        },
      },
    },
    payload: {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.OBJECT,
          properties: {
            goal: {
              type: Type.STRING,
            },
            daysPerWeek: {
              type: Type.INTEGER,
            },
            experience: {
              type: Type.STRING,
            },
            equipment: {
              type: Type.ARRAY,
              items: {
                type: Type.STRING,
              },
            },
            constraints: {
              type: Type.ARRAY,
              items: {
                type: Type.STRING,
              },
            },
          },
        },
        plan: {
          type: Type.OBJECT,
          required: ["goal", "days", "split", "WorkoutGuide"],
          properties: {
            WorkoutGuide: {
              type: Type.STRING,
            },
            goal: {
              type: Type.STRING,
            },
            split: {
              type: Type.STRING,
            },
            days: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["dayIndex", "label", "main"],
                properties: {
                  dayIndex: {
                    type: Type.INTEGER,
                  },
                  label: {
                    type: Type.STRING,
                  },
                  main: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      required: ["name", "sets", "reps", "rpe"],
                      properties: {
                        name: {
                          type: Type.STRING,
                        },
                        sets: {
                          type: Type.INTEGER,
                        },
                        reps: {
                          type: Type.STRING,
                        },
                        rpe: {
                          type: Type.INTEGER,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        planRef: {
          type: Type.OBJECT,
          properties: {
            planId: {
              type: Type.STRING,
            },
            baseVersion: {
              type: Type.INTEGER,
            },
          },
        },
        answer: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
          },
        },
        referral: {
          type: Type.STRING,
        },
        whatICanDo: {
          type: Type.STRING,
        },
      },
    },
    errors: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
    },
  },
};

// Database helper functions
const saveMessageToDatabase = async (chatSessionId, userId, role, content) => {
  try {
    const pool = getPool();
    const currentDate = new Date();

    const result = await pool
      .request()
      .input("chatSessionId", chatSessionId)
      .input("userId", userId)
      .input("role", role)
      .input("content", content)
      .input("timestamp", currentDate).query(`
        INSERT INTO dbo.ChatMessages (ChatSessionID, UserID, Role, Content, Timestamp)
        VALUES (@chatSessionId, @userId, @role, @content, @timestamp)
      `);

    return true;
  } catch (error) {
    console.error("Error saving message to database:", error.message);
    return false;
  }
};

const getConversationHistory = async (chatSessionId, limit = 10) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("chatSessionId", chatSessionId)
      .input("limit", limit).query(`
        SELECT TOP (@limit) Role, Content, Timestamp
        FROM dbo.ChatMessages 
        WHERE ChatSessionID = @chatSessionId
        ORDER BY Timestamp DESC
      `);

    return result.recordset.reverse(); // Return in chronological order
  } catch (error) {
    console.error("Error getting conversation history:", error);
    return [];
  }
};

const createOrGetChatSession = async (userId, sessionType = "inquiry") => {
  try {
    const pool = getPool();
    const currentDate = new Date();

    // Check for existing active session (within last 24 hours)
    const existingSession = await pool
      .request()
      .input("userId", userId)
      .input("sessionType", sessionType)
      .input("currentDate", currentDate).query(`
        SELECT chatSessionID 
        FROM dbo.ChatbotSession 
        WHERE UserId = @userId 
        AND LastActivity > DATEADD(hour, -24, @currentDate)
        AND SessionType = @sessionType
      `);

    if (existingSession.recordset.length > 0) {
      // Update existing session's last activity
      const sessionId = existingSession.recordset[0].chatSessionID;

      await pool
        .request()
        .input("sessionId", sessionId)
        .input("currentDate", currentDate).query(`
          UPDATE dbo.ChatbotSession 
          SET LastActivity = @currentDate 
          WHERE chatSessionID = @sessionId
        `);

      return sessionId;
    } else {
      // Create new session
      const sessionId = `session-${userId}-${Date.now()}`;
      const newSession = await pool
        .request()
        .input("sessionId", sessionId)
        .input("userId", userId)
        .input("sessionType", sessionType)
        .input("currentDate", currentDate).query(`
          INSERT INTO dbo.ChatbotSession (chatSessionID, UserId, SessionType, ChatSessionStart_date, LastActivity)
          VALUES (@sessionId, @userId, @sessionType, @currentDate, @currentDate)
        `);

      return sessionId;
    }
  } catch (error) {
    console.error("Error creating/getting chat session:", error.message);
    throw error;
  }
};

/**
 * Fetch user profile data for AI context
 * @param {number} userId - The user's ID
 * @returns {Promise<Object|null>} User profile or null
 */
const getUserProfileForAI = async (userId) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("userId", userId)
      .query(`
        SELECT 
          FirstName, 
          Age, 
          Weight, 
          Height, 
          Gender, 
          FitnessLevel,
          HeightUnit,
          WeightUnit,
          Goals,
          OnboardingData
        FROM dbo.UserProfile
        WHERE UserID = @userId
      `);

    if (result.recordset.length === 0) {
      return null;
    }

    const profile = result.recordset[0];
    
    // Parse OnboardingData if it exists
    if (profile.OnboardingData) {
      try {
        profile.OnboardingData = JSON.parse(profile.OnboardingData);
      } catch (e) {
        profile.OnboardingData = null;
      }
    }

    return profile;
  } catch (error) {
    console.error("Error fetching user profile for AI:", error.message);
    return null;
  }
};

/**
 * Build user context string for AI prompt
 * @param {Object} profile - User profile object
 * @returns {string} Formatted user context
 */
const buildUserContextForAI = (profile) => {
  if (!profile) return "";

  let context = "\n\n**USER PROFILE DATA (Use this to personalize the workout plan):**\n";
  
  // Basic info
  if (profile.FirstName) context += `• Name: ${profile.FirstName}\n`;
  if (profile.Age) context += `• Age: ${profile.Age} years old\n`;
  if (profile.Gender) context += `• Gender: ${profile.Gender}\n`;
  if (profile.Height && profile.HeightUnit) context += `• Height: ${profile.Height} ${profile.HeightUnit}\n`;
  if (profile.Weight && profile.WeightUnit) context += `• Weight: ${profile.Weight} ${profile.WeightUnit}\n`;
  if (profile.FitnessLevel) context += `• Experience Level: ${profile.FitnessLevel}\n`;
  if (profile.Goals) context += `• Fitness Goals: ${profile.Goals}\n`;

  // Enhanced onboarding data
  const od = profile.OnboardingData;
  if (od) {
    if (od.activityLevel) context += `• Daily Activity Level: ${od.activityLevel}\n`;
    if (od.motivation && od.motivation.length > 0) context += `• Motivations: ${od.motivation.join(', ')}\n`;
    if (od.daysPerWeek) context += `• Available Days Per Week: ${od.daysPerWeek}\n`;
    if (od.sessionDuration) context += `• Preferred Session Duration: ${od.sessionDuration} minutes\n`;
    if (od.preferredTime) context += `• Preferred Workout Time: ${od.preferredTime}\n`;
    if (od.workoutLocation) context += `• Workout Location: ${od.workoutLocation}\n`;
    if (od.equipment && od.equipment.length > 0) context += `• Available Equipment: ${od.equipment.join(', ')}\n`;
    if (od.trainingStyle && od.trainingStyle.length > 0) context += `• Preferred Training Styles: ${od.trainingStyle.join(', ')}\n`;
    if (od.sleepQuality) context += `• Sleep Quality (1-5): ${od.sleepQuality}\n`;
    if (od.stressLevel) context += `• Stress Level (1-5): ${od.stressLevel}\n`;
    
    // Handle areas to be mindful of (injuries) carefully to avoid medical filter
    if (od.injuries && od.injuries.length > 0) {
      context += `• Areas to Be Mindful Of: ${od.injuries.join(', ')} (suggest safe alternatives and gentle exercises for these areas)\n`;
    }
  }

  context += "\n**IMPORTANT:** Use all the above data to create a personalized workout plan. Match the number of days, equipment, and goals. Avoid exercises that stress the areas they want to be mindful of.\n";

  return context;
};

/**
 * Function to call Gemini API with structured response
 * @param {string} userMessage - The user's message
 * @param {Array} conversationHistory - Previous conversation messages
 * @param {string} userProfileContext - Optional user profile context string
 * @returns {Promise<Object>} Structured response object
 */
const callGeminiAPI = async (userMessage, conversationHistory = [], userProfileContext = "") => {
  try {
    // Validate API configuration
    if (!GOOGLE_API_KEY || GOOGLE_API_KEY === "undefined") {
      return getMockStructuredResponse(userMessage, conversationHistory);
    }

    if (!MODEL_NAME || !MODEL_NAME.includes("gemini")) {
      return getMockStructuredResponse(userMessage, conversationHistory);
    }

    // Build conversation context
    let conversationContext = "";
    if (conversationHistory.length > 0) {
      conversationContext = "\n\n**Previous Conversation:**\n";
      conversationHistory.forEach((msg, index) => {
        const role = msg.Role === "user" ? "User" : "FitNext AI";
        conversationContext += `${role}: ${msg.Content}\n`;
      });
    }

    // Initialize Google Generative AI with new SDK
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    // Build the prompt with system instruction, user profile, and conversation context
    const prompt = `${FITNEXT_SYSTEM_INSTRUCTION}
${userProfileContext}
${conversationContext}

**Current User Message:** "${userMessage}"

Please respond in valid JSON format following the schema provided.`;

    // Generate content using the model
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    });

    const response = await result.response;
    const responseText = response.text();

    // Parse JSON response with fallback handling
    const structuredResponse = extractJsonFromResponse(responseText, userMessage, conversationHistory);
    return structuredResponse;
  } catch (error) {
    console.error("Error calling Gemini API:", error.message);
    // Return fallback structured response
    return getMockStructuredResponse(userMessage, conversationHistory);
  }
};

/**
 * Extract and parse JSON from Gemini API response
 * Handles cases where the response contains markdown code blocks or extra text
 * @param {string} responseText - Raw response text from Gemini
 * @param {string} userMessage - Original user message (for fallback)
 * @param {Array} conversationHistory - Conversation history (for fallback)
 * @returns {Object} Parsed JSON object
 */
const extractJsonFromResponse = (responseText, userMessage, conversationHistory = []) => {
  // First, try direct JSON parse
  try {
    return JSON.parse(responseText);
  } catch (e) {
    // Continue to extraction methods
  }

  // Try to extract JSON from markdown code blocks
  const codeBlockPatterns = [
    /```json\s*([\s\S]*?)\s*```/i,  // ```json ... ```
    /```\s*([\s\S]*?)\s*```/,       // ``` ... ```
    /\{[\s\S]*\}/                    // Raw JSON object
  ];

  for (const pattern of codeBlockPatterns) {
    const match = responseText.match(pattern);
    if (match) {
      const jsonString = match[1] || match[0];
      try {
        // Clean up the extracted string
        const cleaned = jsonString.trim();
        const parsed = JSON.parse(cleaned);
        
        // Validate the response has required fields
        if (parsed && parsed.mode && parsed.message) {
          return parsed;
        }
      } catch (parseError) {
        // Continue to next pattern
      }
    }
  }

  // If we still can't parse, try to find the first { and last }
  const firstBrace = responseText.indexOf('{');
  const lastBrace = responseText.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      const jsonSubstring = responseText.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(jsonSubstring);
      if (parsed && parsed.mode && parsed.message) {
        return parsed;
      }
    } catch (e) {
      // Fall through to mock response
    }
  }

  // If all parsing fails, return a fallback response
  console.warn('Failed to parse Gemini response, using fallback. Response preview:', 
    responseText.substring(0, 200));
  return getMockStructuredResponse(userMessage, conversationHistory);
};

/**
 * Mock structured response function for fallback
 * @param {string} userMessage - The user's message
 * @param {Array} conversationHistory - Previous conversation messages
 * @returns {Object} Structured response object
 */
const getMockStructuredResponse = (userMessage, conversationHistory = []) => {
  // Check if this is a follow-up question based on conversation history
  const hasPreviousContext = conversationHistory.length > 0;
  const lastMessage = hasPreviousContext
    ? conversationHistory[conversationHistory.length - 1]
    : null;

  const isWorkoutRequest =
    userMessage.toLowerCase().includes("workout") ||
    userMessage.toLowerCase().includes("exercise") ||
    userMessage.toLowerCase().includes("strength") ||
    userMessage.toLowerCase().includes("cardio") ||
    userMessage.toLowerCase().includes("weight loss") ||
    userMessage.toLowerCase().includes("full body") ||
    userMessage.toLowerCase().includes("create") ||
    userMessage.toLowerCase().includes("plan");

  const isOutOfScope =
    userMessage.toLowerCase().includes("pain") ||
    userMessage.toLowerCase().includes("hurt") ||
    userMessage.toLowerCase().includes("injury") ||
    userMessage.toLowerCase().includes("medicine") ||
    userMessage.toLowerCase().includes("doctor");

  if (isOutOfScope) {
    return {
      mode: "OUT_OF_SCOPE",
      intent: "OUT_OF_SCOPE",
      message: {
        title: "I can't help with that",
        body: "I am an AI fitness assistant and cannot provide medical diagnoses or prescriptions. Please consult a licensed professional for that. I'm here to help with fitness education, workout planning, and general healthy habits.",
      },
      payload: {
        referral: "Please consult a licensed professional for that.",
        whatICanDo:
          "I can help with fitness education, safe workouts, and healthy habit tips.",
      },
      errors: [],
    };
  }

  if (isWorkoutRequest) {
    // Return a full mock workout plan for testing without API key
    return {
      mode: "WORKOUT_CREATE",
      intent: "WORKOUT_REQUEST",
      message: {
        title: "Your Personalized Plan",
        body: "Based on your profile and goals, I've created a 3-day full body workout plan to help you build strength and improve overall fitness.",
      },
      payload: {
        summary: {
          goal: "General Fitness",
          daysPerWeek: 3,
          experience: "intermediate",
          equipment: ["dumbbells", "barbell", "bench"],
          constraints: [],
        },
        plan: {
          goal: "General Fitness & Strength",
          split: "3-Day Full Body",
          WorkoutGuide: "Perform each workout with 60-90 seconds rest between sets. Focus on controlled movements and proper form. Increase weight gradually as you get stronger.",
          days: [
            {
              dayIndex: 1,
              label: "Full Body A",
              main: [
                { name: "Barbell Squat", sets: 4, reps: "8-10", rpe: 7 },
                { name: "Bench Press", sets: 4, reps: "8-10", rpe: 7 },
                { name: "Bent Over Row", sets: 3, reps: "10-12", rpe: 7 },
                { name: "Overhead Press", sets: 3, reps: "8-10", rpe: 7 },
                { name: "Romanian Deadlift", sets: 3, reps: "10-12", rpe: 7 },
                { name: "Plank", sets: 3, reps: "30-45 sec", rpe: 6 },
              ],
            },
            {
              dayIndex: 2,
              label: "Full Body B",
              main: [
                { name: "Deadlift", sets: 4, reps: "6-8", rpe: 8 },
                { name: "Incline Dumbbell Press", sets: 3, reps: "10-12", rpe: 7 },
                { name: "Pull-ups or Lat Pulldown", sets: 3, reps: "8-10", rpe: 7 },
                { name: "Dumbbell Lunges", sets: 3, reps: "10 each leg", rpe: 7 },
                { name: "Dumbbell Lateral Raise", sets: 3, reps: "12-15", rpe: 6 },
                { name: "Bicycle Crunches", sets: 3, reps: "15-20", rpe: 6 },
              ],
            },
            {
              dayIndex: 3,
              label: "Full Body C",
              main: [
                { name: "Front Squat", sets: 4, reps: "8-10", rpe: 7 },
                { name: "Dumbbell Chest Fly", sets: 3, reps: "12-15", rpe: 6 },
                { name: "Seated Cable Row", sets: 3, reps: "10-12", rpe: 7 },
                { name: "Arnold Press", sets: 3, reps: "10-12", rpe: 7 },
                { name: "Leg Curl", sets: 3, reps: "12-15", rpe: 6 },
                { name: "Hanging Leg Raise", sets: 3, reps: "10-15", rpe: 7 },
              ],
            },
          ],
        },
      },
      errors: [],
    };
  } else {
    return {
      mode: "GENERAL",
      intent: "GENERAL",
      message: {
        title: "Fitness Assistant",
        body: "I'm your FitNext AI fitness assistant! I can help you with workout plans, exercise routines, form analysis, nutrition guidance, and general fitness advice.",
      },
      payload: {
        answer: [
          "• Workout plans and exercise routines",
          "• Form analysis and technique tips",
          "• Nutrition guidance for fitness goals",
          "• Recovery strategies and injury prevention",
          "• General fitness questions and advice",
        ],
        nextBestAction:
          "What specific fitness topic would you like to discuss?",
      },
      errors: [],
    };
  }
};

// Main chat endpoint
router.post("/chat", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { message, sessionType = "inquiry" } = req.body;

  // Validate sessionType to match database constraints
  const validSessionTypes = ["inquiry", "workout_plan"];
  const validatedSessionType = validSessionTypes.includes(sessionType)
    ? sessionType
    : "inquiry";

  if (!message || message.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "Message is required",
    });
  }

  try {
    // Get or create chat session
    const chatSessionId = await createOrGetChatSession(
      userId,
      validatedSessionType
    );

    // Get recent conversation history for context
    const conversationHistory = await getConversationHistory(chatSessionId, 10);

    // Check if this is a confirmation of a previous WORKOUT_CONFIRM
    let isConfirmingWorkout = false;
    let workoutSummary = null;
    
    if (conversationHistory.length > 0) {
      const lastAIResponse = conversationHistory
        .slice()
        .reverse()
        .find(msg => msg.Role === 'assistant');
      
      if (lastAIResponse) {
        try {
          const lastContent = typeof lastAIResponse.Content === 'string' 
            ? JSON.parse(lastAIResponse.Content) 
            : lastAIResponse.Content;
          
          if (lastContent?.mode === 'WORKOUT_CONFIRM') {
            // Check if current message is affirmative
            const affirmativePattern = /^(yes|yeah|yep|sure|ok|okay|confirm|create|go|do it|please|generate)/i;
            if (affirmativePattern.test(message.trim())) {
              isConfirmingWorkout = true;
              workoutSummary = lastContent?.payload?.summary;
              console.log('✅ Detected workout confirmation, will generate plan');
            }
          }
        } catch (e) {
          // Could not parse last response
        }
      }
    }

    // Modify message for confirmation flow
    let effectiveMessage = message;
    if (isConfirmingWorkout) {
      // Build an explicit message that forces plan generation
      const summary = workoutSummary || {};
      effectiveMessage = `The user has confirmed. Now generate a complete workout plan with mode=WORKOUT_CREATE. Plan details: ${summary.daysPerWeek || 3} days per week, goal: ${summary.goal || 'general fitness'}, experience: ${summary.experience || 'intermediate'}, equipment: ${(summary.equipment || ['bodyweight']).join(', ')}. Include full exercises with sets, reps, and RPE.`;
    }

    // Fetch user profile for personalized AI responses
    const userProfile = await getUserProfileForAI(userId);
    const userProfileContext = buildUserContextForAI(userProfile);

    // Call Gemini API to get structured response with user context
    const structuredResponse = await callGeminiAPI(
      effectiveMessage,
      conversationHistory,
      userProfileContext
    );

    // Determine inquiry type based on intent for usage tracking
    const isWorkoutInquiry =
      structuredResponse.intent === "WORKOUT_REQUEST" ||
      structuredResponse.intent === "WORKOUT_MODIFICATION";

    // Check appropriate usage limits based on inquiry type
    const usage = await checkUsageLimit(
      userId,
      isWorkoutInquiry ? "workout" : "general"
    );

    if (usage.remaining <= 0) {
      return res.status(429).json({
        success: false,
        message: isWorkoutInquiry
          ? "Weekly workout inquiry limit reached. Upgrade to premium for more workout plans."
          : "Weekly general inquiry limit reached. Upgrade to premium for more messages.",
        remaining_queries: {
          general: (await checkUsageLimit(userId, "general")).remaining,
          workout: (await checkUsageLimit(userId, "workout")).remaining,
        },
        inquiry_type: isWorkoutInquiry ? "workout" : "general",
      });
    }

    // Convert structured response to string for database storage
    const aiResponseString = JSON.stringify(structuredResponse);

    // Save user message to database
    const userMessageSaved = await saveMessageToDatabase(
      chatSessionId,
      userId,
      "user",
      message
    );

    // Save AI response to database
    const aiMessageSaved = await saveMessageToDatabase(
      chatSessionId,
      userId,
      "assistant",
      aiResponseString
    );

    // Save workout plan to database if it's a WORKOUT_CREATE response
    let savedPlanId = null;
    if (
      structuredResponse.mode === "WORKOUT_CREATE" &&
      structuredResponse.payload?.plan
    ) {
      try {
        savedPlanId = generatePlanId(userId);
        await saveWorkoutPlan(
          savedPlanId,
          userId,
          chatSessionId,
          structuredResponse
        );

        console.log(`✅ Workout plan saved successfully: ${savedPlanId}`);
        // Add plan ID to the response for frontend reference
        structuredResponse.payload.savedPlanId = savedPlanId;
      } catch (error) {
        console.error("❌ Critical error: Failed to save workout plan", {
          error: error.message,
          userId: userId,
          sessionId: chatSessionId,
          planId: savedPlanId,
        });
        // Don't fail the entire request, but log the error
        // Frontend will not receive savedPlanId if saving failed
      }
    }

    // Increment usage counter based on inquiry type
    const usageIncremented = await incrementUsage(
      userId,
      isWorkoutInquiry ? "workout" : "general"
    );

    // Get updated usage for response
    const updatedGeneralUsage = await checkUsageLimit(userId, "general");
    const updatedWorkoutUsage = await checkUsageLimit(userId, "workout");

    res.json({
      success: true,
      response: structuredResponse, // Return structured response
      remaining_queries: {
        general: updatedGeneralUsage.remaining,
        workout: updatedWorkoutUsage.remaining,
      },
      conversation_id: chatSessionId,
      inquiry_type: isWorkoutInquiry ? "workout" : "general",
    });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get conversation history endpoint
router.get("/chat/history", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { sessionId, limit = 50 } = req.query;

  try {
    const pool = getPool();

    let result;
    if (sessionId) {
      // Get messages for specific session
      result = await pool
        .request()
        .input("sessionId", sessionId)
        .input("userId", userId)
        .input("limit", parseInt(limit)).query(`
          SELECT TOP (@limit) Role, Content, Timestamp
          FROM dbo.ChatMessages 
          WHERE ChatSessionID = @sessionId AND UserID = @userId
          ORDER BY Timestamp ASC
        `);
    } else {
      // Get messages from most recent session
      result = await pool
        .request()
        .input("userId", userId)
        .input("limit", parseInt(limit)).query(`
          SELECT TOP (@limit) cm.Role, cm.Content, cm.Timestamp
          FROM dbo.ChatMessages cm
          INNER JOIN dbo.ChatbotSession cs ON cm.ChatSessionID = cs.chatSessionID
          WHERE cs.UserId = @userId
          ORDER BY cm.Timestamp DESC
        `);
    }

    // Parse structured responses back to objects for display
    const messages = result.recordset.reverse().map((msg) => {
      try {
        // Try to parse assistant messages as JSON (structured responses)
        if (msg.Role === "assistant" && msg.Content.startsWith("{")) {
          const parsedContent = JSON.parse(msg.Content);
          return {
            ...msg,
            Content: parsedContent,
            isStructured: true,
          };
        }
        return {
          ...msg,
          isStructured: false,
        };
      } catch (error) {
        // If parsing fails, return as-is (for legacy messages)
        return {
          ...msg,
          isStructured: false,
        };
      }
    });

    res.json({
      success: true,
      messages: messages, // Return in chronological order with structured responses parsed
    });
  } catch (error) {
    console.error("Get history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve conversation history",
    });
  }
});

// Clear chat history endpoint
router.delete("/chat/history", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { sessionId } = req.query;

  try {
    const pool = getPool();

    if (sessionId) {
      // Delete specific session
      await pool.request().input("sessionId", sessionId).input("userId", userId)
        .query(`
          DELETE FROM dbo.ChatMessages 
          WHERE ChatSessionID = @sessionId AND UserID = @userId
        `);
    } else {
      // Delete all user's messages
      await pool.request().input("userId", userId).query(`
          DELETE FROM dbo.ChatMessages 
          WHERE UserID = @userId
        `);
    }

    res.json({
      success: true,
      message: "Chat history cleared successfully",
    });
  } catch (error) {
    console.error("Clear history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clear chat history",
    });
  }
});

// Analyze pre-assessment data endpoint
router.post("/analyze-pre-assessment", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { assessmentData, workoutPlanId } = req.body;

  if (!assessmentData) {
    return res.status(400).json({
      success: false,
      message: "Assessment data is required",
    });
  }

  try {
    const pool = getPool();

    // Get the workout plan if ID is provided
    let workoutPlan = null;
    if (workoutPlanId) {
      const planResult = await pool
        .request()
        .input("planId", workoutPlanId)
        .input("userId", userId)
        .query(`
          SELECT PlanData, Goal, DaysPerWeek, Split
          FROM dbo.AIWorkoutPlans 
          WHERE PlanID = @planId AND UserID = @userId AND IsActive = 1
        `);

      if (planResult.recordset.length > 0) {
        workoutPlan = planResult.recordset[0];
        try {
          workoutPlan.PlanData = JSON.parse(workoutPlan.PlanData);
        } catch (e) {
          workoutPlan.PlanData = [];
        }
      }
    }

    // Analyze readiness based on assessment data
    const analysis = analyzeReadiness(assessmentData, workoutPlan);

    // Determine if modification is needed
    const shouldModify = analysis.readinessScore < 70;

    // Generate modified plan if needed
    let modifiedPlan = null;
    if (shouldModify && workoutPlan) {
      modifiedPlan = generateModifiedPlan(workoutPlan, analysis);
    }

    res.json({
      success: true,
      shouldModify,
      analysis,
      modifiedPlan,
    });
  } catch (error) {
    console.error("Analyze pre-assessment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to analyze pre-assessment data",
    });
  }
});

/**
 * Analyze user readiness based on pre-assessment data
 * @param {Object} assessmentData - Pre-workout assessment data
 * @param {Object} workoutPlan - Planned workout (optional)
 * @returns {Object} Analysis result with readiness score and concerns
 */
const analyzeReadiness = (assessmentData, workoutPlan) => {
  let readinessScore = 100;
  const concerns = [];

  // Analyze feeling
  if (assessmentData.feeling === "Bad") {
    readinessScore -= 25;
    concerns.push("You reported feeling bad today");
  } else if (assessmentData.feeling === "Average") {
    readinessScore -= 10;
  } else if (assessmentData.feeling === "Unsure") {
    readinessScore -= 5;
  }

  // Analyze sleep quality (0-4 scale)
  if (assessmentData.sleepQuality !== null && assessmentData.sleepQuality !== undefined) {
    if (assessmentData.sleepQuality <= 1) {
      readinessScore -= 25;
      concerns.push(`Poor sleep quality (${assessmentData.sleepQuality}/4)`);
    } else if (assessmentData.sleepQuality === 2) {
      readinessScore -= 15;
      concerns.push(`Below average sleep quality (${assessmentData.sleepQuality}/4)`);
    }
  }

  // Analyze sleep hours
  if (assessmentData.sleepHours) {
    if (assessmentData.sleepHours === "<6") {
      readinessScore -= 20;
      concerns.push("Less than 6 hours of sleep");
    } else if (assessmentData.sleepHours === "6-7") {
      readinessScore -= 10;
    }
  }

  // Analyze recovery status
  if (assessmentData.recoveryStatus === "Not Recovered") {
    readinessScore -= 30;
    concerns.push("You reported not being fully recovered");
  } else if (assessmentData.recoveryStatus === "Sore") {
    readinessScore -= 15;
    concerns.push("You reported muscle soreness");
  }

  // Analyze hydration
  if (assessmentData.waterIntake === "<50oz") {
    readinessScore -= 10;
    concerns.push("Low water intake today");
  }

  // Ensure score is within bounds
  readinessScore = Math.max(0, Math.min(100, readinessScore));

  // Generate recommendation
  let recommendation;
  if (readinessScore >= 80) {
    recommendation = "You're in great shape for today's workout! Let's crush it!";
  } else if (readinessScore >= 60) {
    recommendation = "Consider reducing intensity slightly to account for your current state.";
  } else if (readinessScore >= 40) {
    recommendation = "I recommend a lighter workout today to prioritize recovery.";
  } else {
    recommendation = "Taking a rest day or doing light mobility work might be best today.";
  }

  return {
    readinessScore,
    concerns,
    recommendation,
  };
};

/**
 * Generate a modified workout plan based on analysis
 * @param {Object} workoutPlan - Original workout plan
 * @param {Object} analysis - Readiness analysis
 * @returns {Object} Modified plan
 */
const generateModifiedPlan = (workoutPlan, analysis) => {
  // Calculate intensity reduction factor based on readiness score
  const reductionFactor = analysis.readinessScore >= 60 ? 0.85 : 0.7;

  const modifiedDays = workoutPlan.PlanData.map((day) => ({
    ...day,
    main: day.main.map((exercise) => ({
      ...exercise,
      sets: Math.max(1, Math.floor(exercise.sets * reductionFactor)),
      rpe: Math.max(5, exercise.rpe - (analysis.readinessScore >= 60 ? 1 : 2)),
      modified: true,
    })),
  }));

  return {
    ...workoutPlan,
    PlanData: modifiedDays,
    modifications: {
      reason: analysis.concerns.join("; "),
      intensityReduction: Math.round((1 - reductionFactor) * 100) + "%",
      originalReadinessScore: analysis.readinessScore,
    },
  };
};

module.exports = router;
