-- Reset script for UserId = 66
-- This script resets all subscription and payment data while preserving user identity
-- Run this script to test if Stripe properly saves customers

USE [ApogeeFit]; -- Replace with your actual database name if different
GO

BEGIN TRANSACTION;

BEGIN TRY
    PRINT 'Starting reset for UserId = 66...';
    
    -- 1. Reset UserProfile.UserType from Premium to Free
    PRINT '1. Resetting UserProfile.UserType to Free...';
    UPDATE [dbo].[UserProfile]
    SET UserType = 'Free',
        UserTypeChangedDate = SYSDATETIMEOFFSET()
    WHERE UserID = 66;
    
    IF @@ROWCOUNT > 0
        PRINT '   ✅ UserProfile.UserType reset to Free';
    ELSE
        PRINT '   ⚠️ No UserProfile record found for UserId = 66';
    
    -- 2. Reset user_subscriptions table
    -- Option A: Delete the record entirely
    PRINT '2. Deleting user_subscriptions record...';
    DELETE FROM [dbo].[user_subscriptions]
    WHERE UserId = 66;
    
    IF @@ROWCOUNT > 0
        PRINT '   ✅ user_subscriptions record deleted';
    ELSE
        PRINT '   ℹ️ No user_subscriptions record found for UserId = 66';
    
    -- Option B: If you prefer to keep the record but reset values (uncomment if needed):
    /*
    PRINT '2. Resetting user_subscriptions record...';
    UPDATE [dbo].[user_subscriptions]
    SET [plan] = 'Free',
        status = 'inactive',
        subscription_id = NULL,
        customer_id = NULL,
        current_period_start = NULL,
        current_period_end = NULL,
        payment_intent_id = NULL,
        updated_at = SYSDATETIMEOFFSET()
    WHERE UserId = 66;
    
    IF @@ROWCOUNT > 0
        PRINT '   ✅ user_subscriptions record reset';
    ELSE
        PRINT '   ℹ️ No user_subscriptions record found for UserId = 66';
    */
    
    -- 3. Delete payment records (optional - keeps payment history)
    -- Uncomment if you want to delete payment history too:
    /*
    PRINT '3. Deleting payment records...';
    DELETE FROM [dbo].[payments]
    WHERE UserId = 66;
    
    IF @@ROWCOUNT > 0
        PRINT '   ✅ Payment records deleted';
    ELSE
        PRINT '   ℹ️ No payment records found for UserId = 66';
    */
    
    -- 4. Verify what was reset
    PRINT '';
    PRINT '=== Verification ===';
    
    -- Check UserProfile
    SELECT 
        UserID,
        UserType,
        UserTypeChangedDate
    FROM [dbo].[UserProfile]
    WHERE UserID = 66;
    
    -- Check user_subscriptions (should be empty or reset)
    SELECT 
        UserId,
        [plan],
        status,
        subscription_id,
        customer_id,
        current_period_start,
        current_period_end,
        payment_intent_id
    FROM [dbo].[user_subscriptions]
    WHERE UserId = 66;
    
    -- Check payments (if you didn't delete them)
    SELECT 
        UserId,
        [plan],
        amount,
        status,
        payment_intent_id,
        created_date
    FROM [dbo].[payments]
    WHERE UserId = 66
    ORDER BY created_date DESC;
    
    -- Verify UserLogin is intact (should not be changed)
    SELECT 
        UserID,
        Email
    FROM [dbo].[UserLogin]
    WHERE UserID = 66;
    
    COMMIT TRANSACTION;
    PRINT '';
    PRINT '✅ Reset completed successfully!';
    PRINT 'User 66 is now reset to Free plan with no subscription data.';
    PRINT 'You can now test payment flow to see if Stripe properly saves customers.';
    
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT '';
    PRINT '❌ Error occurred during reset:';
    PRINT ERROR_MESSAGE();
    PRINT 'Transaction rolled back.';
END CATCH;
GO



