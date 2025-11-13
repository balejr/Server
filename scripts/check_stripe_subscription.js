// Script to check Stripe subscription status and sync with database
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

async function checkAndSyncSubscription() {
  let pool;
  
  try {
    console.log('🔌 Connecting to database...');
    pool = await mssql.connect(config);
    console.log('✅ Connected to database');
    
    const userId = 66;
    const subscriptionId = 'sub_1SSOTMAirABIHL4jmhpfQW...'; // Partial ID from image
    const customerId = 'cus_TPdkekdDVsoxo0';
    
    // Step 1: Get subscription from database
    console.log(`\n📋 Checking database for UserId = ${userId}...`);
    const dbRequest = pool.request();
    dbRequest.input('userId', mssql.Int, userId);
    
    const dbResult = await dbRequest.query(`
      SELECT 
        UserId,
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
    
    if (dbResult.recordset.length === 0) {
      console.log('❌ No subscription found in database for UserId =', userId);
      return;
    }
    
    const dbRecord = dbResult.recordset[0];
    console.log('\n📊 Database Record:');
    console.log(`  Subscription ID: ${dbRecord.subscription_id || 'NULL'}`);
    console.log(`  Customer ID: ${dbRecord.customer_id || 'NULL'}`);
    console.log(`  Status: ${dbRecord.status || 'NULL'}`);
    console.log(`  Payment Intent ID: ${dbRecord.payment_intent_id || 'NULL'}`);
    
    // Step 2: Check Stripe subscription
    if (!dbRecord.subscription_id) {
      console.log('\n⚠️ No subscription_id in database, cannot check Stripe');
      return;
    }
    
    console.log(`\n🔍 Checking Stripe subscription: ${dbRecord.subscription_id}...`);
    try {
      const stripeSubscription = await stripe.subscriptions.retrieve(dbRecord.subscription_id, {
        expand: ['latest_invoice.payment_intent']
      });
      
      console.log('\n📊 Stripe Subscription:');
      console.log(`  Subscription ID: ${stripeSubscription.id}`);
      console.log(`  Customer ID: ${stripeSubscription.customer}`);
      console.log(`  Status: ${stripeSubscription.status}`);
      if (stripeSubscription.current_period_start) {
        console.log(`  Current Period Start: ${new Date(stripeSubscription.current_period_start * 1000).toISOString()}`);
      } else {
        console.log(`  Current Period Start: NULL (incomplete subscription)`);
      }
      if (stripeSubscription.current_period_end) {
        console.log(`  Current Period End: ${new Date(stripeSubscription.current_period_end * 1000).toISOString()}`);
      } else {
        console.log(`  Current Period End: NULL (incomplete subscription)`);
      }
      
      if (stripeSubscription.latest_invoice) {
        const invoice = typeof stripeSubscription.latest_invoice === 'string'
          ? await stripe.invoices.retrieve(stripeSubscription.latest_invoice, { expand: ['payment_intent'] })
          : stripeSubscription.latest_invoice;
        
        console.log(`  Invoice Status: ${invoice.status}`);
        console.log(`  Invoice ID: ${invoice.id}`);
        
        if (invoice.payment_intent) {
          const paymentIntent = typeof invoice.payment_intent === 'string'
            ? await stripe.paymentIntents.retrieve(invoice.payment_intent)
            : invoice.payment_intent;
          console.log(`  Payment Intent ID: ${paymentIntent.id}`);
          console.log(`  Payment Intent Status: ${paymentIntent.status}`);
        }
      }
      
      // Step 3: Compare and sync
      console.log('\n🔄 Comparing database vs Stripe...');
      const statusMismatch = dbRecord.status !== stripeSubscription.status;
      const customerMismatch = dbRecord.customer_id !== stripeSubscription.customer;
      
      if (statusMismatch || customerMismatch) {
        console.log('⚠️ Mismatch detected!');
        if (statusMismatch) {
          console.log(`  Status: DB="${dbRecord.status}" vs Stripe="${stripeSubscription.status}"`);
        }
        if (customerMismatch) {
          console.log(`  Customer: DB="${dbRecord.customer_id}" vs Stripe="${stripeSubscription.customer}"`);
        }
        
        // Update database to match Stripe
        console.log('\n🔄 Updating database to match Stripe...');
        const updateRequest = pool.request();
        updateRequest.input('userId', mssql.Int, userId);
        updateRequest.input('status', mssql.NVarChar(32), stripeSubscription.status);
        updateRequest.input('customerId', mssql.NVarChar(128), stripeSubscription.customer);
        updateRequest.input('subscriptionId', mssql.NVarChar(128), stripeSubscription.id);
        
        let currentPeriodStart = null;
        let currentPeriodEnd = null;
        
        if (stripeSubscription.current_period_start) {
          currentPeriodStart = new Date(stripeSubscription.current_period_start * 1000).toISOString();
          updateRequest.input('currentPeriodStart', mssql.DateTimeOffset, currentPeriodStart);
        }
        if (stripeSubscription.current_period_end) {
          currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000).toISOString();
          updateRequest.input('currentPeriodEnd', mssql.DateTimeOffset, currentPeriodEnd);
        }
        
        const updateFields = [
          'status = @status',
          'customer_id = @customerId',
          'subscription_id = @subscriptionId',
          'updated_at = SYSDATETIMEOFFSET()'
        ];
        
        if (currentPeriodStart) {
          updateFields.push('current_period_start = @currentPeriodStart');
        }
        if (currentPeriodEnd) {
          updateFields.push('current_period_end = @currentPeriodEnd');
        }
        
        await updateRequest.query(`
          UPDATE [dbo].[user_subscriptions]
          SET ${updateFields.join(', ')}
          WHERE UserId = @userId
        `);
        
        console.log('✅ Database updated to match Stripe');
      } else {
        console.log('✅ Database and Stripe are in sync');
      }
      
      // Step 4: Check why subscription is incomplete
      if (stripeSubscription.status === 'incomplete') {
        console.log('\n⚠️ Subscription is INCOMPLETE in Stripe');
        console.log('   This usually means the payment was not completed.');
        console.log('   Possible reasons:');
        console.log('   1. PaymentIntent was not confirmed');
        console.log('   2. Payment method was not attached');
        console.log('   3. Payment failed');
        
        if (stripeSubscription.latest_invoice) {
          const invoice = typeof stripeSubscription.latest_invoice === 'string'
            ? await stripe.invoices.retrieve(stripeSubscription.latest_invoice)
            : stripeSubscription.latest_invoice;
          
          console.log(`\n   Invoice Status: ${invoice.status}`);
          console.log(`   Invoice Amount Due: $${(invoice.amount_due / 100).toFixed(2)}`);
          
          if (invoice.status === 'open' || invoice.status === 'draft') {
            console.log('\n   💡 Recommendation:');
            console.log('   - The invoice is open/draft, which means payment is pending');
            console.log('   - User needs to complete the payment to activate subscription');
            console.log('   - Or cancel this subscription and create a new one');
          }
        }
      }
      
    } catch (stripeErr) {
      console.error('❌ Error retrieving subscription from Stripe:', stripeErr.message);
      if (stripeErr.code === 'resource_missing') {
        console.log('   Subscription does not exist in Stripe');
      }
    }
    
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
checkAndSyncSubscription()
  .then(() => {
    console.log('\n✨ Script completed');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Script failed:', err);
    process.exit(1);
  });

