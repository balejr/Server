/**
 * Database Migration Script
 * Adds subscription-related columns to user_subscriptions table
 * 
 * Run this SQL script in your Azure SQL Database to add support for Stripe Subscriptions
 */

-- Add new columns to user_subscriptions table for subscription support
-- These columns are nullable to support existing PaymentIntent-based subscriptions (legacy)

IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[user_subscriptions]') 
    AND name = 'subscription_id'
)
BEGIN
    ALTER TABLE [dbo].[user_subscriptions]
    ADD subscription_id NVARCHAR(128) NULL;
    PRINT '✅ Added subscription_id column';
END
ELSE
BEGIN
    PRINT '⚠️ subscription_id column already exists';
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[user_subscriptions]') 
    AND name = 'customer_id'
)
BEGIN
    ALTER TABLE [dbo].[user_subscriptions]
    ADD customer_id NVARCHAR(128) NULL;
    PRINT '✅ Added customer_id column';
END
ELSE
BEGIN
    PRINT '⚠️ customer_id column already exists';
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[user_subscriptions]') 
    AND name = 'current_period_start'
)
BEGIN
    ALTER TABLE [dbo].[user_subscriptions]
    ADD current_period_start DATETIMEOFFSET NULL;
    PRINT '✅ Added current_period_start column';
END
ELSE
BEGIN
    PRINT '⚠️ current_period_start column already exists';
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[user_subscriptions]') 
    AND name = 'current_period_end'
)
BEGIN
    ALTER TABLE [dbo].[user_subscriptions]
    ADD current_period_end DATETIMEOFFSET NULL;
    PRINT '✅ Added current_period_end column';
END
ELSE
BEGIN
    PRINT '⚠️ current_period_end column already exists';
END
GO

-- Optional: Add indexes for better query performance
IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE name = 'IX_user_subscriptions_subscription_id' 
    AND object_id = OBJECT_ID(N'[dbo].[user_subscriptions]')
)
BEGIN
    CREATE INDEX IX_user_subscriptions_subscription_id 
    ON [dbo].[user_subscriptions] (subscription_id)
    WHERE subscription_id IS NOT NULL;
    PRINT '✅ Created index on subscription_id';
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE name = 'IX_user_subscriptions_customer_id' 
    AND object_id = OBJECT_ID(N'[dbo].[user_subscriptions]')
)
BEGIN
    CREATE INDEX IX_user_subscriptions_customer_id 
    ON [dbo].[user_subscriptions] (customer_id)
    WHERE customer_id IS NOT NULL;
    PRINT '✅ Created index on customer_id';
END
GO

PRINT '✅ Migration complete!';
PRINT '';
PRINT 'The user_subscriptions table now supports:';
PRINT '  - subscription_id: Stripe Subscription ID (sub_xxx)';
PRINT '  - customer_id: Stripe Customer ID (cus_xxx)';
PRINT '  - current_period_start: Start of current billing period';
PRINT '  - current_period_end: End of current billing period';
PRINT '';
PRINT 'Note: These columns are nullable to support legacy PaymentIntent-based subscriptions.';

