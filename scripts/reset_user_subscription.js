// Script to reset UserId = 66 to a clean state for testing
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mssql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

async function resetUserSubscription() {
  let pool;
  
  try {
    console.log('🔌 Connecting to database...');
    pool = await mssql.connect(config);
    console.log('✅ Connected to database');
    
    const userId = 66;
    
    // Step 1: Check current state
    console.log(`\n📋 Checking current state for UserId = ${userId}...`);
    
    const checkUserProfile = pool.request();
    checkUserProfile.input('userId', mssql.Int, userId);
    const userProfileResult = await checkUserProfile.query(`
      SELECT UserType, UserTypeChangedDate
      FROM [dbo].[UserProfile]
      WHERE UserID = @userId
    `);
    
    const checkSubscription = pool.request();
    checkSubscription.input('userId', mssql.Int, userId);
    const subscriptionResult = await checkSubscription.query(`
      SELECT 
        [plan],
        status,
        subscription_id,
        customer_id,
        payment_intent_id,
        current_period_start,
        current_period_end
      FROM [dbo].[user_subscriptions]
      WHERE UserId = @userId
    `);
    
    console.log('\n📊 Current State:');
    if (userProfileResult.recordset.length > 0) {
      const profile = userProfileResult.recordset[0];
      console.log(`  UserProfile.UserType: ${profile.UserType || 'NULL'}`);
      console.log(`  UserTypeChangedDate: ${profile.UserTypeChangedDate || 'NULL'}`);
    } else {
      console.log('  UserProfile: No record found');
    }
    
    if (subscriptionResult.recordset.length > 0) {
      const sub = subscriptionResult.recordset[0];
      console.log(`  Subscription Plan: ${sub.plan || 'NULL'}`);
      console.log(`  Status: ${sub.status || 'NULL'}`);
      console.log(`  Subscription ID: ${sub.subscription_id || 'NULL'}`);
      console.log(`  Customer ID: ${sub.customer_id || 'NULL'}`);
      console.log(`  Payment Intent ID: ${sub.payment_intent_id || 'NULL'}`);
      console.log(`  Current Period Start: ${sub.current_period_start || 'NULL'}`);
      console.log(`  Current Period End: ${sub.current_period_end || 'NULL'}`);
    } else {
      console.log('  Subscription: No record found');
    }
    
    // Step 2: Reset UserProfile to Free
    console.log(`\n🔄 Resetting UserProfile to Free...`);
    const resetProfileRequest = pool.request();
    resetProfileRequest.input('userId', mssql.Int, userId);
    
    await resetProfileRequest.query(`
      UPDATE [dbo].[UserProfile]
      SET UserType = 'Free',
          UserTypeChangedDate = SYSDATETIMEOFFSET()
      WHERE UserID = @userId
    `);
    
    console.log('✅ UserProfile reset to Free');
    
    // Step 3: Reset or delete user_subscriptions
    console.log(`\n🔄 Resetting user_subscriptions...`);
    
    if (subscriptionResult.recordset.length > 0) {
      // Update existing record - clear all subscription data
      const resetSubscriptionRequest = pool.request();
      resetSubscriptionRequest.input('userId', mssql.Int, userId);
      
      await resetSubscriptionRequest.query(`
        UPDATE [dbo].[user_subscriptions]
        SET 
          [plan] = 'Free',
          status = 'inactive',
          subscription_id = NULL,
          customer_id = NULL,
          payment_intent_id = NULL,
          current_period_start = NULL,
          current_period_end = NULL,
          updated_at = SYSDATETIMEOFFSET()
        WHERE UserId = @userId
      `);
      
      console.log('✅ Subscription record cleared (set to inactive)');
    } else {
      // Create a new inactive record
      const createSubscriptionRequest = pool.request();
      createSubscriptionRequest.input('userId', mssql.Int, userId);
      
      await createSubscriptionRequest.query(`
        INSERT INTO [dbo].[user_subscriptions] 
        (UserId, [plan], status, started_at, updated_at)
        VALUES 
        (@userId, 'Free', 'inactive', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET())
      `);
      
      console.log('✅ Created new inactive subscription record');
    }
    
    // Step 4: Verify the reset
    console.log(`\n🔍 Verifying reset...`);
    
    const verifyProfile = pool.request();
    verifyProfile.input('userId', mssql.Int, userId);
    const verifyProfileResult = await verifyProfile.query(`
      SELECT UserType FROM [dbo].[UserProfile] WHERE UserID = @userId
    `);
    
    const verifySubscription = pool.request();
    verifySubscription.input('userId', mssql.Int, userId);
    const verifySubscriptionResult = await verifySubscription.query(`
      SELECT 
        [plan],
        status,
        subscription_id,
        customer_id,
        payment_intent_id,
        current_period_start,
        current_period_end
      FROM [dbo].[user_subscriptions]
      WHERE UserId = @userId
    `);
    
    console.log('\n📊 Reset State:');
    if (verifyProfileResult.recordset.length > 0) {
      console.log(`  UserProfile.UserType: ${verifyProfileResult.recordset[0].UserType} ✅`);
    }
    
    if (verifySubscriptionResult.recordset.length > 0) {
      const sub = verifySubscriptionResult.recordset[0];
      console.log(`  Subscription Plan: ${sub.plan} ✅`);
      console.log(`  Status: ${sub.status} ✅`);
      console.log(`  Subscription ID: ${sub.subscription_id || 'NULL'} ✅`);
      console.log(`  Customer ID: ${sub.customer_id || 'NULL'} ✅`);
      console.log(`  Payment Intent ID: ${sub.payment_intent_id || 'NULL'} ✅`);
      console.log(`  Current Period Start: ${sub.current_period_start || 'NULL'} ✅`);
      console.log(`  Current Period End: ${sub.current_period_end || 'NULL'} ✅`);
    }
    
    console.log('\n✅ User reset complete!');
    console.log('   UserId = 66 is now ready for a fresh subscription test');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log('\n🔌 Database connection closed');
    }
  }
}

resetUserSubscription()
  .then(() => {
    console.log('\n✨ Script completed');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Script failed:', err);
    process.exit(1);
  });

