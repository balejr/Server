-- Migration: Add OnboardingData column to UserProfile
-- Purpose: Store enhanced onboarding data as JSON for AI workout plan personalization
-- Date: 2025-01-01

-- Check if column exists before adding
IF NOT EXISTS (
    SELECT 1 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'UserProfile' 
    AND COLUMN_NAME = 'OnboardingData'
)
BEGIN
    ALTER TABLE [dbo].[UserProfile]
    ADD OnboardingData NVARCHAR(MAX) NULL;
    
    PRINT 'Column OnboardingData added successfully to UserProfile table.';
END
ELSE
BEGIN
    PRINT 'Column OnboardingData already exists in UserProfile table.';
END
GO

-- Verify the column was added
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'UserProfile' AND COLUMN_NAME = 'OnboardingData';

