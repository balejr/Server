/**
 * Level Calculator Service
 *
 * Calculates user level based on XP, handles level-up detection,
 * and provides tier mapping for the 21-level progression system.
 *
 * Level Thresholds:
 *   Level 1-5 (Beginner/BRONZE): 0-400 XP (100 XP gaps)
 *   Level 6-10 (Intermediate/SILVER): 500-1300 XP (200 XP gaps)
 *   Level 11-15 (Advanced/GOLD): 1500-2700 XP (300 XP gaps)
 *   Level 16-20 (Elite/EXCLUSIVE): 3000-4600 XP (400 XP gaps)
 *   Level 21+ (Champion/CHAMPION): 5000+ XP (500+ XP gaps)
 */

const logger = require("../utils/logger");

// Level thresholds with corresponding tiers
const LEVEL_THRESHOLDS = [
  { level: 1, minXP: 0, tier: "BRONZE", tierName: "Beginner" },
  { level: 2, minXP: 100, tier: "BRONZE", tierName: "Beginner" },
  { level: 3, minXP: 200, tier: "BRONZE", tierName: "Beginner" },
  { level: 4, minXP: 300, tier: "BRONZE", tierName: "Beginner" },
  { level: 5, minXP: 400, tier: "BRONZE", tierName: "Beginner" },
  { level: 6, minXP: 500, tier: "SILVER", tierName: "Intermediate" },
  { level: 7, minXP: 700, tier: "SILVER", tierName: "Intermediate" },
  { level: 8, minXP: 900, tier: "SILVER", tierName: "Intermediate" },
  { level: 9, minXP: 1100, tier: "SILVER", tierName: "Intermediate" },
  { level: 10, minXP: 1300, tier: "SILVER", tierName: "Intermediate" },
  { level: 11, minXP: 1500, tier: "GOLD", tierName: "Advanced" },
  { level: 12, minXP: 1800, tier: "GOLD", tierName: "Advanced" },
  { level: 13, minXP: 2100, tier: "GOLD", tierName: "Advanced" },
  { level: 14, minXP: 2400, tier: "GOLD", tierName: "Advanced" },
  { level: 15, minXP: 2700, tier: "GOLD", tierName: "Advanced" },
  { level: 16, minXP: 3000, tier: "EXCLUSIVE", tierName: "Elite" },
  { level: 17, minXP: 3400, tier: "EXCLUSIVE", tierName: "Elite" },
  { level: 18, minXP: 3800, tier: "EXCLUSIVE", tierName: "Elite" },
  { level: 19, minXP: 4200, tier: "EXCLUSIVE", tierName: "Elite" },
  { level: 20, minXP: 4600, tier: "EXCLUSIVE", tierName: "Elite" },
  { level: 21, minXP: 5000, tier: "CHAMPION", tierName: "Champion" },
];

// For levels beyond 21, each level is 500 XP apart
const CHAMPION_LEVEL_GAP = 500;
const MAX_DEFINED_LEVEL = 21;

/**
 * Calculate user level from total XP
 * @param {number} totalXP - User's total XP
 * @returns {number} - User's level (1-21+)
 */
function calculateLevel(totalXP) {
  if (totalXP < 0) return 1;

  // Handle levels beyond 21
  if (totalXP >= 5000) {
    const extraXP = totalXP - 5000;
    const extraLevels = Math.floor(extraXP / CHAMPION_LEVEL_GAP);
    return MAX_DEFINED_LEVEL + extraLevels;
  }

  // Find the highest level the user qualifies for
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalXP >= LEVEL_THRESHOLDS[i].minXP) {
      return LEVEL_THRESHOLDS[i].level;
    }
  }

  return 1;
}

/**
 * Get XP required for a specific level
 * @param {number} level - Target level
 * @returns {number} - Minimum XP required for that level
 */
function getXPForLevel(level) {
  if (level <= 0) return 0;
  if (level > MAX_DEFINED_LEVEL) {
    // Calculate XP for levels beyond 21
    const levelsAbove21 = level - MAX_DEFINED_LEVEL;
    return 5000 + levelsAbove21 * CHAMPION_LEVEL_GAP;
  }

  const threshold = LEVEL_THRESHOLDS.find((t) => t.level === level);
  return threshold ? threshold.minXP : 0;
}

