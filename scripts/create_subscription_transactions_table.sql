-- ============================================
-- Migration: Create subscription_transactions table
-- Date: 2024-11-20
-- Description: Creates audit trail table for all subscription lifecycle events
-- ============================================

-- Create subscription_transactions table
IF NOT EXISTS (
    SELECT * FROM sys.tables 
    WHERE name = 'subscription_transactions' 
    AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
    CREATE TABLE [dbo].[subscription_transactions] (
        [transaction_id] INT IDENTITY(1,1) PRIMARY KEY,
        [UserId] INT NOT NULL,
        [subscription_id] NVARCHAR(128) NULL,
        [transaction_type] NVARCHAR(32) NOT NULL,
        [transaction_date] DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
        
        -- Plan details at time of transaction
        [from_plan] NVARCHAR(32) NULL,
        [to_plan] NVARCHAR(32) NULL,
        [billing_interval] NVARCHAR(32) NULL,
        
        -- Financial details
        [amount] DECIMAL(10,2) NULL,
        [currency] VARCHAR(3) NULL DEFAULT 'USD',
        [proration_amount] DECIMAL(10,2) NULL,
        
        -- Metadata
        [payment_gateway] NVARCHAR(32) NULL,
        [payment_intent_id] NVARCHAR(128) NULL,
        [cancellation_reason] NVARCHAR(50) NULL,
        [user_feedback] NVARCHAR(500) NULL,
        
        -- Pause-specific fields
        [pause_duration_months] INT NULL,
        [resume_date] DATETIMEOFFSET NULL,
        
        -- Constraints
        CONSTRAINT FK_subscription_transactions_UserId 
            FOREIGN KEY ([UserId]) REFERENCES [dbo].[UserProfile]([UserID]),
        CONSTRAINT CK_subscription_transactions_transaction_type 
            CHECK ([transaction_type] IN (
                'activation', 'upgrade', 'downgrade', 'pause', 
                'resume', 'cancellation', 'expiration', 'renewal'
            ))
    );
    
    PRINT '✅ Created subscription_transactions table';
END
ELSE
BEGIN
    PRINT '⚠️ subscription_transactions table already exists';
END

-- Create indexes
IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE name = 'idx_user_transaction_date' 
    AND object_id = OBJECT_ID(N'[dbo].[subscription_transactions]')
)
BEGIN
    CREATE INDEX idx_user_transaction_date 
        ON [dbo].[subscription_transactions] ([UserId], [transaction_date] DESC);
    PRINT '✅ Created index idx_user_transaction_date';
END

IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE name = 'idx_subscription_transactions_subscription_id' 
    AND object_id = OBJECT_ID(N'[dbo].[subscription_transactions]')
)
BEGIN
    CREATE INDEX idx_subscription_transactions_subscription_id 
        ON [dbo].[subscription_transactions] ([subscription_id])
        WHERE [subscription_id] IS NOT NULL;
    PRINT '✅ Created index idx_subscription_transactions_subscription_id';
END

IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE name = 'idx_subscription_transactions_type' 
    AND object_id = OBJECT_ID(N'[dbo].[subscription_transactions]')
)
BEGIN
    CREATE INDEX idx_subscription_transactions_type 
        ON [dbo].[subscription_transactions] ([transaction_type]);
    PRINT '✅ Created index idx_subscription_transactions_type';
END

PRINT '';
PRINT '✅ Migration completed successfully!';
PRINT '   Created subscription_transactions table with:';
PRINT '   - 17 columns for comprehensive transaction tracking';
PRINT '   - Foreign key to UserProfile';
PRINT '   - CHECK constraint for transaction_type';
PRINT '   - 3 indexes for query optimization';

