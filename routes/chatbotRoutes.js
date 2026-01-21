// routes/chatbotRoutes.js
const express = require("express");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("../utils/logger");

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

// Debug: Log API configuration at startup
logger.debug("Chatbot Routes - API Configuration", {
  hasApiKey: !!GOOGLE_API_KEY && GOOGLE_API_KEY !== "undefined",
  apiKeyLength: GOOGLE_API_KEY ? GOOGLE_API_KEY.length : 0,
  modelName: MODEL_NAME,
  apiBaseUrl: API_BASE_URL,
});

// Structured response configuration for FitNext AI
const FITNEXT_SYSTEM_INSTRUCTION = `You are FitNext AI, the in-app health & fitness assistant.

Rules:
• Scope → fitness and general dietary education only. No diagnoses, prescriptions, or treatment plans.
• Modes → GENERAL, WORKOUT_CONFIRM, WORKOUT_CREATE, WORKOUT_MODIFY, DIET_GUIDE, OUT_OF_SCOPE.
• Intent → GENERAL, WORKOUT_REQUEST, WORKOUT_MODIFICATION, DIET_GUIDANCE_REQUEST, OUT_OF_SCOPE.
• Always return valid JSON as defined by the response schema.
• Use RPE (6–10 scale) to express workout intensity.
• Never generate or modify a workout in the same turn you ask for confirmation.
• Keep message titles under 60 chars, bodies under 240 chars.
• Be concise, friendly, and professional—no emojis.
• When providing a general dietary guide, include the following disclaimer: "This is general dietary advice. Always consult a registered dietitian or healthcare professional for personalized nutritional guidance."
• When out of scope, use the refusal template:
  "I am an AI fitness assistant and cannot provide {diagnoses/prescriptions/unrelated info}.
Please consult a licensed professional for that.
   I can help with fitness education, workout planning, general dietary guidance, and healthy habits.`;

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
    logger.error("Error saving message to database", {
      error: error.message,
      code: error.code,
      state: error.state,
    });
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
    logger.error("Error getting conversation history", { error: error.message });
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
    logger.error("Error creating/getting chat session", {
      error: error.message,
      code: error.code,
      state: error.state,
    });
    throw error;
  }
};

/**
 * Function to call Gemini API with structured response
 * @param {string} userMessage - The user's message
 * @param {Array} conversationHistory - Previous conversation messages
 * @returns {Promise<Object>} Structured response object
 */
const callGeminiAPI = async (
  userMessage,
  conversationHistory = [],
  options = {}
) => {
  try {
    logger.debug("API Key check", {
      hasKey: !!GOOGLE_API_KEY,
      keyValue: GOOGLE_API_KEY
        ? `${GOOGLE_API_KEY.substring(0, 10)}...`
        : "undefined",
      keyLength: GOOGLE_API_KEY ? GOOGLE_API_KEY.length : 0,
    });

    logger.debug("Model check", {
      modelName: MODEL_NAME,
      isValidModel: MODEL_NAME && MODEL_NAME.includes("gemini"),
    });

    if (!GOOGLE_API_KEY || GOOGLE_API_KEY === "undefined") {
      logger.warn("API key not configured, returning fallback response");
      return getMockStructuredResponse(userMessage, conversationHistory, {
        reason: "AI_NOT_CONFIGURED",
      });
    }

    if (!MODEL_NAME || !MODEL_NAME.includes("gemini")) {
      logger.warn("Invalid model name, returning fallback response");
      return getMockStructuredResponse(userMessage, conversationHistory, {
        reason: "AI_MODEL_INVALID",
      });
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

    // Allow request-level model override (client may request gemini-2.5-pro).
    // Only allow Gemini models by name to avoid unexpected routing.
    const requestedModel = String(options?.model || "").trim();
    const modelNameToUse =
      requestedModel && requestedModel.includes("gemini")
        ? requestedModel
        : MODEL_NAME;

    // Initialize Google Generative AI
    const ai = new GoogleGenerativeAI({ apiKey: GOOGLE_API_KEY });

    // Configuration for structured response
    const config = {
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      systemInstruction: [
        {
          text: FITNEXT_SYSTEM_INSTRUCTION,
        },
      ],
    };

    // Build the conversation content
    const contents = [
      {
        role: "user",
        parts: [
          {
            text: `${conversationContext}**Current User Message:** "${userMessage}"`,
          },
        ],
      },
    ];

    // Generate structured content
    logger.debug("Making API call to Gemini", {
      model: modelNameToUse,
      userMessage: userMessage.substring(0, 50) + "...",
      hasConfig: !!config,
      hasSchema: !!config.responseSchema,
    });

    // Try the exact structure from Google AI Studio
    const response = await ai.models.generateContent({
      model: modelNameToUse,
      config,
      contents,
    });

    // Parse the structured response
    logger.debug("Gemini response received", {
      responseType: typeof response,
      responseMethods: Object.getOwnPropertyNames(response),
    });

    // Try different ways to get the text content
    let responseText;
    if (typeof response.text === "function") {
      responseText = response.text();
    } else if (
      response.response &&
      typeof response.response.text === "function"
    ) {
      responseText = response.response.text();
    } else if (
      response.candidates &&
      response.candidates[0] &&
      response.candidates[0].content
    ) {
      responseText = response.candidates[0].content.parts[0].text;
    } else {
      logger.warn("Could not extract text from response");
      throw new Error("Unable to extract text from Gemini response");
    }

    logger.debug("Raw API Response", {
      preview: String(responseText || "").substring(0, 200) + "...",
    });

    // Some models may wrap JSON in markdown fences or extra text.
    // Try a robust parse: first direct JSON.parse, then extract the outermost JSON object.
    let structuredResponse;
    try {
      structuredResponse = JSON.parse(responseText);
    } catch (parseErr) {
      const raw = String(responseText || "");
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first >= 0 && last > first) {
        structuredResponse = JSON.parse(raw.slice(first, last + 1));
      } else {
        throw parseErr;
      }
    }
    logger.info("Parsed structured response", {
      mode: structuredResponse.mode,
      intent: structuredResponse.intent,
      hasMessage: !!structuredResponse.message,
    });

    return structuredResponse;
  } catch (error) {
    logger.error("Error calling Gemini API", {
      error: error.message,
      name: error.name,
      cause: error.cause,
    });

    // Check if it's a network error
    if (error.message.includes("fetch failed")) {
      logger.error("Network/fetch error detected", {
        possibleCauses: [
          "Internet connection issues",
          "API key invalid or expired",
          "Model name incorrect",
          "API endpoint issues",
          "Rate limiting",
        ],
      });
    }

    // Return fallback structured response (do not block UX).
    return getMockStructuredResponse(userMessage, conversationHistory, {
      reason: "AI_CALL_FAILED",
      error: error?.message,
    });
  }
};

