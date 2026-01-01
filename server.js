// server.js - v3 deployment fix

require("dotenv").config(); // Load environment variables first
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { connectToDatabase } = require("./config/db");

// Import routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const dataRoutes = require("./routes/dataRoutes");
const chatbotRoutes = require("./routes/chatbotRoutes");
const { router: usageRoutes } = require("./routes/usageRoutes");
const { router: workoutRoutes } = require("./routes/workoutRoutes");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
// Request logging middleware - log all requests to Azure
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  process.stdout.write(`\n[${timestamp}] 📥 ${req.method} ${req.path}\n`);
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Webhook endpoint needs raw body for Stripe signature verification
app.use('/api/data/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json());

// Connect to the database
connectToDatabase();

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/usage", usageRoutes);
app.use("/api/workout", workoutRoutes);

// Root route for health check
app.get("/", (req, res) => {
  res.send("ApogeeHnP backend is running!");
});

// Version endpoint for deployment verification
app.get("/api/version", (req, res) => {
  res.json({
    version: "2025-12-31-v3",
    deployedAt: new Date().toISOString(),
    features: ["duplicate-email-check", "accessToken-response-format", "token-pair-signin"]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
