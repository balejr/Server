// Script to check and clear customer_ids for UserId = 66
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

async function checkAndClearCustomerIds() {
  let pool;
  
  try {
    console.log('🔌 Connecting to database...');
    pool = await mssql.connect(config);
    console.log('✅ Connected to database');
    
    const userId = 66;
    
    // Step 1: Check current records
    console.log(`\n📋 Checking subscriptions for UserId = ${userId}...`);
    const checkRequest = pool.request();
    checkRequest.input('userId', mssql.Int, userId);
    
    const checkResult = await checkRequest.query(`
      SELECT 
        UserId,
        [plan],
        status,
        subscription_id,
        customer_id,
        payment_intent_id,
        current_period_start,
        current_period_end,
        started_at,
        updated_at
      FROM [dbo].[user_subscriptions]
      WHERE UserId = @userId
    `);
    
    console.log(`\n📊 Found ${checkResult.recordset.length} record(s) for UserId = ${userId}:`);
    console.log('─'.repeat(100));
    
    if (checkResult.recordset.length === 0) {
      console.log('No records found for this user.');
      return;
    }
    
    checkResult.recordset.forEach((record, index) => {
      console.log(`\nRecord ${index + 1}:`);
      console.log(`  UserId: ${record.UserId}`);
      console.log(`  Plan: ${record.plan || 'NULL'}`);
      console.log(`  Status: ${record.status || 'NULL'}`);
      console.log(`  Subscription ID: ${record.subscription_id || 'NULL'}`);
      console.log(`  Customer ID: ${record.customer_id || 'NULL'}`);
      console.log(`  Payment Intent ID: ${record.payment_intent_id || 'NULL'}`);
      console.log(`  Current Period Start: ${record.current_period_start || 'NULL'}`);
      console.log(`  Current Period End: ${record.current_period_end || 'NULL'}`);
      console.log(`  Started At: ${record.started_at || 'NULL'}`);
      console.log(`  Updated At: ${record.updated_at || 'NULL'}`);
    });
    
    // Step 2: Clear customer_ids
    console.log(`\n🗑️  Clearing customer_id values for UserId = ${userId}...`);
    const updateRequest = pool.request();
    updateRequest.input('userId', mssql.Int, userId);
    
    const updateResult = await updateRequest.query(`
      UPDATE [dbo].[user_subscriptions]
      SET customer_id = NULL,
          updated_at = SYSDATETIMEOFFSET()
      WHERE UserId = @userId
    `);
    
    console.log(`✅ Updated ${updateResult.rowsAffected[0]} record(s)`);
    
    // Step 3: Verify the update
    console.log(`\n🔍 Verifying customer_ids have been cleared...`);
    const verifyRequest = pool.request();
    verifyRequest.input('userId', mssql.Int, userId);
    
    const verifyResult = await verifyRequest.query(`
      SELECT 
        UserId,
        customer_id,
        updated_at
      FROM [dbo].[user_subscriptions]
      WHERE UserId = @userId
    `);
    
    console.log('\n📊 Updated records:');
    verifyResult.recordset.forEach((record, index) => {
      console.log(`  Record ${index + 1}:`);
      console.log(`    UserId: ${record.UserId}`);
      console.log(`    Customer ID: ${record.customer_id || 'NULL ✅'}`);
      console.log(`    Updated At: ${record.updated_at}`);
    });
    
    console.log('\n✅ All customer_ids cleared successfully!');
    
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

// Run the script
checkAndClearCustomerIds()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Script failed:', err);
    process.exit(1);
  });

