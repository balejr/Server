-- Migration: Add ChallengeSuggestionUsage table for rate limiting
-- Limits: 10 suggestions/hour, 20 suggestions/day
-- Date: 2026-01-27

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ChallengeSuggestionUsage')
BEGIN
    CREATE TABLE [dbo].[ChallengeSuggestionUsage] (
        UsageID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        SuggestionCount INT NOT NULL DEFAULT 1,  -- Number of suggestions generated in this request
        GeneratedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT FK_ChallengeSuggestionUsage_User
            FOREIGN KEY (UserID) REFERENCES [dbo].[User](UserId)
    );

    -- Index for efficient rate limit queries
    CREATE NONCLUSTERED INDEX IX_ChallengeSuggestionUsage_UserID_GeneratedAt
        ON [dbo].[ChallengeSuggestionUsage] (UserID, GeneratedAt DESC);

    PRINT 'Created ChallengeSuggestionUsage table with index';
END
ELSE
BEGIN
    PRINT 'ChallengeSuggestionUsage table already exists';
END
GO
