/**
 * Test Script: Check what subscription status endpoint returns
 * Tests the subscription status logic to see why dates aren't being returned
 * 
 * Usage: node scripts/test-subscription-status.js <userId>
 */

require('dotenv').config();
const mssql = require('mssql');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const config = {
  server: process.env.DB_HOST || process.env.AZURE_SQL_SERVER,
  database: process.env.DB_NAME || process.env.AZURE_SQL_DATABASE,
  authentication: {
    type: 'default',
    options: {
      userName: process.env.DB_USER || process.env.AZURE_SQL_USER,
      password: process.env.DB_PASSWORD || process.env.AZURE_SQL_PASSWORD,
    }
  },
  options: {
    encrypt: true,
    trustServerCertificate: false,
    enableArithAbort: true,
    requestTimeout: 30000,
  }
};

async function testSubscriptionStatus(userId) {
  let pool;
  
  try {
    console.log('🔄 Connecting to Azure SQL Database...');
    
    if (!config.server || !config.database) {
      throw new Error('Database configuration missing.');
    }
    
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required.');
    }
    
    pool = await mssql.connect(config);
    console.log('✅ Connected to database');
    console.log('');
    
    // Get subscription from database
    console.log(`📝 Fetching subscription for user ${userId}...`);
    const subscriptionRequest = pool.request();
    subscriptionRequest.input('userId', mssql.Int, parseInt(userId, 10));
    
    const subscriptionResult = await subscriptionRequest.query(`
      SELECT 
        [plan],
        status,
        current_period_start,
        current_period_end,
        subscription_id,
        customer_id
      FROM [dbo].[user_subscriptions]
      WHERE UserId = @userId
    `);
    
    const subscription = subscriptionResult.recordset[0];
    
    if (!subscription) {
      console.log('❌ No subscription found for this user');
      return;
    }
    
    console.log('📊 Database Subscription:');
    console.log(`   subscription_id: ${subscription.subscription_id || 'NULL'}`);
    console.log(`   status: ${subscription.status || 'NULL'}`);
    console.log(`   current_period_start: ${subscription.current_period_start || 'NULL'}`);
    console.log(`   current_period_end: ${subscription.current_period_end || 'NULL'}`);
    console.log('');
    
    // Check if we should fetch from Stripe
    const shouldFetchFromStripe = subscription.subscription_id && 
                                   (subscription.status === 'active' || subscription.status === 'trialing');
    
    console.log(`🔍 Should fetch from Stripe: ${shouldFetchFromStripe}`);
    console.log('');
    
    if (shouldFetchFromStripe && subscription.subscription_id) {
      console.log(`📝 Fetching from Stripe: ${subscription.subscription_id}...`);
      
      try {
        // Fetch subscription from Stripe
        const stripeSubscription = await stripe.subscriptions.retrieve(subscription.subscription_id, {
          expand: ['latest_invoice']
        });
        
        console.log('📊 Stripe Subscription:');
        console.log(`   status: ${stripeSubscription.status}`);
        console.log(`   current_period_start: ${stripeSubscription.current_period_start || 'NULL'}`);
        console.log(`   current_period_end: ${stripeSubscription.current_period_end || 'NULL'}`);
        console.log(`   created: ${new Date(stripeSubscription.created * 1000).toISOString()}`);
        console.log(`   current_period_start (raw): ${stripeSubscription.current_period_start}`);
        console.log(`   current_period_end (raw): ${stripeSubscription.current_period_end}`);
        console.log('');
        
        // Check latest invoice
        if (stripeSubscription.latest_invoice) {
          const invoiceId = typeof stripeSubscription.latest_invoice === 'string' 
            ? stripeSubscription.latest_invoice 
            : stripeSubscription.latest_invoice.id;
          
          console.log(`📝 Checking latest invoice: ${invoiceId}...`);
          const invoice = await stripe.invoices.retrieve(invoiceId);
          
          console.log('📊 Latest Invoice:');
          console.log(`   status: ${invoice.status}`);
          console.log(`   period_start: ${invoice.period_start || 'NULL'}`);
          console.log(`   period_end: ${invoice.period_end || 'NULL'}`);
          console.log(`   period_start (raw): ${invoice.period_start}`);
          console.log(`   period_end (raw): ${invoice.period_end}`);
          
          if (invoice.period_start && invoice.period_end) {
            console.log(`   period_start (ISO): ${new Date(invoice.period_start * 1000).toISOString()}`);
            console.log(`   period_end (ISO): ${new Date(invoice.period_end * 1000).toISOString()}`);
          }
          console.log('');
        }
        
        // If subscription doesn't have dates but invoice does, update subscription
        if (!stripeSubscription.current_period_end && stripeSubscription.latest_invoice) {
          const invoiceId = typeof stripeSubscription.latest_invoice === 'string' 
            ? stripeSubscription.latest_invoice 
            : stripeSubscription.latest_invoice.id;
          
          const invoice = await stripe.invoices.retrieve(invoiceId);
          
          if (invoice.period_start && invoice.period_end) {
            console.log('✅ Found dates in invoice, updating database...');
            
            const periodStartISO = new Date(invoice.period_start * 1000).toISOString();
            const periodEndISO = new Date(invoice.period_end * 1000).toISOString();
            
            const updateRequest = pool.request();
            updateRequest.input('userId', mssql.Int, parseInt(userId, 10));
            updateRequest.input('periodStart', mssql.DateTimeOffset, periodStartISO);
            updateRequest.input('periodEnd', mssql.DateTimeOffset, periodEndISO);
            
            await updateRequest.query(`
              UPDATE [dbo].[user_subscriptions]
              SET 
                current_period_start = @periodStart,
                current_period_end = @periodEnd,
                updated_at = SYSDATETIMEOFFSET()
              WHERE UserId = @userId
            `);
            
            console.log(`✅ Updated database with dates from invoice`);
            console.log(`   Start: ${periodStartISO}`);
            console.log(`   End: ${periodEndISO}`);
          }
        } else if (stripeSubscription.current_period_end) {
          console.log('✅ Subscription has dates in Stripe, updating database...');
          
          const periodStartISO = stripeSubscription.current_period_start 
            ? new Date(stripeSubscription.current_period_start * 1000).toISOString()
            : null;
          const periodEndISO = new Date(stripeSubscription.current_period_end * 1000).toISOString();
          
          const updateRequest = pool.request();
          updateRequest.input('userId', mssql.Int, parseInt(userId, 10));
          updateRequest.input('periodEnd', mssql.DateTimeOffset, periodEndISO);
          
          const updateFields = ['current_period_end = @periodEnd', 'updated_at = SYSDATETIMEOFFSET()'];
          
          if (periodStartISO) {
            updateRequest.input('periodStart', mssql.DateTimeOffset, periodStartISO);
            updateFields.push('current_period_start = @periodStart');
          }
          
          await updateRequest.query(`
            UPDATE [dbo].[user_subscriptions]
            SET ${updateFields.join(', ')}
            WHERE UserId = @userId
          `);
          
          console.log(`✅ Updated database with dates from Stripe subscription`);
          console.log(`   Start: ${periodStartISO || 'NULL'}`);
          console.log(`   End: ${periodEndISO}`);
        }
        
      } catch (stripeErr) {
        console.error('❌ Error fetching from Stripe:', stripeErr.message);
      }
    }
    
  } catch (error) {
    console.error('');
    console.error('❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log('');
      console.log('🔌 Database connection closed');
    }
  }
}

// Get userId from command line args
const userId = process.argv[2];

if (!userId) {
  console.error('Usage: node scripts/test-subscription-status.js <userId>');
  console.error('Example: node scripts/test-subscription-status.js 66');
  process.exit(1);
}

testSubscriptionStatus(userId)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });

