-- ============================================
-- Migration: Add transaction tracking fields to user_subscriptions
-- Date: 2024-11-20
-- Description: Adds transaction_type and transaction_date columns for subscription lifecycle tracking
-- ============================================

-- Step 1: Add transaction_type column (if it doesn't exist)
IF NOT EXISTS (
    SELECT * 
    FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[user_subscriptions]') 
    AND name = 'transaction_type'
)
BEGIN
    ALTER TABLE [dbo].[user_subscriptions]
    ADD [transaction_type] NVARCHAR(32) NULL;
    
    PRINT '✅ Added transaction_type column to user_subscriptions table';
END
ELSE
BEGIN
    PRINT '⚠️ transaction_type column already exists, skipping...';
END

-- Step 2: Add transaction_date column (if it doesn't exist)
IF NOT EXISTS (
    SELECT * 
    FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[user_subscriptions]') 
    AND name = 'transaction_date'
)
BEGIN
    ALTER TABLE [dbo].[user_subscriptions]
    ADD [transaction_date] DATETIMEOFFSET NULL;
    
    PRINT '✅ Added transaction_date column to user_subscriptions table';
END
ELSE
BEGIN
    PRINT '⚠️ transaction_date column already exists, skipping...';
END

-- Step 3: Add CHECK constraint for transaction_type (if it doesn't exist)
IF NOT EXISTS (
    SELECT * 
    FROM sys.check_constraints 
    WHERE name = 'CK_user_subscriptions_transaction_type'
    AND parent_object_id = OBJECT_ID(N'[dbo].[user_subscriptions]')
)
BEGIN
    ALTER TABLE [dbo].[user_subscriptions]
    ADD CONSTRAINT CK_user_subscriptions_transaction_type
    CHECK ([transaction_type] IN (
        'activation', 'upgrade', 'downgrade', 'pause', 
        'resume', 'cancellation', 'expiration', 'renewal', NULL
    ));
    
    PRINT '✅ Added CHECK constraint for transaction_type';
END
ELSE
BEGIN
    PRINT '⚠️ CHECK constraint for transaction_type already exists, skipping...';
END

-- Step 4: Create index for transaction_type (if it doesn't exist)
IF NOT EXISTS (
    SELECT * 
    FROM sys.indexes 
    WHERE name = 'idx_transaction_type' 
    AND object_id = OBJECT_ID(N'[dbo].[user_subscriptions]')
)
BEGIN
    CREATE NONCLUSTERED INDEX idx_transaction_type 
    ON [dbo].[user_subscriptions] ([transaction_type])
    WHERE [transaction_type] IS NOT NULL;
    
    PRINT '✅ Created index idx_transaction_type';
END
ELSE
BEGIN
    PRINT '⚠️ Index idx_transaction_type already exists, skipping...';
END

-- Step 5: Verify the migration
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'user_subscriptions'
  AND COLUMN_NAME IN ('transaction_type', 'transaction_date');

PRINT '';
PRINT '✅ Migration completed successfully!';
PRINT '   Added columns:';
PRINT '   - transaction_type: NVARCHAR(32) NULL with CHECK constraint';
PRINT '   - transaction_date: DATETIMEOFFSET NULL';
PRINT '';
PRINT '   Valid transaction_type values:';
PRINT '   - activation, upgrade, downgrade, pause';
PRINT '   - resume, cancellation, expiration, renewal';

