/**
 * Reset script for UserId = 66
 * This script resets all subscription and payment data while preserving user identity
 * 
 * Usage: node resetUser66.js
 * 
 * Make sure your .env file has database connection settings configured
 */

const mssql = require('mssql');
require('dotenv').config();

const userId = 66;

async function resetUser() {
  let pool;
  
  try {
    // Get database connection
    const config = {
      server: process.env.DB_HOST,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      options: {
        encrypt: true,
        trustServerCertificate: false
      }
    };

    console.log('🔄 Connecting to database...');
    pool = await mssql.connect(config);
    console.log('✅ Connected to database');

    const transaction = new mssql.Transaction(pool);
    
    await transaction.begin();
    console.log('📝 Transaction started');

    try {
      // 1. Reset UserProfile.UserType to Free
      console.log('\n1. Resetting UserProfile.UserType to Free...');
      const userProfileRequest = new mssql.Request(transaction);
      userProfileRequest.input('userId', mssql.Int, userId);
      
      const userProfileResult = await userProfileRequest.query(`
        UPDATE [dbo].[UserProfile]
        SET UserType = 'Free',
            UserTypeChangedDate = SYSDATETIMEOFFSET()
        WHERE UserID = @userId
        
        SELECT UserID, UserType, UserTypeChangedDate
        FROM [dbo].[UserProfile]
        WHERE UserID = @userId
      `);
      
      if (userProfileResult.recordset.length > 0) {
        console.log('   ✅ UserProfile updated:', userProfileResult.recordset[0]);
      } else {
        console.log('   ⚠️ No UserProfile record found for UserId =', userId);
      }

      // 2. Delete user_subscriptions record
      console.log('\n2. Deleting user_subscriptions record...');
      const subscriptionRequest = new mssql.Request(transaction);
      subscriptionRequest.input('userId', mssql.Int, userId);
      
      const subscriptionResult = await subscriptionRequest.query(`
        DELETE FROM [dbo].[user_subscriptions]
        WHERE UserId = @userId
        
        SELECT @@ROWCOUNT AS DeletedRows
      `);
      
      const deletedRows = subscriptionResult.recordset[0]?.DeletedRows || 0;
      if (deletedRows > 0) {
        console.log(`   ✅ Deleted ${deletedRows} user_subscriptions record(s)`);
      } else {
        console.log('   ℹ️ No user_subscriptions record found');
      }

      // 3. Optional: Delete payment records (uncomment if needed)
      /*
      console.log('\n3. Deleting payment records...');
      const paymentRequest = new mssql.Request(transaction);
      paymentRequest.input('userId', mssql.Int, userId);
      
      const paymentResult = await paymentRequest.query(`
        DELETE FROM [dbo].[payments]
        WHERE UserId = @userId
        
        SELECT @@ROWCOUNT AS DeletedRows
      `);
      
      const deletedPayments = paymentResult.recordset[0]?.DeletedRows || 0;
      console.log(`   ✅ Deleted ${deletedPayments} payment record(s)`);
      */

      // Commit transaction
      await transaction.commit();
      console.log('\n✅ Transaction committed successfully');

      // Verify reset
      console.log('\n=== Verification ===');
      
      const verifyRequest = pool.request();
      verifyRequest.input('userId', mssql.Int, userId);
      
      const verifyResult = await verifyRequest.query(`
        -- UserProfile
        SELECT 'UserProfile' AS TableName, UserID, UserType, UserTypeChangedDate
        FROM [dbo].[UserProfile]
        WHERE UserID = @userId
        
        UNION ALL
        
        -- user_subscriptions (should be empty)
        SELECT 'user_subscriptions' AS TableName, 
               CAST(UserId AS VARCHAR) AS UserID, 
               status AS UserType,
               NULL AS UserTypeChangedDate
        FROM [dbo].[user_subscriptions]
        WHERE UserId = @userId
      `);
      
      console.log('\nCurrent state:');
      verifyResult.recordset.forEach(row => {
        console.log(`   ${row.TableName}: UserID=${row.UserID}, UserType=${row.UserType || 'N/A'}`);
      });
      
      // Check payments count
      const paymentCountRequest = pool.request();
      paymentCountRequest.input('userId', mssql.Int, userId);
      const paymentCountResult = await paymentCountRequest.query(`
        SELECT COUNT(*) AS PaymentCount
        FROM [dbo].[payments]
        WHERE UserId = @userId
      `);
      
      console.log(`\n   Payments table: ${paymentCountResult.recordset[0].PaymentCount} record(s) for UserId ${userId}`);
      
      // Verify UserLogin is intact
      const userLoginRequest = pool.request();
      userLoginRequest.input('userId', mssql.Int, userId);
      const userLoginResult = await userLoginRequest.query(`
        SELECT UserID, Email
        FROM [dbo].[UserLogin]
        WHERE UserID = @userId
      `);
      
      if (userLoginResult.recordset.length > 0) {
        console.log(`\n✅ UserLogin intact: UserID=${userLoginResult.recordset[0].UserID}, Email=${userLoginResult.recordset[0].Email}`);
      } else {
        console.log(`\n⚠️ UserLogin record not found for UserId ${userId}`);
      }

      console.log('\n✅ Reset completed successfully!');
      console.log(`User ${userId} is now reset to Free plan with no subscription data.`);
      console.log('You can now test payment flow to see if Stripe properly saves customers.');
      
    } catch (err) {
      await transaction.rollback();
      console.error('\n❌ Error during reset, transaction rolled back:', err.message);
      throw err;
    }
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.stack) {
      console.error('Stack:', err.stack);
    }
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run the reset
resetUser().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