/**
 * Mock structured response function for fallback
 * @param {string} userMessage - The user's message
 * @param {Array} conversationHistory - Previous conversation messages
 * @returns {Object} Structured response object
 */
const getMockStructuredResponse = (
  userMessage,
  conversationHistory = [],
  meta = {}
) => {
  // Check if this is a follow-up question based on conversation history
  const hasPreviousContext = conversationHistory.length > 0;
  const lastMessage = hasPreviousContext
    ? conversationHistory[conversationHistory.length - 1]
    : null;

  const msg = String(userMessage || "").toLowerCase();
  const wantsPlanVerb =
    msg.includes("create") ||
    msg.includes("generate") ||
    msg.includes("build") ||
    msg.includes("make") ||
    msg.includes("design");
  const mentionsPlanThing =
    msg.includes("workout plan") ||
    msg.includes("training plan") ||
    msg.includes("routine") ||
    msg.includes("program");

  const isWorkoutRequest = mentionsPlanThing || (wantsPlanVerb && msg.includes("plan"));

  const isOutOfScope =
    msg.includes("pain") ||
    msg.includes("hurt") ||
    msg.includes("injury") ||
    msg.includes("medicine") ||
    msg.includes("doctor");

  if (meta?.reason === "AI_NOT_CONFIGURED") {
    return {
      mode: "GENERAL",
      intent: "GENERAL",
      message: {
        title: "AI not configured",
        body: "The AI service is not configured on the server yet. Please set GEMINI_API_KEY and restart the backend.",
      },
      payload: {
        answer: [
          "Set App Service env var GEMINI_API_KEY",
          "Optionally set GEMINI_MODEL_NAME=gemini-2.5-pro",
          "Restart the App Service",
        ],
      },
      errors: ["AI_NOT_CONFIGURED"],
    };
  }

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
    return {
      mode: "WORKOUT_CONFIRM",
      intent: "WORKOUT_REQUEST",
      message: {
        title: "Confirm your plan",
        body: "I can create a personalized workout plan based on your request. Shall I create it now?",
      },
      payload: {
        confirmQuestion: "Would you like me to create a workout plan now?",
        summary: {
          goal: "General fitness",
          daysPerWeek: 3,
          experience: "intermediate",
          equipment: ["bodyweight", "dumbbells"],
          constraints: [],
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
        body: "I'm your FitNext AI fitness assistant. Ask me anything about training, technique, recovery, and nutrition basics, or ask me to create a workout plan.",
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

/**
 * @swagger
 * /chatbot/chat:
 *   post:
 *     summary: Send message to AI assistant
 *     description: Send a message to the AI fitness assistant and receive a structured response
 *     tags: [Chatbot]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatRequest'
 *     responses:
 *       200:
 *         description: AI response with remaining query counts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         description: Weekly inquiry limit reached
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post("/chat", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { message, sessionType = "inquiry", model } = req.body;

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

    // Call Gemini API to get structured response
    const structuredResponse = await callGeminiAPI(
      message,
      conversationHistory,
      { model }
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

        logger.info("Workout plan saved successfully", { planId: savedPlanId });
        // Add plan ID to the response for frontend reference
        structuredResponse.payload.savedPlanId = savedPlanId;
      } catch (error) {
        logger.error("Critical error: Failed to save workout plan", {
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
    logger.error("Chat endpoint error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * @swagger
 * /chatbot/chat/history:
 *   get:
 *     summary: Get chat history
 *     description: Retrieve conversation history for the authenticated user
 *     tags: [Chatbot]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         schema:
 *           type: string
 *         description: Specific session ID (optional)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Chat history
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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
    logger.error("Get history error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Failed to retrieve conversation history",
    });
  }
});

/**
 * @swagger
 * /chatbot/chat/history:
 *   delete:
 *     summary: Clear chat history
 *     description: Delete chat history for the authenticated user
 *     tags: [Chatbot]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         schema:
 *           type: string
 *         description: Specific session to delete (optional, clears all if omitted)
 *     responses:
 *       200:
 *         description: Chat history cleared
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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
    logger.error("Clear history error", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Failed to clear chat history",
    });
  }
});

module.exports = router;
