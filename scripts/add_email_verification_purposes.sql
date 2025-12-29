-- Migration: Add email verification purposes to OTPVerifications table
-- Purpose: Extend OTPVerifications constraint to support email OTP for signup/signin flows
-- Date: 2025-12-19

-- ============================================
-- Update OTPVerifications table constraint to allow 'verification' purpose
-- ============================================
-- The frontend uses 'verification' for signup email OTP flow

-- Drop existing constraint
IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_OTP_Purpose')
BEGIN
    ALTER TABLE [dbo].[OTPVerifications] DROP CONSTRAINT CK_OTP_Purpose;
    PRINT '✅ Dropped existing CK_OTP_Purpose constraint';
END
ELSE
BEGIN
    PRINT 'ℹ️ CK_OTP_Purpose constraint does not exist';
END

-- Add updated constraint with 'verification' included
ALTER TABLE [dbo].[OTPVerifications]
ADD CONSTRAINT CK_OTP_Purpose
    CHECK (Purpose IN ('login', 'signin', 'signup', 'mfa', 'password_reset', 'phone_verify', 'verification'));

PRINT '✅ Added updated CK_OTP_Purpose constraint with verification support';

-- ============================================
-- Verify changes
-- ============================================
SELECT 'OTPVerifications Purpose Constraint' AS TableCheck;
SELECT 
    cc.name AS constraint_name,
    cc.definition AS constraint_definition
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID('dbo.OTPVerifications')
  AND cc.name = 'CK_OTP_Purpose';

PRINT '';
PRINT '✅ Migration completed successfully!';
PRINT 'Allowed purposes: login, signin, signup, mfa, password_reset, phone_verify, verification';







