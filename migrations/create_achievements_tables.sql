-- ============================================
-- Achievements System Migration
-- ============================================
-- This script creates the Achievements, UserAchievements, and UserPoints tables
-- Run this script on your SQL Server database

-- ============================================
-- Table: Achievements
-- ============================================
-- Stores achievement definitions (templates)
CREATE TABLE dbo.Achievements (
    AchievementID INT IDENTITY(1,1) PRIMARY KEY,
    Title NVARCHAR(255) NOT NULL,
    Description NVARCHAR(MAX) NULL,
    Category NVARCHAR(50) NOT NULL, -- 'Daily', 'Weekly', 'Monthly', 'Universal'
    Type NVARCHAR(50) NOT NULL, -- 'progress', 'milestone', 'level'
    GoalValue INT NULL, -- Target value for progress achievements (e.g., 1 for daily check-in, 10000 for steps)
    RewardType NVARCHAR(10) NOT NULL, -- 'FP' (FitPoints) or 'XP' (Experience Points)
    RewardAmount INT NOT NULL DEFAULT 0, -- Amount of FP or XP awarded
    Icon NVARCHAR(255) NULL, -- Icon name or URL
    IsActive BIT DEFAULT 1,
    CreatedDate DATETIME2 DEFAULT GETDATE(),
    LastModified DATETIME2 DEFAULT GETDATE()
);

-- ============================================
-- Table: UserAchievements
-- ============================================
-- Tracks user progress and completed achievements
CREATE TABLE dbo.UserAchievements (
    UserAchievementID INT IDENTITY(1,1) PRIMARY KEY,
    UserID INT NOT NULL,
    AchievementID INT NOT NULL,
    CurrentValue INT DEFAULT 0, -- Current progress value
    IsCompleted BIT DEFAULT 0,
    CompletedDate DATETIME2 NULL,
    PointsAwarded BIT DEFAULT 0, -- Whether points have been awarded for this completion
    CreatedDate DATETIME2 DEFAULT GETDATE(),
    LastModified DATETIME2 DEFAULT GETDATE(),

    -- Foreign Keys
    CONSTRAINT FK_UserAchievements_UserID FOREIGN KEY (UserID)
        REFERENCES dbo.UserProfile(UserID) ON DELETE CASCADE,
    CONSTRAINT FK_UserAchievements_AchievementID FOREIGN KEY (AchievementID)
        REFERENCES dbo.Achievements(AchievementID) ON DELETE CASCADE,

    -- Unique constraint: one achievement per user
    CONSTRAINT UQ_UserAchievements_User_Achievement UNIQUE (UserID, AchievementID)
);

-- ============================================
-- Table: UserPoints
-- ============================================
-- Tracks user's FitPoints and Experience Points totals
CREATE TABLE dbo.UserPoints (
    UserPointsID INT IDENTITY(1,1) PRIMARY KEY,
    UserID INT NOT NULL UNIQUE,
    FitPoints INT DEFAULT 0,
    ExperiencePoints INT DEFAULT 0,
    FitPointsTier NVARCHAR(50) DEFAULT 'Stone', -- Stone, Bronze, Silver, Gold, Exclusive
    ExperiencePointsTier NVARCHAR(50) NULL, -- Beginner, Intermediate, Advanced, Elite, Champion (NULL until Gold FP tier)
    LastModified DATETIME2 DEFAULT GETDATE(),

    -- Foreign Key
    CONSTRAINT FK_UserPoints_UserID FOREIGN KEY (UserID)
        REFERENCES dbo.UserProfile(UserID) ON DELETE CASCADE
);

-- ============================================
-- Indexes for Performance
-- ============================================
CREATE INDEX IX_UserAchievements_UserID ON dbo.UserAchievements(UserID);
CREATE INDEX IX_UserAchievements_AchievementID ON dbo.UserAchievements(AchievementID);
CREATE INDEX IX_UserAchievements_IsCompleted ON dbo.UserAchievements(IsCompleted);
CREATE INDEX IX_Achievements_Category ON dbo.Achievements(Category);
CREATE INDEX IX_Achievements_RewardType ON dbo.Achievements(RewardType);
CREATE INDEX IX_Achievements_IsActive ON dbo.Achievements(IsActive);
CREATE INDEX IX_UserPoints_UserID ON dbo.UserPoints(UserID);