/**
 * Get XP required to reach the next level
 * @param {number} currentLevel - User's current level
 * @returns {number} - XP needed for next level
 */
function getXPForNextLevel(currentLevel) {
  return getXPForLevel(currentLevel + 1);
}

/**
 * Get tier from level
 * @param {number} level - User's level
 * @returns {string} - Tier name ('BRONZE', 'SILVER', 'GOLD', 'EXCLUSIVE', 'CHAMPION')
 */
function getTierFromLevel(level) {
  if (level >= 21) return "CHAMPION";
  if (level >= 16) return "EXCLUSIVE";
  if (level >= 11) return "GOLD";
  if (level >= 6) return "SILVER";
  return "BRONZE";
}

/**
 * Get tier display name from level
 * @param {number} level - User's level
 * @returns {string} - Tier display name ('Beginner', 'Intermediate', etc.)
 */
function getTierNameFromLevel(level) {
  if (level >= 21) return "Champion";
  if (level >= 16) return "Elite";
  if (level >= 11) return "Advanced";
  if (level >= 6) return "Intermediate";
  return "Beginner";
}

/**
 * Get complete level progress info for a user
 * @param {number} totalXP - User's total XP
 * @returns {object} - Complete level info with progress
 */
function getLevelProgress(totalXP) {
  const currentLevel = calculateLevel(totalXP);
  const currentLevelXP = getXPForLevel(currentLevel);
  const nextLevelXP = getXPForNextLevel(currentLevel);
  const xpIntoLevel = totalXP - currentLevelXP;
  const xpNeededForNext = nextLevelXP - currentLevelXP;
  const progressPercent =
    xpNeededForNext > 0
      ? Math.min(100, Math.round((xpIntoLevel / xpNeededForNext) * 100))
      : 100;

  return {
    level: currentLevel,
    totalXP,
    currentLevelXP,
    nextLevelXP,
    xpIntoLevel,
    xpToNextLevel: nextLevelXP - totalXP,
    progressPercent,
    tier: getTierFromLevel(currentLevel),
    tierName: getTierNameFromLevel(currentLevel),
  };
}

/**
 * Check if XP change results in level up
 * @param {number} oldXP - Previous XP
 * @param {number} newXP - New XP after earning
 * @returns {object} - Level up info or null
 */
function checkLevelUp(oldXP, newXP) {
  const oldLevel = calculateLevel(oldXP);
  const newLevel = calculateLevel(newXP);

  if (newLevel > oldLevel) {
    const oldTier = getTierFromLevel(oldLevel);
    const newTier = getTierFromLevel(newLevel);

    return {
      leveledUp: true,
      oldLevel,
      newLevel,
      levelsGained: newLevel - oldLevel,
      tierChanged: oldTier !== newTier,
      oldTier,
      newTier,
      newTierName: getTierNameFromLevel(newLevel),
    };
  }

  return { leveledUp: false };
}

/**
 * Calculate streak multiplier bonus
 * Applies +10% XP bonus after 7-day streak
 * @param {number} streakDays - Current streak length
 * @returns {number} - Multiplier (1.0 or 1.1)
 */
function getStreakMultiplier(streakDays) {
  return streakDays >= 7 ? 1.1 : 1.0;
}

/**
 * Apply streak bonus to base XP
 * @param {number} baseXP - Base XP amount
 * @param {number} streakDays - Current streak length
 * @returns {number} - Final XP with bonus applied (rounded)
 */
function applyStreakBonus(baseXP, streakDays) {
  const multiplier = getStreakMultiplier(streakDays);
  return Math.round(baseXP * multiplier);
}

module.exports = {
  LEVEL_THRESHOLDS,
  calculateLevel,
  getXPForLevel,
  getXPForNextLevel,
  getTierFromLevel,
  getTierNameFromLevel,
  getLevelProgress,
  checkLevelUp,
  getStreakMultiplier,
  applyStreakBonus,
};
