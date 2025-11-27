// server.js

require("dotenv").config(); // Load environment variables first
const express = require("express");
const cors = require("cors");
const multer = require("multer");

const { connectToDatabase } = require("./config/db");
// const session = require("express-session");
const { sql, config } = require("./db");  // Server
// const db = require('./config/db');  // Local
const { exchangeCodeForToken, getUserInfo } = require("./services/ouraService");

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

// app.use(
//   session({
//     secret: "SUPER_SECRET_SESSION",
//     resave: false,
//     saveUninitialized: true
//   })
// );

// Connect to the database
connectToDatabase();

// // Connect to the database (Local Modifications)
// connectToDatabase()
//   .then(() => console.log('DB connected'))
//   .catch(err => console.error(err));

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

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
