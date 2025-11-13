-- Add next_invoice column to user_subscriptions table
-- This column stores formatted next invoice information from Stripe (e.g., "Dec 12 for $9.99")

USE [ApogeeFit]; -- Replace with your actual database name if different
GO

BEGIN TRANSACTION;

BEGIN TRY
    PRINT 'Adding next_invoice column to user_subscriptions table...';
    
    -- Check if column already exists
    IF NOT EXISTS (
        SELECT 1 
        FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'[dbo].[user_subscriptions]') 
        AND name = 'next_invoice'
    )
    BEGIN
        -- Add the column
        ALTER TABLE [dbo].[user_subscriptions]
        ADD next_invoice NVARCHAR(128) NULL;
        
        PRINT '✅ Column next_invoice added successfully';
    END
    ELSE
    BEGIN
        PRINT 'ℹ️ Column next_invoice already exists';
    END
    
    -- Verify the column was added
    SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'user_subscriptions'
      AND COLUMN_NAME = 'next_invoice';
    
    COMMIT TRANSACTION;
    PRINT '';
    PRINT '✅ Migration completed successfully!';
    
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT '';
    PRINT '❌ Error occurred during migration:';
    PRINT ERROR_MESSAGE();
    PRINT 'Transaction rolled back.';
END CATCH;
GO

