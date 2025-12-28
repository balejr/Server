-- ============================================================
-- FitNext Pre-Assessment & AI Feature Database Migration
-- ============================================================
-- This script ensures all required tables exist for the 
-- pre-assessment and AI chatbot features.
-- 
-- SAFE TO RUN: Uses IF NOT EXISTS checks for all operations.
-- 
-- Last updated: December 27, 2025
-- ============================================================

-- ============================================
-- 1. PreWorkoutAssessment Table
-- Stores pre-workout readiness assessments
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PreWorkoutAssessment')
BEGIN
    CREATE TABLE PreWorkoutAssessment (
        AssessmentID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        WorkoutPlanID NVARCHAR(100) NULL,
        Feeling NVARCHAR(20) NULL,         -- Good, Average, Bad, Unsure
        WaterIntake NVARCHAR(20) NULL,     -- <50oz, 50-70oz, 70-90oz, 90oz+
        SleepQuality INT NULL,             -- 0-4 scale
        SleepHours NVARCHAR(20) NULL,      -- <6, 6-7, 7-8, 8-9, 9+
        RecoveryStatus NVARCHAR(20) NULL,  -- Not Recovered, Sore, Well-Recovered
        CreatedAt DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_PreWorkoutAssessment_User FOREIGN KEY (UserID) 
            REFERENCES UserProfile(UserID)
    );
    PRINT '✅ Created PreWorkoutAssessment table';
END
ELSE
BEGIN
    PRINT '⚠️ PreWorkoutAssessment table already exists';
END
GO

-- ============================================
-- 2. Ensure UserProfile has onboarding columns
-- These columns support the onboarding flow
-- ============================================

-- DOB (Date of Birth)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserProfile') AND name = 'DOB')
BEGIN
    ALTER TABLE dbo.UserProfile ADD DOB DATE NULL;
    PRINT '✅ Added DOB column to UserProfile';
END
GO

-- HeightUnit (cm or ft)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserProfile') AND name = 'HeightUnit')
BEGIN
    ALTER TABLE dbo.UserProfile ADD HeightUnit NVARCHAR(10) NULL;
    PRINT '✅ Added HeightUnit column to UserProfile';
END
GO

-- WeightUnit (kg or lbs)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserProfile') AND name = 'WeightUnit')
BEGIN
    ALTER TABLE dbo.UserProfile ADD WeightUnit NVARCHAR(10) NULL;
    PRINT '✅ Added WeightUnit column to UserProfile';
END
GO

-- Goals (comma-separated fitness goals)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserProfile') AND name = 'Goals')
BEGIN
    ALTER TABLE dbo.UserProfile ADD Goals NVARCHAR(MAX) NULL;
    PRINT '✅ Added Goals column to UserProfile';
END
GO

-- UserType (free or premium)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserProfile') AND name = 'UserType')
BEGIN
    ALTER TABLE dbo.UserProfile ADD UserType NVARCHAR(20) NOT NULL DEFAULT 'free';
    PRINT '✅ Added UserType column to UserProfile';
END
GO

-- ============================================
-- 3. AIWorkoutPlans Table
-- Stores AI-generated workout plans
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AIWorkoutPlans')
BEGIN
    CREATE TABLE AIWorkoutPlans (
        PlanID NVARCHAR(50) PRIMARY KEY,
        UserID INT NOT NULL,
        ChatSessionID NVARCHAR(50) NULL,
        PlanData NVARCHAR(MAX) NOT NULL,   -- JSON array of workout days
        Summary NVARCHAR(500) NULL,
        Goal NVARCHAR(100) NULL,
        DaysPerWeek INT NULL,
        DurationWeeks INT NULL,
        Split NVARCHAR(100) NULL,
        Status NVARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft, saved, completed, archived
        CreatedDate DATETIME2 NOT NULL DEFAULT GETDATE(),
        LastModified DATETIME2 NOT NULL DEFAULT GETDATE(),
        IsActive BIT NOT NULL DEFAULT 1,
        PlanName NVARCHAR(255) NULL,
        CONSTRAINT FK_AIWorkoutPlans_User FOREIGN KEY (UserID) 
            REFERENCES UserProfile(UserID),
        CONSTRAINT FK_AIWorkoutPlans_Session FOREIGN KEY (ChatSessionID) 
            REFERENCES ChatbotSession(chatSessionID)
    );
    PRINT '✅ Created AIWorkoutPlans table';
END
ELSE
BEGIN
    PRINT '⚠️ AIWorkoutPlans table already exists';
END
GO

-- ============================================
-- 4. ChatbotSession Table
-- Manages AI chat sessions
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ChatbotSession')
BEGIN
    CREATE TABLE ChatbotSession (
        chatSessionID NVARCHAR(50) PRIMARY KEY,
        UserId INT NOT NULL,
        ChatSessionStart_date DATETIME2 NOT NULL DEFAULT GETDATE(),
        ChatSessionEnd_date DATETIME2 NULL,
        InquiryCount INT NOT NULL DEFAULT 0,
        WorkoutCount INT NOT NULL DEFAULT 0,
        SessionType NVARCHAR(20) NOT NULL DEFAULT 'inquiry',  -- inquiry, workout_plan
        IsActive BIT NOT NULL DEFAULT 1,
        LastActivity DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_ChatbotSession_User FOREIGN KEY (UserId) 
            REFERENCES UserProfile(UserID)
    );
    PRINT '✅ Created ChatbotSession table';
