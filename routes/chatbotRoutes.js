// routes/chatbotRoutes.js
const express = require("express");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { checkUsageLimit, incrementUsage } = require("./usageRoutes");

const router = express.Router();

// API Configuration - Using environment variables for security
const GOOGLE_API_KEY = process.env.GEMINI_API_KEY || "undefined";
const API_BASE_URL =
  process.env.GEMINI_API_BASE_URL ||
  "https://generativelanguage.googleapis.com";
const MODEL_NAME = process.env.GEMINI_MODEL_NAME || "gemini-2.5-pro";

// The pre-engineered prompt for FitNext AI
const FITNEXT_SYSTEM_PROMPT = `FitNext Smart Chatbot System Prompt

You are FitNext AI, a comprehensive fitness and wellness assistant designed to provide personalized guidance across multiple domains:

**Core Capabilities:**
1. **Virtual Personal Trainer**: Create customized workout plans, provide exercise guidance, and track progress
2. **Health & Fitness Coach**: Offer nutrition advice, lifestyle recommendations, and motivation
3. **Scope-Limited Physical Therapist**: Provide basic form analysis, injury prevention tips, and recovery guidance

**Knowledge Base:**
- Exercise science and biomechanics
- Nutrition fundamentals and meal planning
- Injury prevention and recovery protocols
- Progressive training methodologies
- Mental health and motivation strategies
- Equipment usage and alternatives

**Response Guidelines:**
- Always prioritize safety and proper form
- Provide actionable, step-by-step instructions
- Consider individual fitness levels and limitations
- Include modifications for different skill levels
- Reference evidence-based practices
- Maintain an encouraging, supportive tone
- Ask clarifying questions when needed
- Disclaim medical advice appropriately

**Safety Protocols:**
- Never recommend exercises that could cause harm
- Always suggest consulting healthcare providers for medical concerns
- Emphasize proper warm-up and cool-down routines
- Provide clear form cues and safety warnings
- Recommend starting with lighter weights/progressions

**Communication Style:**
- Professional yet approachable
- Clear and concise explanations
- Use encouraging language
- Provide specific, measurable recommendations
- Include progress tracking suggestions

Remember: Always prioritize safety and proper form. When in doubt, start lighter and progress gradually.`;

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
    console.error("Error saving message to database:", error);
    console.error("Error details:", {
      message: error.message,
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
    console.error("Error creating/getting chat session:", error);
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      state: error.state,
    });
    throw error;
  }
};

// Function to call Gemini API with conversation history
const callGeminiAPI = async (userMessage, conversationHistory = []) => {
  try {
    if (!GOOGLE_API_KEY || GOOGLE_API_KEY === "undefined") {
      console.log("API key not configured, returning mock response");
      return getMockResponse(userMessage, conversationHistory);
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

    const prompt = `${FITNEXT_SYSTEM_PROMPT}

${conversationContext}

**Current User Message:** "${userMessage}"

Please provide a helpful, fitness-focused response based on the FitNext knowledge base and the conversation context above. Keep your response concise and actionable. Remember what we've discussed previously and build upon that context.`;

    // Initialize Google Generative AI
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    // Generate content
    const result = await model.generateContent(prompt);
    const response = result.response;
    const aiResponse = response.text();

    return aiResponse;
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return getMockResponse(userMessage, conversationHistory);
  }
};

// Mock response function for fallback with conversation context
const getMockResponse = (userMessage, conversationHistory = []) => {
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
    userMessage.toLowerCase().includes("full body");

  if (isWorkoutRequest) {
    if (
      hasPreviousContext &&
      lastMessage.Role === "assistant" &&
      lastMessage.Content.includes("workout")
    ) {
      return `Great! Based on our previous discussion, here are some specific next steps:

**Next Actions:**
• Start with the warm-up routine I mentioned
• Focus on proper form for each exercise
• Track your progress in a workout log
• Rest 1-2 days between sessions

**Questions for you:**
• How did the first workout feel?
• Any exercises that felt challenging?
• What equipment do you have available?

Let me know how it goes and I can help adjust the plan!`;
    } else {
      return `I can help you create a personalized workout plan! Based on your request, here's what I recommend:

**Quick Workout Plan:**
• **Warm-up**: 5-10 minutes light cardio + dynamic stretching
• **Main Workout**: 3-4 compound exercises (squats, push-ups, rows)
• **Sets**: 3 sets of 8-12 reps each
• **Rest**: 60-90 seconds between sets
• **Cool-down**: 5-10 minutes stretching

**Progression Tips:**
• Start with bodyweight exercises
• Focus on proper form first
• Gradually increase intensity
• Rest 1-2 days between workouts

Would you like me to create a more detailed, personalized plan based on your specific goals and fitness level?`;
    }
  } else {
    return `I'm your FitNext AI fitness assistant! I can help you with:

• **Workout plans** and exercise routines
• **Form analysis** and technique tips
• **Nutrition guidance** for fitness goals
• **Recovery strategies** and injury prevention
• **Fitness questions** and general advice

What specific fitness topic would you like to discuss?`;
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
    // Check usage limits
    const usage = await checkUsageLimit(userId);

    if (usage.remaining <= 0) {
      return res.status(429).json({
        success: false,
        message:
          "Weekly message limit reached. Upgrade to premium for more messages.",
        remaining_queries: 0,
      });
    }

    // Get or create chat session
    const chatSessionId = await createOrGetChatSession(
      userId,
      validatedSessionType
    );

    // Get recent conversation history for context
    const conversationHistory = await getConversationHistory(chatSessionId, 10);

    // Call Gemini API
    const aiResponse = await callGeminiAPI(message, conversationHistory);

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
      aiResponse
    );

    // Increment usage counter
    const usageIncremented = await incrementUsage(userId);

    // Update usage for response
    const updatedUsage = await checkUsageLimit(userId);

    res.json({
      success: true,
      response: aiResponse,
      remaining_queries: updatedUsage.remaining,
      conversation_id: chatSessionId,
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

    res.json({
      success: true,
      messages: result.recordset.reverse(), // Return in chronological order
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

module.exports = router;
