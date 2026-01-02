// server.js - v3 deployment fix

require("dotenv").config(); // Load environment variables first
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./swagger");
const { connectToDatabase } = require("./config/db");

// Capture startup time for version endpoint (helps identify stale instances)
const SERVER_START_TIME = new Date().toISOString();
const BUILD_VERSION = "2025-12-31-v3";

// Import routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const dataRoutes = require("./routes/dataRoutes");
const chatbotRoutes = require("./routes/chatbotRoutes");
const { router: usageRoutes } = require("./routes/usageRoutes");
const { router: workoutRoutes } = require("./routes/workoutRoutes");

const app = express();
const PORT = process.env.PORT || 3000;

const logger = require("./utils/logger");

// Middleware
app.use(cors());
// Request logging middleware - log all requests to Azure
app.use((req, res, next) => {
  logger.request(req.method, req.path);
  next();
});

// Webhook endpoint needs raw body for Stripe signature verification
app.use("/api/data/webhooks/stripe", express.raw({ type: "application/json" }));
app.use(express.json());

// Database connection is awaited in startServer() below

// Swagger API Documentation
app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "ApogeeHnP API Docs",
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: "alpha",
      operationsSorter: "alpha",
    },
  })
);

// JSON spec endpoint for external tools (Postman, etc.)
app.get("/api/docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/usage", usageRoutes);
app.use("/api/workout", workoutRoutes);

// Root route for basic health check
app.get("/", (req, res) => {
  res.send("ApogeeHnP backend is running!");
});

// Health check endpoint - verifies actual DB connectivity
// Configure Azure App Service to use this path for health probes
app.get("/health", async (req, res) => {
  try {
    const pool = require("./config/db").getPool();
    if (!pool) {
      return res.status(503).json({ 
        status: "unhealthy", 
        reason: "Database pool not initialized" 
      });
    }
    // Quick connectivity check
    await pool.request().query("SELECT 1");
    res.json({ 
      status: "healthy",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error("Health check failed:", err.message);
    res.status(503).json({ 
      status: "unhealthy", 
      reason: err.message 
    });
  }
});

// Version endpoint for deployment verification
// Use this to verify all Azure instances are running the same code
app.get("/api/version", (req, res) => {
  res.json({
    version: BUILD_VERSION,
    serverStartedAt: SERVER_START_TIME,
    currentTime: new Date().toISOString(),
    nodeVersion: process.version,
    features: [
      "duplicate-email-check",
      "accessToken-response-format",
      "token-pair-signin",
    ],
  });
});

// Start server - await database connection before listening
const startServer = async () => {
  try {
    logger.info("Connecting to database...");
    await connectToDatabase();
    logger.info("Database connected successfully");
    
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (err) {
    logger.error("Failed to start server:", err.message);
    // Exit with error code so Azure knows the container failed
    process.exit(1);
  }
};

startServer();
