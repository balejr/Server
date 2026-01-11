// server.js - Azure Hardened v4

require("dotenv").config();
const express = require("express");
const cors = require("cors");

let swaggerUi;
let swaggerSpec;

try {
  swaggerUi = require("swagger-ui-express");
  swaggerSpec = require("./swagger");
} catch (err) {
  console.error("⚠️ Swagger disabled:", err.message);
}

const { connectToDatabase, getPool } = require("./config/db");

// SAFE logger fallback
let logger = {
  info: console.log,
  error: console.error,
  request: () => {},
};
try {
  logger = require("./utils/logger");
} catch (err) {
  console.error("⚠️ Logger fallback enabled:", err.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

console.log("🚀 Starting server...");
console.log("PORT:", PORT);
console.log("NODE VERSION:", process.version);

/* ======================
   Middleware
====================== */
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  logger.request(req.method, req.originalUrl);
  next();
});

/* ======================
   Routes (SAFE LOAD)
====================== */
try {
  app.use("/api/auth", require("./routes/authRoutes"));
  app.use("/api/user", require("./routes/userRoutes"));
  app.use("/api/data", require("./routes/dataRoutes"));
  app.use("/api/chatbot", require("./routes/chatbotRoutes"));
  app.use("/api/config", require("./routes/configRoutes"));
  app.use("/api/usage", require("./routes/usageRoutes").router);
  app.use("/api/workout", require("./routes/workoutRoutes").router);
  app.use("/api/rewards", require("./routes/rewardsRoutes"));
} catch (err) {
  console.error("❌ Route load failure:", err.message);
}

/* ======================
   Swagger (OPTIONAL)
====================== */
if (swaggerUi && swaggerSpec) {
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

/* ======================
   Health & Root
====================== */
app.get("/", (_, res) => res.send("ApogeeHnP backend is running"));

app.get("/health", async (_, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.json({
        status: "healthy",
        db: "not ready",
        timestamp: new Date().toISOString(),
      });
    }
    await pool.request().query("SELECT 1");
    res.json({ status: "healthy", db: "connected" });
  } catch (err) {
    res.json({ status: "healthy", db: "error", error: err.message });
  }
});

/* ======================
   Version endpoint
====================== */
app.get("/api/version", (_, res) => {
  res.json({
    version: "2026-01-07-v4-azure",
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  });
});

/* ======================
   START SERVER (Azure-safe)
====================== */
app.listen(PORT, () => {
  console.log("✅ Server listening on port", PORT);
});

/* ======================
   Database Connect (Async + Retry)
====================== */
const MAX_RETRIES = 5;
let attempt = 0;

async function initDB() {
  while (attempt < MAX_RETRIES) {
    try {
      await connectToDatabase();
      console.log("✅ Database connected");
      return;
    } catch (err) {
      attempt++;
      console.error(`❌ DB connection attempt ${attempt} failed:`, err.message);
      await new Promise(r => setTimeout(r, 5000)); // 5s retry
    }
  }
  console.error("❌ DB connection failed after retries, continuing without blocking server");
}
initDB();
