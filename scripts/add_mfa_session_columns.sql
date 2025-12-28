-- Migration: Add MFA Session Token Columns
-- Purpose: Store MFA session tokens for secure MFA login flow validation
-- Date: 2025-12-13
-- Database: ApogeeFit (apogeehnp.database.windows.net)

-- ============================================
-- STEP 1: Add MFA session columns to UserLogin
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'MFASessionToken')
BEGIN
    ALTER TABLE [dbo].[UserLogin]
    ADD MFASessionToken NVARCHAR(100) NULL;
    PRINT 'Added MFASessionToken column';
END
ELSE
BEGIN
    PRINT 'MFASessionToken column already exists';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'MFASessionExpires')
BEGIN
    ALTER TABLE [dbo].[UserLogin]
    ADD MFASessionExpires DATETIMEOFFSET NULL;
    PRINT 'Added MFASessionExpires column';
END
ELSE
BEGIN
    PRINT 'MFASessionExpires column already exists';
END

-- ============================================
-- STEP 2: Add index for MFA session token lookups
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_UserLogin_MFASessionToken')
BEGIN
    CREATE INDEX IX_UserLogin_MFASessionToken
        ON [dbo].[UserLogin](MFASessionToken)
        WHERE MFASessionToken IS NOT NULL;
    PRINT 'Created index IX_UserLogin_MFASessionToken';
END
ELSE
BEGIN
    PRINT 'Index IX_UserLogin_MFASessionToken already exists';
END

-- ============================================
-- STEP 3: Verify changes
-- ============================================
SELECT 'UserLogin MFA Session Columns' AS TableCheck;
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'UserLogin'
  AND COLUMN_NAME IN ('MFASessionToken', 'MFASessionExpires')
ORDER BY ORDINAL_POSITION;

PRINT 'MFA Session Token migration completed successfully!';






