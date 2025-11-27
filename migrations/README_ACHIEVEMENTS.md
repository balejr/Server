# Achievements System with FitPoints and Experience Points

This document describes the comprehensive Achievements system with dual leveling systems: FitPoints (FP) and Experience Points (XP).

## Overview

The system includes:
- **FitPoints (FP)**: Available to all users, with 5 tiers
- **Experience Points (XP)**: Locked until user reaches Gold tier (1000+ FP) in FitPoints
- **Achievements**: Tasks that award FP or XP when completed
- **Tier Systems**: Automatic tier calculation based on total points

## Database Tables

### Achievements Table
Stores achievement definitions (templates) that can be earned by users.

**Columns:**
- `AchievementID` (INT, Primary Key) - Unique identifier
- `Title` (NVARCHAR(255)) - Achievement name
- `Description` (NVARCHAR(MAX)) - Optional description
- `Category` (NVARCHAR(50)) - 'Daily', 'Weekly', 'Monthly', or 'Universal'
- `Type` (NVARCHAR(50)) - 'progress' or 'milestone'
- `GoalValue` (INT) - Target value for progress achievements
- `RewardType` (NVARCHAR(10)) - 'FP' (FitPoints) or 'XP' (Experience Points)
- `RewardAmount` (INT) - Amount of FP or XP awarded
- `Icon` (NVARCHAR(255)) - Icon name or URL
- `IsActive` (BIT) - Whether the achievement is active
- `CreatedDate` (DATETIME2) - Creation timestamp
- `LastModified` (DATETIME2) - Last modification timestamp

### UserAchievements Table
Tracks user progress and completed achievements.

**Columns:**
- `UserAchievementID` (INT, Primary Key) - Unique identifier
- `UserID` (INT, Foreign Key) - References UserProfile.UserID
- `AchievementID` (INT, Foreign Key) - References Achievements.AchievementID
- `CurrentValue` (INT) - Current progress value
- `IsCompleted` (BIT) - Whether achievement is completed
- `CompletedDate` (DATETIME2) - When achievement was completed
- `PointsAwarded` (BIT) - Whether points have been awarded (prevents duplicate awards)
- `CreatedDate` (DATETIME2) - Creation timestamp
- `LastModified` (DATETIME2) - Last modification timestamp

### UserPoints Table
Tracks user's total FitPoints and Experience Points, and their current tiers.

**Columns:**
- `UserPointsID` (INT, Primary Key) - Unique identifier
- `UserID` (INT, Foreign Key, Unique) - References UserProfile.UserID
- `FitPoints` (INT) - Total FitPoints earned
- `ExperiencePoints` (INT) - Total Experience Points earned
- `FitPointsTier` (NVARCHAR(50)) - Current FP tier: 'Stone', 'Bronze', 'Silver', 'Gold', 'Exclusive'
- `ExperiencePointsTier` (NVARCHAR(50)) - Current XP tier: 'Beginner', 'Intermediate', 'Advanced', 'Elite', 'Champion' (NULL until Gold FP tier)
- `LastModified` (DATETIME2) - Last modification timestamp

## Tier Systems

### FitPoints Tier System
- **Stone**: 0-99 FP
- **Bronze**: 100-499 FP
- **Silver**: 500-999 FP
- **Gold**: 1000-1999 FP
- **Exclusive**: 2000+ FP

### Experience Points Tier System
- **Beginner**: 0-500 XP
- **Intermediate**: 501-1500 XP
- **Advanced**: 1501-3000 XP
- **Elite**: 3001-5000 XP
- **Champion**: 5001+ XP

**Important**: XP system is locked until user reaches Gold tier (1000+ FP) in FitPoints. XP achievements are hidden from users who haven't reached Gold tier.

## FitPoint Achievements

### Daily Achievements
- **Daily Check-in**: 5 FP
- **30 Minutes of Exercise**: 10 FP
- **Reach Step Goal**: 10 FP
- **Log Meals**: 10 FP
- **Log Water Intake**: 10 FP
- **Share Workout**: 10 FP

### Weekly Achievements
- **Weekly Workout Streak** (5+ days): 25 FP

### Universal Achievements
- **Complete Workout Challenge**: 50 FP
- **Refer a Friend**: 100 FP

## Experience Point Achievements

### Daily Achievements
- **Daily Sign-In**: 10 XP
- **Log Water Intake**: 5 XP
- **Log Sleep**: 5 XP
- **Hit Daily Step Goal**: 20 XP

### Weekly Achievements
- **Hit Weekly Workout Goal**: 100 XP

### Universal Achievements
- **Complete a Workout**: 50 XP
- **Complete a Custom Routine**: 75 XP
- **Complete Form/Technique AI Review**: 25 XP
- **Achieve Personal Record**: 50 XP
- **Complete Weekly Challenge**: 150 XP
- **Complete Monthly Challenge**: 150 XP
- **Invite a Friend**: 100 XP
- **Refer a Friend** (who signs up): 250 XP

## API Endpoints

