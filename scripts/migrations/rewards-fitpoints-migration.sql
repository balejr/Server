-- ============================================
-- Rewards System Overhaul: XP → FitPoints Migration
-- Run this script against the ApogeeFit database
-- ============================================

-- 1. Rename TotalXP to TotalFitPoints in UserRewards table
-- Check if column exists and rename it
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserRewards') AND name = 'TotalXP')
BEGIN
    EXEC sp_rename 'dbo.UserRewards.TotalXP', 'TotalFitPoints', 'COLUMN';
    PRINT 'Renamed TotalXP to TotalFitPoints in UserRewards table';
END
ELSE
BEGIN
    PRINT 'TotalXP column does not exist or already renamed';
END
GO

-- 2. Create ChallengeFeedback table for storing user feedback on deleted challenges
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ChallengeFeedback]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ChallengeFeedback] (
        FeedbackID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        ChallengeID INT NOT NULL,
        FeedbackType NVARCHAR(50) NOT NULL,  -- 'too_hard', 'too_easy', 'not_relevant', 'takes_too_long', 'already_doing'
        FeedbackText NVARCHAR(500) NULL,
        DifficultyAtDeletion NVARCHAR(20) NULL,  -- 'Easy', 'Medium', 'Hard'
        UserTierAtDeletion NVARCHAR(20) NULL,  -- 'BRONZE', 'SILVER', etc.
        CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),

        CONSTRAINT FK_ChallengeFeedback_User FOREIGN KEY (UserID) REFERENCES dbo.UserProfile(UserID)
    );

    -- Create index for querying feedback patterns
    CREATE INDEX IX_ChallengeFeedback_UserID ON [dbo].[ChallengeFeedback](UserID);
    CREATE INDEX IX_ChallengeFeedback_FeedbackType ON [dbo].[ChallengeFeedback](FeedbackType);

    PRINT 'Created ChallengeFeedback table';
END
ELSE
BEGIN
    PRINT 'ChallengeFeedback table already exists';
END
GO

-- 3. Create GeneratedChallenges table for AI-generated challenges
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[GeneratedChallenges]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[GeneratedChallenges] (
        GeneratedChallengeID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        ChallengeTitle NVARCHAR(200) NOT NULL,
        ChallengeDescription NVARCHAR(500) NOT NULL,
        FitPointsValue INT NOT NULL DEFAULT 25,
        Category NVARCHAR(20) NOT NULL,  -- 'daily', 'weekly', 'monthly', 'universal'
        Difficulty NVARCHAR(20) NOT NULL,  -- 'Easy', 'Medium', 'Hard'
        RequiredCount INT DEFAULT 1,
        CurrentProgress INT DEFAULT 0,
        ExpiresAt DATETIMEOFFSET NULL,
        IsActive BIT DEFAULT 1,
        IsCompleted BIT DEFAULT 0,
        IsDeleted BIT DEFAULT 0,
        CompletedAt DATETIMEOFFSET NULL,
        CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),

        CONSTRAINT FK_GeneratedChallenges_User FOREIGN KEY (UserID) REFERENCES dbo.UserProfile(UserID)
    );

    -- Create indexes for efficient querying
    CREATE INDEX IX_GeneratedChallenges_UserID ON [dbo].[GeneratedChallenges](UserID);
    CREATE INDEX IX_GeneratedChallenges_Category ON [dbo].[GeneratedChallenges](Category);
    CREATE INDEX IX_GeneratedChallenges_Active ON [dbo].[GeneratedChallenges](UserID, IsActive, IsDeleted);

    PRINT 'Created GeneratedChallenges table';
END
ELSE
BEGIN
    PRINT 'GeneratedChallenges table already exists';
END
GO

-- 4. Add index for better performance on UserRewards queries
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_UserRewards_TotalFitPoints' AND object_id = OBJECT_ID('dbo.UserRewards'))
BEGIN
    -- Check if column exists before creating index
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserRewards') AND name = 'TotalFitPoints')
    BEGIN
        CREATE INDEX IX_UserRewards_TotalFitPoints ON [dbo].[UserRewards](TotalFitPoints);
        PRINT 'Created index IX_UserRewards_TotalFitPoints';
    END
END
GO

-- 5. Verify the migration
PRINT '--- Migration Verification ---';

-- Check UserRewards columns
SELECT
    c.name AS ColumnName,
    t.name AS DataType
FROM sys.columns c
INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.UserRewards')
ORDER BY c.column_id;

-- Check ChallengeFeedback exists
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ChallengeFeedback]'))
    PRINT 'ChallengeFeedback table: EXISTS';
ELSE
    PRINT 'ChallengeFeedback table: MISSING';

-- Check GeneratedChallenges exists
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[GeneratedChallenges]'))
    PRINT 'GeneratedChallenges table: EXISTS';
ELSE
    PRINT 'GeneratedChallenges table: MISSING';

PRINT '--- Migration Complete ---';
GO
