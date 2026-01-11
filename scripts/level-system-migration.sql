-- ============================================
-- LEVEL SYSTEM MIGRATION
-- Adds level tracking, personal records, sign-in tracking, and streaks
-- Safe to run multiple times (uses IF NOT EXISTS checks)
-- ============================================

PRINT 'Starting Level System Migration...';
PRINT '';

-- ============================================
-- 1. ADD LEVEL COLUMNS TO UserRewards
-- ============================================

-- Add CurrentLevel column if not exists
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserRewards') AND name = 'CurrentLevel')
BEGIN
    ALTER TABLE dbo.UserRewards ADD CurrentLevel INT DEFAULT 1;
    PRINT 'Added CurrentLevel column to UserRewards';
END
ELSE
    PRINT 'CurrentLevel column already exists';

-- Add LevelUpAt column if not exists
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserRewards') AND name = 'LevelUpAt')
BEGIN
    ALTER TABLE dbo.UserRewards ADD LevelUpAt DATETIMEOFFSET NULL;
    PRINT 'Added LevelUpAt column to UserRewards';
END
ELSE
    PRINT 'LevelUpAt column already exists';

-- Update existing records to calculate current level based on XP
UPDATE dbo.UserRewards
SET CurrentLevel =
    CASE
        WHEN TotalXP >= 5000 THEN 21  -- Champion
        WHEN TotalXP >= 4600 THEN 20
        WHEN TotalXP >= 4200 THEN 19
        WHEN TotalXP >= 3800 THEN 18
        WHEN TotalXP >= 3400 THEN 17
        WHEN TotalXP >= 3000 THEN 16  -- Elite
        WHEN TotalXP >= 2700 THEN 15
        WHEN TotalXP >= 2400 THEN 14
        WHEN TotalXP >= 2100 THEN 13
        WHEN TotalXP >= 1800 THEN 12
        WHEN TotalXP >= 1500 THEN 11  -- Advanced
        WHEN TotalXP >= 1300 THEN 10
        WHEN TotalXP >= 1100 THEN 9
        WHEN TotalXP >= 900 THEN 8
        WHEN TotalXP >= 700 THEN 7
        WHEN TotalXP >= 500 THEN 6   -- Intermediate
        WHEN TotalXP >= 400 THEN 5
        WHEN TotalXP >= 300 THEN 4
        WHEN TotalXP >= 200 THEN 3
        WHEN TotalXP >= 100 THEN 2
        ELSE 1  -- Beginner
    END
WHERE CurrentLevel IS NULL OR CurrentLevel = 0;
PRINT 'Updated existing users with calculated levels';

-- ============================================
-- 2. UPDATE CurrentTier CONSTRAINT (add CHAMPION)
-- ============================================

-- Drop old constraint if exists and add new one with CHAMPION
IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_UserTier')
BEGIN
    ALTER TABLE dbo.UserRewards DROP CONSTRAINT CK_UserTier;
    PRINT 'Dropped old CK_UserTier constraint';
END

ALTER TABLE dbo.UserRewards ADD CONSTRAINT CK_UserTier
    CHECK (CurrentTier IN ('BRONZE', 'SILVER', 'GOLD', 'EXCLUSIVE', 'CHAMPION'));
PRINT 'Added updated CK_UserTier constraint with CHAMPION tier';

-- ============================================
-- 3. PERSONAL RECORDS TABLE
-- ============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PersonalRecords')
BEGIN
    CREATE TABLE dbo.PersonalRecords (
        RecordID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        ExerciseID NVARCHAR(100) NOT NULL,
        ExerciseName NVARCHAR(255) NOT NULL,
        RecordType NVARCHAR(20) DEFAULT 'weight', -- 'weight', 'reps', 'volume'
        RecordValue DECIMAL(10,2) NOT NULL,
        PreviousValue DECIMAL(10,2) NULL,
        SetAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        ExerciseExistenceID INT NULL,

        CONSTRAINT FK_PersonalRecords_User
            FOREIGN KEY (UserID) REFERENCES dbo.UserProfile(UserID)
    );

    CREATE INDEX IX_PersonalRecords_UserExercise ON dbo.PersonalRecords(UserID, ExerciseID);
    CREATE INDEX IX_PersonalRecords_SetAt ON dbo.PersonalRecords(UserID, SetAt);
    PRINT 'Created PersonalRecords table';
END
ELSE
    PRINT 'PersonalRecords table already exists';

-- ============================================
-- 4. DAILY SIGN-IN TABLE
-- ============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DailySignIn')
BEGIN
    CREATE TABLE dbo.DailySignIn (
        SignInID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        SignInDate DATE NOT NULL,
        XPAwarded BIT DEFAULT 0,
        SignInAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),

        CONSTRAINT FK_DailySignIn_User
            FOREIGN KEY (UserID) REFERENCES dbo.UserProfile(UserID),
        CONSTRAINT UQ_DailySignIn_UserDate UNIQUE (UserID, SignInDate)
    );

    CREATE INDEX IX_DailySignIn_UserDate ON dbo.DailySignIn(UserID, SignInDate);
    PRINT 'Created DailySignIn table';
