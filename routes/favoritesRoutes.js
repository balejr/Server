const express = require("express");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");
const logger = require("../utils/logger");
const router = express.Router();

// GET / — Fetch user's favorites
router.get("/", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("userId", userId)
      .query("SELECT ExerciseID FROM dbo.Favorites WHERE UserID = @userId");
    res.json(result.recordset.map((r) => r.ExerciseID));
  } catch (err) {
    logger.error("GET /favorites Error", { userId, error: err.message });
    res.status(500).json({ success: false, message: "Failed to fetch favorites" });
  }
});

// POST / — Add a favorite
router.post("/", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { exerciseId } = req.body;

  if (!exerciseId) {
    return res.status(400).json({ success: false, message: "exerciseId is required" });
  }

  try {
    const pool = getPool();

    // Check for duplicate
    const existing = await pool
      .request()
      .input("userId", userId)
      .input("exerciseId", exerciseId)
      .query(
        "SELECT 1 FROM dbo.Favorites WHERE UserID = @userId AND ExerciseID = @exerciseId"
      );

    if (existing.recordset.length > 0) {
      return res.status(200).json({ success: true, message: "Already favorited" });
    }

    await pool
      .request()
      .input("userId", userId)
      .input("exerciseId", exerciseId)
      .query(
        "INSERT INTO dbo.Favorites (UserID, ExerciseID) VALUES (@userId, @exerciseId)"
      );

    res.status(201).json({ success: true, message: "Favorite added" });
  } catch (err) {
    logger.error("POST /favorites Error", { userId, error: err.message });
    res.status(500).json({ success: false, message: "Failed to add favorite" });
  }
});

// DELETE /:exerciseId — Remove a favorite
router.delete("/:exerciseId", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { exerciseId } = req.params;

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("userId", userId)
      .input("exerciseId", exerciseId)
      .query(
        "DELETE FROM dbo.Favorites WHERE UserID = @userId AND ExerciseID = @exerciseId"
      );

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: "Favorite not found" });
    }

    res.json({ success: true, message: "Favorite removed" });
  } catch (err) {
    logger.error("DELETE /favorites/:exerciseId Error", { userId, exerciseId, error: err.message });
    res.status(500).json({ success: false, message: "Failed to remove favorite" });
  }
});

module.exports = router;
