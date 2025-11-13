// Script to cancel incomplete subscription for UserId = 66
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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

async function cancelIncompleteSubscription() {
  let pool;
  
  try {
    console.log('🔌 Connecting to database...');
    pool = await mssql.connect(config);
    console.log('✅ Connected to database');
    
    const userId = 66;
    
    // Step 1: Get subscription from database
    console.log(`\n📋 Getting subscription from database for UserId = ${userId}...`);
    const dbRequest = pool.request();
    dbRequest.input('userId', mssql.Int, userId);
    
    const dbResult = await dbRequest.query(`
      SELECT 
        subscription_id,
        customer_id,
        status
      FROM [dbo].[user_subscriptions]
      WHERE UserId = @userId
    `);
    
    if (dbResult.recordset.length === 0) {
      console.log('❌ No subscription found in database');
      return;
    }
    
    const dbRecord = dbResult.recordset[0];
    console.log(`\n📊 Database Record:`);
    console.log(`  Subscription ID: ${dbRecord.subscription_id || 'NULL'}`);
    console.log(`  Customer ID: ${dbRecord.customer_id || 'NULL'}`);
    console.log(`  Status: ${dbRecord.status || 'NULL'}`);
    
    if (!dbRecord.subscription_id) {
      console.log('\n⚠️ No subscription_id in database, nothing to cancel');
      return;
    }
    
    // Step 2: Cancel subscription in Stripe
    console.log(`\n🗑️  Canceling subscription in Stripe: ${dbRecord.subscription_id}...`);
    try {
      const canceledSubscription = await stripe.subscriptions.cancel(dbRecord.subscription_id);
      console.log(`✅ Subscription canceled in Stripe`);
      console.log(`  New Status: ${canceledSubscription.status}`);
    } catch (cancelErr) {
      if (cancelErr.code === 'resource_missing') {
        console.log('⚠️ Subscription not found in Stripe (may already be canceled)');
      } else {
        throw cancelErr;
      }
    }
    
    // Step 3: Update database
    console.log(`\n🔄 Updating database...`);
    const updateRequest = pool.request();
    updateRequest.input('userId', mssql.Int, userId);
    updateRequest.input('status', mssql.NVarChar(32), 'canceled');
    
    await updateRequest.query(`
      UPDATE [dbo].[user_subscriptions]
      SET status = @status,
          updated_at = SYSDATETIMEOFFSET()
      WHERE UserId = @userId
    `);
    
    console.log('✅ Database updated: status = canceled');
    
    // Step 4: Optionally downgrade user to Free
    console.log(`\n🔄 Checking if user should be downgraded to Free...`);
    const userProfileRequest = pool.request();
    userProfileRequest.input('userId', mssql.Int, userId);
    
    const userProfileResult = await userProfileRequest.query(`
      SELECT UserType FROM [dbo].[UserProfile] WHERE UserID = @userId
    `);
    
    if (userProfileResult.recordset.length > 0) {
      const currentUserType = userProfileResult.recordset[0].UserType;
      if (currentUserType === 'Premium') {
        console.log('   Downgrading user from Premium to Free...');
        const downgradeRequest = pool.request();
        downgradeRequest.input('userId', mssql.Int, userId);
        
        await downgradeRequest.query(`
          UPDATE [dbo].[UserProfile]
          SET UserType = 'Free',
              UserTypeChangedDate = SYSDATETIMEOFFSET()
          WHERE UserID = @userId
        `);
        
        console.log('✅ User downgraded to Free');
      } else {
        console.log(`   User is already ${currentUserType}, no change needed`);
      }
    }
    
    console.log('\n✅ Incomplete subscription canceled successfully!');
    console.log('   User can now create a new subscription');
    
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

cancelIncompleteSubscription()
  .then(() => {
    console.log('\n✨ Script completed');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Script failed:', err);
    process.exit(1);
  });

