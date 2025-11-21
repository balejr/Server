-- Migration: Add UserTypeChangedDate column to UserProfile table
-- Purpose: Track when UserType changes from Free to Premium or Premium to Free
-- Date: 2025-01-XX

-- Add UserTypeChangedDate column
ALTER TABLE [dbo].[UserProfile]
ADD UserTypeChangedDate DATETIMEOFFSET NULL;

-- Add comment/documentation
-- This column tracks when UserType transitions occur:
-- - Set to current timestamp when UserType changes from Free → Premium
-- - Updated to current timestamp when UserType changes from Premium → Free
-- - Preserved (not updated) when UserType remains the same
-- - NULL for users who have never changed UserType

-- Verify column was added
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'UserProfile'
  AND COLUMN_NAME = 'UserTypeChangedDate';