END
ELSE
    PRINT 'DailySignIn table already exists';

-- ============================================
-- 5. USER STREAKS TABLE
-- ============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserStreaks')
BEGIN
    CREATE TABLE dbo.UserStreaks (
        StreakID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        StreakType NVARCHAR(30) NOT NULL, -- 'workout', 'login', 'water', 'sleep'
        CurrentStreak INT DEFAULT 0,
        LongestStreak INT DEFAULT 0,
        LastActivityDate DATE NULL,

        CONSTRAINT FK_UserStreaks_User
            FOREIGN KEY (UserID) REFERENCES dbo.UserProfile(UserID),
        CONSTRAINT UQ_UserStreaks_Type UNIQUE (UserID, StreakType)
    );

    CREATE INDEX IX_UserStreaks_User ON dbo.UserStreaks(UserID);
    PRINT 'Created UserStreaks table';
END
ELSE
    PRINT 'UserStreaks table already exists';

-- ============================================
-- 6. DAILY XP AWARDS TABLE (prevent double awards)
-- ============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DailyXPAwards')
BEGIN
    CREATE TABLE dbo.DailyXPAwards (
        AwardID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        AwardType NVARCHAR(50) NOT NULL, -- 'water_log', 'sleep_log', 'step_goal', 'daily_combo', etc.
        AwardDate DATE NOT NULL,
        XPAwarded INT NOT NULL,
        AwardedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),

        CONSTRAINT FK_DailyXPAwards_User
            FOREIGN KEY (UserID) REFERENCES dbo.UserProfile(UserID),
        CONSTRAINT UQ_DailyXP_UserTypeDate UNIQUE (UserID, AwardType, AwardDate)
    );

    CREATE INDEX IX_DailyXPAwards_UserDate ON dbo.DailyXPAwards(UserID, AwardDate);
    PRINT 'Created DailyXPAwards table';
END
ELSE
    PRINT 'DailyXPAwards table already exists';

-- ============================================
-- 7. INSERT BADGE DEFINITIONS INTO Achievements TABLE
-- ============================================

-- Insert badge achievements if they don't exist
IF NOT EXISTS (SELECT * FROM dbo.Achievements WHERE Title = 'Consistency King')
BEGIN
    INSERT INTO dbo.Achievements (Title, Description, Category, Type, GoalValue, Icon, IsActive) VALUES
    ('Consistency King', '30-day workout streak', 'consistency', 'streak', 30, 'crown', 1),
    ('Hydration Hero', '7 consecutive water logging days', 'health', 'streak', 7, 'water', 1),
    ('Sleep Master', '20% sleep score improvement over 1 week', 'health', 'improvement', 20, 'moon', 1),
    ('Step Slayer', '100,000 steps in one week', 'fitness', 'cumulative', 100000, 'footsteps', 1),
    ('Record Breaker', '5 personal records in one month', 'records', 'cumulative', 5, 'trophy', 1);
    PRINT 'Inserted badge achievements';
END
ELSE
    PRINT 'Badge achievements already exist';

-- ============================================
-- 8. ADD AI TRAINER WEEKLY REWARD (if not exists)
-- ============================================

IF NOT EXISTS (SELECT * FROM dbo.RewardDefinitions WHERE RewardKey = 'ai_trainer_weekly')
BEGIN
    INSERT INTO dbo.RewardDefinitions (RewardKey, Category, Name, Description, XPValue, RequiredCount, IsActive)
    VALUES ('ai_trainer_weekly', 'weekly', 'AI Trainer Task', 'Use AI assistant 5 times this week', 50, 5, 1);
    PRINT 'Inserted ai_trainer_weekly reward definition';
END
ELSE
    PRINT 'ai_trainer_weekly reward already exists';

-- ============================================
-- VERIFICATION
-- ============================================

PRINT '';
PRINT '===========================================';
PRINT 'Level System Migration Complete!';
PRINT '===========================================';
PRINT '';
PRINT 'Changes made:';
PRINT '  - Added CurrentLevel, LevelUpAt columns to UserRewards';
PRINT '  - Updated CK_UserTier constraint to include CHAMPION';
PRINT '  - Created PersonalRecords table';
PRINT '  - Created DailySignIn table';
PRINT '  - Created UserStreaks table';
PRINT '  - Created DailyXPAwards table';
PRINT '  - Inserted badge achievements';
PRINT '  - Inserted ai_trainer_weekly reward';
PRINT '';
PRINT 'Level Thresholds:';
PRINT '  Level 1-5 (Beginner/BRONZE): 0-400 XP (100 XP gaps)';
PRINT '  Level 6-10 (Intermediate/SILVER): 500-1300 XP (200 XP gaps)';
PRINT '  Level 11-15 (Advanced/GOLD): 1500-2700 XP (300 XP gaps)';
PRINT '  Level 16-20 (Elite/EXCLUSIVE): 3000-4600 XP (400 XP gaps)';
PRINT '  Level 21+ (Champion/CHAMPION): 5000+ XP (500+ XP gaps)';