-- ============================================
-- FitPoint Achievements
-- ============================================
INSERT INTO dbo.Achievements (Title, Description, Category, Type, GoalValue, RewardType, RewardAmount, Icon) VALUES
-- Daily FitPoint Achievements
('Daily Check-in', 'Check in to the app every day', 'Daily', 'milestone', 1, 'FP', 5, 'calendar-outline'),
('30 Minutes of Exercise', 'Complete 30 minutes of exercise', 'Daily', 'milestone', 1, 'FP', 10, 'time-outline'),
('Reach Step Goal', 'Reach your daily step goal (e.g., 10,000 steps)', 'Daily', 'milestone', 1, 'FP', 10, 'walk-outline'),
('Log Meals', 'Log your meals for the day', 'Daily', 'milestone', 1, 'FP', 10, 'restaurant-outline'),
('Log Water Intake', 'Log your water intake for the day', 'Daily', 'milestone', 1, 'FP', 10, 'water-outline'),
('Share Workout', 'Share a workout on social media', 'Daily', 'milestone', 1, 'FP', 10, 'share-social-outline'),

-- Weekly FitPoint Achievements
('Weekly Workout Streak', 'Complete workouts 5+ days in a week', 'Weekly', 'milestone', 5, 'FP', 25, 'flame-outline'),

-- Universal FitPoint Achievements
('Complete Workout Challenge', 'Complete a workout challenge', 'Universal', 'milestone', 1, 'FP', 50, 'trophy-outline'),
('Refer a Friend', 'Refer a friend to join the app', 'Universal', 'milestone', 1, 'FP', 100, 'people-outline');

-- ============================================
-- Experience Point Achievements
-- ============================================
INSERT INTO dbo.Achievements (Title, Description, Category, Type, GoalValue, RewardType, RewardAmount, Icon) VALUES
-- Daily XP Achievements
('Daily Sign-In', 'Sign in to the app every day', 'Daily', 'milestone', 1, 'XP', 10, 'log-in-outline'),
('Log Water Intake', 'Log your water intake', 'Daily', 'milestone', 1, 'XP', 5, 'water-outline'),
('Log Sleep', 'Log your sleep data', 'Daily', 'milestone', 1, 'XP', 5, 'moon-outline'),
('Hit Daily Step Goal', 'Hit your daily step goal', 'Daily', 'milestone', 1, 'XP', 20, 'footsteps-outline'),

-- Weekly XP Achievements
('Hit Weekly Workout Goal', 'Complete your weekly workout goal', 'Weekly', 'milestone', 1, 'XP', 100, 'fitness-outline'),

-- Universal XP Achievements
('Complete a Workout', 'Complete any workout', 'Universal', 'milestone', 1, 'XP', 50, 'barbell-outline'),
('Complete a Custom Routine', 'Complete a custom workout routine', 'Universal', 'milestone', 1, 'XP', 75, 'create-outline'),
('Complete Form/Technique AI Review', 'Complete an AI review of your form or technique', 'Universal', 'milestone', 1, 'XP', 25, 'scan-outline'),
('Achieve Personal Record', 'Achieve a personal record (weight/time)', 'Universal', 'milestone', 1, 'XP', 50, 'trophy-outline'),
('Complete Weekly Challenge', 'Complete a weekly challenge', 'Universal', 'milestone', 1, 'XP', 150, 'calendar-outline'),
('Complete Monthly Challenge', 'Complete a monthly challenge', 'Universal', 'milestone', 1, 'XP', 150, 'calendar-outline'),
('Invite a Friend', 'Invite a friend to join', 'Universal', 'milestone', 1, 'XP', 100, 'person-add-outline'),
('Refer a Friend', 'Refer a friend who signs up', 'Universal', 'milestone', 1, 'XP', 250, 'people-outline');

-- ============================================
-- Notes
-- ============================================
-- 1. FitPoints (FP) Tier System:
--    - Stone: 0-99 FP
--    - Bronze: 100-499 FP
--    - Silver: 500-999 FP
--    - Gold: 1000-1999 FP
--    - Exclusive: 2000+ FP
--
-- 2. Experience Points (XP) Tier System:
--    - Beginner: 0-500 XP
--    - Intermediate: 501-1500 XP
--    - Advanced: 1501-3000 XP
--    - Elite: 3001-5000 XP
--    - Champion: 5001+ XP
--
-- 3. XP system is LOCKED until user reaches Gold tier (1000+ FP) in FitPoints
--
-- 4. When an achievement is completed:
--    - Points are awarded based on RewardType and RewardAmount
--    - PointsAwarded flag prevents duplicate point awards
--    - Tier is automatically recalculated based on total points
--
-- 5. Category can be: 'Daily', 'Weekly', 'Monthly', 'Universal'
-- 6. Type can be: 'progress' (tracked over time) or 'milestone' (one-time completion)

