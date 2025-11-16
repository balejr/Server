-- Simple Reset Script for UserId = 66
-- Run this in Azure SQL Database or SQL Server Management Studio

BEGIN TRANSACTION;

-- 1. Reset UserProfile.UserType to Free
UPDATE [dbo].[UserProfile]
SET UserType = 'Free',
    UserTypeChangedDate = SYSDATETIMEOFFSET()
WHERE UserID = 66;

-- 2. Delete user_subscriptions record (removes customer_id, subscription_id, etc.)
DELETE FROM [dbo].[user_subscriptions]
WHERE UserId = 66;

-- 3. Optional: Delete payment records (uncomment if you want to remove payment history)
-- DELETE FROM [dbo].[payments]
-- WHERE UserId = 66;

-- Verify the reset
SELECT 'UserProfile' AS TableName, UserID, UserType FROM [dbo].[UserProfile] WHERE UserID = 66
UNION ALL
SELECT 'user_subscriptions' AS TableName, UserId AS UserID, status AS UserType FROM [dbo].[user_subscriptions] WHERE UserId = 66;

COMMIT TRANSACTION;

-- Final verification
SELECT 
    'After Reset - UserProfile' AS Info,
    UserID,
    UserType
FROM [dbo].[UserProfile]
WHERE UserID = 66;

SELECT 
    'After Reset - user_subscriptions' AS Info,
    UserId,
    [plan],
    status,
    subscription_id,
    customer_id
FROM [dbo].[user_subscriptions]
WHERE UserId = 66;

-- This should return 0 rows if reset was successful
SELECT 
    'After Reset - payments count' AS Info,
    COUNT(*) AS PaymentCount
FROM [dbo].[payments]
WHERE UserId = 66;