END
ELSE
BEGIN
    PRINT '⚠️ ChatbotSession table already exists';
END
GO

-- ============================================
-- 5. ChatMessages Table
-- Stores individual chat messages
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ChatMessages')
BEGIN
    CREATE TABLE ChatMessages (
        MessageID INT IDENTITY(1,1) PRIMARY KEY,
        ChatSessionID NVARCHAR(50) NOT NULL,
        UserID INT NOT NULL,
        Role NVARCHAR(20) NOT NULL,        -- user, assistant
        Content NVARCHAR(MAX) NOT NULL,
        Timestamp DATETIME2 NOT NULL DEFAULT GETDATE(),
        TokenCount INT NULL,
        CONSTRAINT FK_ChatMessages_Session FOREIGN KEY (ChatSessionID) 
            REFERENCES ChatbotSession(chatSessionID),
        CONSTRAINT FK_ChatMessages_User FOREIGN KEY (UserID) 
            REFERENCES UserProfile(UserID)
    );
    PRINT '✅ Created ChatMessages table';
END
ELSE
BEGIN
    PRINT '⚠️ ChatMessages table already exists';
END
GO

-- ============================================
-- 6. UserUsage Table
-- Tracks API usage for free/premium limits
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserUsage')
BEGIN
    CREATE TABLE UserUsage (
        UserUsageID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        WeekStart DATE NOT NULL,
        CreateDate DATETIME2 NOT NULL DEFAULT GETDATE(),
        GeneralInquiryCount INT NOT NULL DEFAULT 0,
        WorkoutInquiryCount INT NOT NULL DEFAULT 0,
        CONSTRAINT FK_UserUsage_User FOREIGN KEY (UserID) 
            REFERENCES UserProfile(UserID),
        CONSTRAINT UK_UserUsage_UserWeek UNIQUE (UserID, WeekStart)
    );
    PRINT '✅ Created UserUsage table';
END
ELSE
BEGIN
    PRINT '⚠️ UserUsage table already exists';
END
GO

-- ============================================
-- 7. Create indexes for performance
-- ============================================

-- PreWorkoutAssessment indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PreWorkoutAssessment_UserID')
BEGIN
    CREATE INDEX IX_PreWorkoutAssessment_UserID ON PreWorkoutAssessment(UserID);
    PRINT '✅ Created index IX_PreWorkoutAssessment_UserID';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PreWorkoutAssessment_CreatedAt')
BEGIN
    CREATE INDEX IX_PreWorkoutAssessment_CreatedAt ON PreWorkoutAssessment(CreatedAt DESC);
    PRINT '✅ Created index IX_PreWorkoutAssessment_CreatedAt';
END
GO

-- AIWorkoutPlans indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AIWorkoutPlans_User')
BEGIN
    CREATE INDEX IX_AIWorkoutPlans_User ON AIWorkoutPlans(UserID);
    PRINT '✅ Created index IX_AIWorkoutPlans_User';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AIWorkoutPlans_Session')
BEGIN
    CREATE INDEX IX_AIWorkoutPlans_Session ON AIWorkoutPlans(ChatSessionID);
    PRINT '✅ Created index IX_AIWorkoutPlans_Session';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AIWorkoutPlans_Status')
BEGIN
    CREATE INDEX IX_AIWorkoutPlans_Status ON AIWorkoutPlans(Status);
    PRINT '✅ Created index IX_AIWorkoutPlans_Status';
END
GO

-- ChatMessages indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ChatMessages_Session')
BEGIN
    CREATE INDEX IX_ChatMessages_Session ON ChatMessages(ChatSessionID);
    PRINT '✅ Created index IX_ChatMessages_Session';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ChatMessages_User')
BEGIN
    CREATE INDEX IX_ChatMessages_User ON ChatMessages(UserID);
    PRINT '✅ Created index IX_ChatMessages_User';
END
GO

-- UserUsage indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_UserUsage_UserWeek')
BEGIN
    CREATE INDEX IX_UserUsage_UserWeek ON UserUsage(UserID, WeekStart);
    PRINT '✅ Created index IX_UserUsage_UserWeek';
END
GO

PRINT '';
PRINT '============================================';
PRINT '✅ Pre-Assessment feature migration complete!';
PRINT '============================================';
PRINT '';
PRINT 'Tables verified/created:';
PRINT '  - PreWorkoutAssessment';
PRINT '  - AIWorkoutPlans';
PRINT '  - ChatbotSession';
PRINT '  - ChatMessages';
PRINT '  - UserUsage';
PRINT '';
PRINT 'UserProfile columns verified/added:';
PRINT '  - DOB, HeightUnit, WeightUnit, Goals, UserType';
PRINT '============================================';
