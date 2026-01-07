// server.js - Azure HARDENED startup version

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

// SAFE logger wrapper
let logger = {
  info: console.log,
  error: console.error,
  request: () => {}
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
   Health
====================== */
app.get("/", (_, res) => res.send("ApogeeHnP backend is running"));

app.get("/health", async (_, res) => {
  try {
    const pool = getPool();
    if (!pool) throw new Error("DB not initialized");
    await pool.request().query("SELECT 1");
    res.json({ status: "healthy" });
  } catch (err) {
    res.status(503).json({ status: "unhealthy", error: err.message });
  }
});

/* ======================
   START SERVER (DO NOT FAIL)
====================== */
app.listen(PORT, () => {
  console.log("✅ Server listening on port", PORT);
});

/* ======================
   DB CONNECT (NON-BLOCKING)
====================== */
(async () => {
  try {
    await connectToDatabase();
    console.log("✅ Database connected");
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
  }
})();
