-- Migration: Add Password Reset Token Fields to UserLogin
-- Purpose: Support email-based password reset flow with Twilio Verify
-- Date: 2025-12-13

-- ============================================
-- Add PasswordResetToken and PasswordResetExpires columns
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'PasswordResetToken')
BEGIN
    ALTER TABLE [dbo].[UserLogin]
    ADD PasswordResetToken NVARCHAR(100) NULL;
    PRINT 'Added PasswordResetToken column to UserLogin';
END
ELSE
BEGIN
    PRINT 'PasswordResetToken column already exists';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'PasswordResetExpires')
BEGIN
    ALTER TABLE [dbo].[UserLogin]
    ADD PasswordResetExpires DATETIMEOFFSET NULL;
    PRINT 'Added PasswordResetExpires column to UserLogin';
END
ELSE
BEGIN
    PRINT 'PasswordResetExpires column already exists';
END

-- ============================================
-- Verify changes
-- ============================================
SELECT 'UserLogin Password Reset Columns' AS TableCheck;
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'UserLogin'
  AND COLUMN_NAME IN ('PasswordResetToken', 'PasswordResetExpires')
ORDER BY ORDINAL_POSITION;

PRINT 'Migration completed successfully!';
