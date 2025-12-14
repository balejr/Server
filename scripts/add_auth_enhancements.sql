-- Migration: Add Authentication Enhancement Fields
-- Purpose: Support phone/SMS OTP, MFA, and biometric authentication via Twilio Verify
-- Date: 2025-01-13
-- Database: ApogeeFit (apogeehnp.database.windows.net)

-- ============================================
-- STEP 1: Add phone fields to UserProfile
-- ============================================
-- Check if columns exist before adding
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserProfile') AND name = 'PhoneNumber')
BEGIN
    ALTER TABLE [dbo].[UserProfile]
    ADD PhoneNumber NVARCHAR(20) NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserProfile') AND name = 'PhoneVerified')
BEGIN
    ALTER TABLE [dbo].[UserProfile]
    ADD PhoneVerified BIT DEFAULT 0;
END

-- ============================================
-- STEP 2: Add authentication preferences to UserLogin
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'PreferredLoginMethod')
BEGIN
    ALTER TABLE [dbo].[UserLogin]
    ADD PreferredLoginMethod NVARCHAR(20) DEFAULT 'email';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'MFAEnabled')
BEGIN
    ALTER TABLE [dbo].[UserLogin]
    ADD MFAEnabled BIT DEFAULT 0;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'MFAMethod')
BEGIN
    ALTER TABLE [dbo].[UserLogin]
    ADD MFAMethod NVARCHAR(20) NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'BiometricEnabled')
BEGIN
    ALTER TABLE [dbo].[UserLogin]
    ADD BiometricEnabled BIT DEFAULT 0;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'BiometricToken')
BEGIN
    ALTER TABLE [dbo].[UserLogin]
    ADD BiometricToken NVARCHAR(500) NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'RefreshToken')
BEGIN
    ALTER TABLE [dbo].[UserLogin]
    ADD RefreshToken NVARCHAR(500) NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'RefreshTokenExpires')
BEGIN
    ALTER TABLE [dbo].[UserLogin]
    ADD RefreshTokenExpires DATETIMEOFFSET NULL;
END

-- ============================================
-- STEP 3: Add constraints (drop if exists, then add)
-- ============================================
-- PreferredLoginMethod constraint
IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_PreferredLoginMethod')
BEGIN
    ALTER TABLE [dbo].[UserLogin] DROP CONSTRAINT CK_PreferredLoginMethod;
END

ALTER TABLE [dbo].[UserLogin]
ADD CONSTRAINT CK_PreferredLoginMethod 
    CHECK (PreferredLoginMethod IN ('email', 'phone', 'biometric'));

-- MFAMethod constraint
IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_MFAMethod')
BEGIN
    ALTER TABLE [dbo].[UserLogin] DROP CONSTRAINT CK_MFAMethod;
END

ALTER TABLE [dbo].[UserLogin]
ADD CONSTRAINT CK_MFAMethod 
    CHECK (MFAMethod IS NULL OR MFAMethod IN ('sms', 'email'));

-- ============================================
-- STEP 4: Create OTPVerifications table
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OTPVerifications')
BEGIN
    CREATE TABLE [dbo].[OTPVerifications] (
        VerificationID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NULL,  -- Nullable for anonymous/pre-signup OTP requests
        PhoneOrEmail NVARCHAR(255) NOT NULL,
        VerificationSID NVARCHAR(100),
        Purpose NVARCHAR(50) NOT NULL,
        Status NVARCHAR(20) DEFAULT 'pending',
        CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        ExpiresAt DATETIMEOFFSET,
        AttemptCount INT DEFAULT 0,
        -- Note: No FK constraint as UserID can be NULL for pre-signup verification
        CONSTRAINT CK_OTP_Purpose
            CHECK (Purpose IN ('login', 'signin', 'signup', 'mfa', 'password_reset', 'phone_verify')),
        CONSTRAINT CK_OTP_Status
            CHECK (Status IN ('pending', 'approved', 'expired', 'failed'))
    );
END

-- ============================================
-- STEP 5: Add indexes for performance
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_OTPVerifications_UserID_Purpose')
BEGIN
    CREATE INDEX IX_OTPVerifications_UserID_Purpose
        ON [dbo].[OTPVerifications](UserID, Purpose);
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_OTPVerifications_VerificationSID')
BEGIN
    CREATE INDEX IX_OTPVerifications_VerificationSID
        ON [dbo].[OTPVerifications](VerificationSID);
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_OTPVerifications_CreatedAt')
BEGIN
    CREATE INDEX IX_OTPVerifications_CreatedAt
        ON [dbo].[OTPVerifications](CreatedAt);
END

-- ============================================
-- STEP 6: Set default values for existing users
-- ============================================
UPDATE [dbo].[UserLogin]
SET PreferredLoginMethod = 'email',
    MFAEnabled = 0,
    BiometricEnabled = 0
WHERE PreferredLoginMethod IS NULL;

-- ============================================
-- STEP 7: Verify changes
-- ============================================
SELECT 'UserProfile Columns' AS TableCheck;
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'UserProfile'
  AND COLUMN_NAME IN ('PhoneNumber', 'PhoneVerified')
ORDER BY ORDINAL_POSITION;

SELECT 'UserLogin Columns' AS TableCheck;
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'UserLogin'
  AND COLUMN_NAME IN ('PreferredLoginMethod', 'MFAEnabled', 'MFAMethod', 'BiometricEnabled', 'BiometricToken', 'RefreshToken', 'RefreshTokenExpires')
ORDER BY ORDINAL_POSITION;

SELECT 'OTPVerifications Table' AS TableCheck;
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'OTPVerifications'
ORDER BY ORDINAL_POSITION;

PRINT 'Migration completed successfully!';

