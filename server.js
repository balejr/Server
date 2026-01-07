// server.js - v3 Azure-safe deployment fix

require("dotenv").config(); // Load env vars FIRST
const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./swagger");
const { connectToDatabase, getPool } = require("./config/db");
const logger = require("./utils/logger");

// Metadata
const SERVER_START_TIME = new Date().toISOString();
const BUILD_VERSION = "2026-01-07-v3-azure-fix";

// Routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const dataRoutes = require("./routes/dataRoutes");
const chatbotRoutes = require("./routes/chatbotRoutes");
const configRoutes = require("./routes/configRoutes");
const { router: usageRoutes } = require("./routes/usageRoutes");
const { router: workoutRoutes } = require("./routes/workoutRoutes");

const app = express();
const PORT = process.env.PORT || 3000;

/* ======================
   Middleware
====================== */
app.use(cors());

// Request logging (important for Azure diagnostics)
app.use((req, res, next) => {
  logger.request(req.method, req.originalUrl);
  next();
});

// Stripe webhook requires raw body
app.use("/api/data/webhooks/stripe", express.raw({ type: "application/json" }));

// JSON body parser
app.use(express.json());

/* ======================
   Swagger
====================== */
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

app.get("/api/docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

/* ======================
   Routes
====================== */
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/usage", usageRoutes);
app.use("/api/workout", workoutRoutes);
app.use("/api/config", configRoutes);

/* ======================
   Health & Meta
====================== */

// Root — Azure startup probe hits this
app.get("/", (req, res) => {
  res.status(200).send("ApogeeHnP backend is running");
});

// Azure health probe (safe DB check)
app.get("/health", async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({
        status: "unhealthy",
        reason: "Database not initialized",
      });
    }

    await pool.request().query("SELECT 1");
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Health check failed:", err.message);
    res.status(503).json({
      status: "unhealthy",
      reason: err.message,
    });
  }
});

app.get("/api/version", (req, res) => {
  res.json({
    version: BUILD_VERSION,
    serverStartedAt: SERVER_START_TIME,
    nodeVersion: process.version,
  });
});

/* ======================
   START SERVER (CRITICAL)
====================== */

// 🔥 LISTEN FIRST — DO NOT BLOCK AZURE
app.listen(PORT, () => {
  logger.info(`✅ Server listening on port ${PORT}`);
});

// 🔄 Connect DB asynchronously (non-blocking)
(async () => {
  try {
    logger.info("Connecting to database...");
    await connectToDatabase();
    logger.info("✅ Database connected");
  } catch (err) {
    logger.error("❌ Database connection failed:", err.message);
    // Do NOT exit — Azure must stay alive
  }
})();
