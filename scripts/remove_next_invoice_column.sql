-- Remove next_invoice column from user_subscriptions table
-- This column is redundant as next billing date is derived from current_period_end
-- Migration Date: 2025-01-XX

USE [ApogeeFit]; -- Replace with your actual database name if different
GO

BEGIN TRANSACTION;

BEGIN TRY
    PRINT 'Removing next_invoice column from user_subscriptions table...';
    
    -- Check if column exists
    IF EXISTS (
        SELECT 1 
        FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'[dbo].[user_subscriptions]') 
        AND name = 'next_invoice'
    )
    BEGIN
        -- Remove the column
        ALTER TABLE [dbo].[user_subscriptions]
        DROP COLUMN next_invoice;
        
        PRINT '✅ Column next_invoice removed successfully';
    END
    ELSE
    BEGIN
        PRINT 'ℹ️ Column next_invoice does not exist (may have already been removed)';
    END
    
    -- Verify the column was removed
    IF NOT EXISTS (
        SELECT 1 
        FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'[dbo].[user_subscriptions]') 
        AND name = 'next_invoice'
    )
    BEGIN
        PRINT '✅ Verification: next_invoice column confirmed removed';
    END
    
    COMMIT TRANSACTION;
    PRINT '';
    PRINT '✅ Migration completed successfully!';
    PRINT 'Note: Next billing date is now derived from current_period_end column';
    
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT '';
    PRINT '❌ Error occurred during migration:';
    PRINT ERROR_MESSAGE();
    PRINT 'Transaction rolled back.';
END CATCH;
GO