### GET `/api/data/achievements/progress`
Get progress achievements for a specific period (Daily, Weekly, Monthly).

**Query Parameters:**
- `period` (optional): 'Daily', 'Weekly', 'Monthly' (default: 'Daily')

**Response:**
```json
{
  "userId": 1,
  "period": "Daily",
  "achievements": [
    {
      "id": 1,
      "title": "Daily Check-in",
      "progress": 0,
      "goal": 1,
      "icon": "calendar-outline",
      "completed": false,
      "rewardType": "FP",
      "rewardAmount": 5
    }
  ]
}
```

**Note**: XP achievements are only returned if user has reached Gold FP tier (1000+ FP).

### GET `/api/data/achievements/completed`
Get completed achievements with optional search filter.

**Query Parameters:**
- `search` (optional): Search term for achievement titles

**Response:**
```json
{
  "userId": 1,
  "search": "",
  "completed": [
    {
      "id": 1,
      "title": "Daily Check-in",
      "date": "2024-01-15T10:30:00Z",
      "icon": "calendar-outline",
      "rewardType": "FP",
      "rewardAmount": 5
    }
  ]
}
```

### POST `/api/data/achievements/progress`
Create or update user achievement progress. Automatically awards points when achievement is completed.

**Request Body:**
```json
{
  "achievementId": 1,
  "currentValue": 1
}
```

**Response:**
```json
{
  "success": true,
  "message": "Achievement progress updated successfully",
  "completed": true,
  "pointsAwarded": true,
  "rewardType": "FP",
  "rewardAmount": 5,
  "userPoints": {
    "fitPoints": 105,
    "experiencePoints": 0,
    "fitPointsTier": "Bronze",
    "experiencePointsTier": null,
    "canEarnXP": false
  }
}
```

**Behavior:**
- Points are only awarded once per achievement completion
- XP points are only awarded if user has reached Gold FP tier (1000+ FP)
- Tiers are automatically recalculated after points are awarded

### DELETE `/api/data/achievements/progress/:id`
Remove user's progress tracking for a specific achievement.

**URL Parameters:**
- `id`: Achievement ID

**Query Parameters:**
- `period` (optional): Category filter (default: 'Daily')

**Response:**
```json
{
  "success": true,
  "message": "Achievement progress deleted successfully"
}
```

**Note**: This does NOT remove points that were already awarded. It only removes progress tracking.

### GET `/api/data/achievements/points`
Get user's current points and tiers.

**Response:**
```json
{
  "fitPoints": 1050,
  "experiencePoints": 50,
  "fitPointsTier": "Gold",
  "experiencePointsTier": "Beginner",
  "canEarnXP": true
}
```

### GET `/api/data/achievements/all`
Get all available achievements (optionally filtered by category).

**Query Parameters:**
- `category` (optional): 'Daily', 'Weekly', 'Monthly', 'Universal'

**Response:**
```json
{
  "userId": 1,
  "achievements": [
    {
      "id": 1,
      "title": "Daily Check-in",
      "description": "Check in to the app every day",
      "category": "Daily",
      "type": "milestone",
      "goalValue": 1,
      "rewardType": "FP",
      "rewardAmount": 5,
      "icon": "calendar-outline",
      "completed": false,
      "currentValue": 0
    }
  ],
  "canEarnXP": true
}
```

**Note**: XP achievements are only returned if user has reached Gold FP tier (1000+ FP).

## Point Award Logic

1. When an achievement is completed (`currentValue >= goalValue`):
   - Check if points have already been awarded (`PointsAwarded` flag)
   - If not awarded:
     - Award FP if `RewardType = 'FP'`
     - Award XP if `RewardType = 'XP'` AND user has Gold+ FP tier (1000+ FP)
     - Set `PointsAwarded = 1`
     - Update user's total points
     - Recalculate tiers automatically

2. Points are never removed when progress is deleted (only progress tracking is removed)

3. XP achievements are hidden from users who haven't reached Gold FP tier

## Usage Examples

### Awarding points when user completes a daily check-in:
```javascript
POST /api/data/achievements/progress
{
  "achievementId": 1, // Daily Check-in
  "currentValue": 1
}
```

### Checking user's current tier:
```javascript
GET /api/data/achievements/points
```

### Getting all available achievements:
```javascript
GET /api/data/achievements/all?category=Daily
```

## Migration Instructions

1. Run the SQL migration script:
   ```sql
   -- Execute: migrations/create_achievements_tables.sql
   ```

2. The script will:
   - Create the three tables (Achievements, UserAchievements, UserPoints)
   - Create indexes for performance
   - Insert all default achievements (FP and XP)

3. UserPoints records are created automatically when users first interact with achievements

## Notes

- All endpoints require authentication (`authenticateToken` middleware)
- Points are awarded automatically when achievements are completed
- Tiers are calculated automatically based on total points
- XP system unlocks automatically when user reaches Gold FP tier
- Duplicate point awards are prevented by the `PointsAwarded` flag

