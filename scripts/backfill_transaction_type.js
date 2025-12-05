require('dotenv').config();
const { connectToDatabase, getPool } = require('../config/db');

async function backfillTransactionData() {
  console.log('🔄 Starting transaction data backfill...\n');
  
  try {
    await connectToDatabase();
    const pool = getPool();
    
    // Step 1: Get all Premium users without transaction_type
    console.log('📝 Step 1: Finding Premium users to backfill...');
    const usersToBackfill = await pool.request().query(`
      SELECT 
        us.UserId,
        us.[plan],
        us.status,
        us.subscription_id,
        us.customer_id,
        us.billing_interval,
        us.started_at,
        us.current_period_start,
        us.current_period_end,
        up.UserType
      FROM [dbo].[user_subscriptions] us
      INNER JOIN [dbo].[UserProfile] up ON us.UserId = up.UserID
      WHERE us.transaction_type IS NULL
        AND (us.status IN ('active', 'trialing', 'past_due') OR up.UserType = 'Premium')
    `);
    
    console.log(`   Found ${usersToBackfill.recordset.length} users to backfill\n`);
    
    if (usersToBackfill.recordset.length === 0) {
      console.log('✅ No users need backfilling. All done!');
      await pool.close();
      return;
    }
    
    // Step 2: Update user_subscriptions with transaction_type = 'activation'
    console.log('📝 Step 2: Updating user_subscriptions table...');
    const updateResult = await pool.request().query(`
      UPDATE [dbo].[user_subscriptions]
      SET 
        transaction_type = 'activation',
        transaction_date = COALESCE(started_at, current_period_start, SYSDATETIMEOFFSET())
      WHERE transaction_type IS NULL
        AND status IN ('active', 'trialing', 'past_due', 'incomplete')
    `);
    
    console.log(`   Updated ${updateResult.rowsAffected[0]} records\n`);
    
    // Step 3: Insert records into subscription_transactions for history
    console.log('📝 Step 3: Creating transaction history records...');
    
    let insertedCount = 0;
    for (const user of usersToBackfill.recordset) {
      try {
        await pool.request()
          .input('userId', user.UserId)
          .input('subscriptionId', user.subscription_id)
          .input('transactionType', 'activation')
          .input('transactionDate', user.started_at || user.current_period_start || new Date())
          .input('toPlan', user.plan)
          .input('billingInterval', user.billing_interval)
          .input('paymentGateway', 'stripe') // Assume stripe for existing users
          .query(`
            INSERT INTO [dbo].[subscription_transactions]
            (UserId, subscription_id, transaction_type, transaction_date, to_plan, billing_interval, payment_gateway)
            VALUES (@userId, @subscriptionId, @transactionType, @transactionDate, @toPlan, @billingInterval, @paymentGateway)
          `);
        insertedCount++;
      } catch (insertError) {
        console.warn(`   ⚠️  Could not insert transaction for user ${user.UserId}: ${insertError.message}`);
      }
    }
    
    console.log(`   Inserted ${insertedCount} transaction records\n`);
    
    // Step 4: Verify backfill
    console.log('🔍 Verifying backfill...\n');
    
    const verifySubscriptions = await pool.request().query(`
      SELECT 
        COUNT(*) as total_premium,
        SUM(CASE WHEN transaction_type IS NOT NULL THEN 1 ELSE 0 END) as with_transaction_type,
        SUM(CASE WHEN transaction_type IS NULL THEN 1 ELSE 0 END) as without_transaction_type
      FROM [dbo].[user_subscriptions]
      WHERE status IN ('active', 'trialing', 'past_due', 'incomplete')
    `);
    
    const verifyTransactions = await pool.request().query(`
      SELECT COUNT(*) as total_transactions
      FROM [dbo].[subscription_transactions]
    `);
    
    console.log('✅ Backfill completed successfully!');
    console.log('\nSummary:');
    console.table(verifySubscriptions.recordset);
    console.log(`\nTotal transaction records: ${verifyTransactions.recordset[0].total_transactions}`);
    
    await pool.close();
    
  } catch (error) {
    console.error('\n❌ Backfill failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the backfill
backfillTransactionData()
  .then(() => {
    console.log('\n✅ Backfill script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Backfill script failed:', error);
    process.exit(1);
  });

