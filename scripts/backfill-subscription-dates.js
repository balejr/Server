/**
 * Backfill Script: Update subscriptions with NULL billing dates
 * Fetches current_period_start and current_period_end from Stripe for subscriptions missing these dates
 * 
 * Usage: node scripts/backfill-subscription-dates.js
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

async function backfillDates() {
  let pool;
  
  try {
    console.log('🔄 Connecting to Azure SQL Database...');
    console.log(`   Server: ${config.server}`);
    console.log(`   Database: ${config.database}`);
    
    if (!config.server || !config.database) {
      throw new Error('Database configuration missing. Please set DB_HOST/DB_NAME or AZURE_SQL_SERVER/AZURE_SQL_DATABASE environment variables.');
    }
    
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required.');
    }
    
    pool = await mssql.connect(config);
    console.log('✅ Connected to database');
    console.log('');
    
    // Find subscriptions with NULL billing dates OR invalid dates (start = end)
    console.log('📝 Finding subscriptions with NULL or invalid billing dates...');
    const findRequest = pool.request();
    const result = await findRequest.query(`
      SELECT 
        UserId,
        subscription_id,
        customer_id,
        status,
        current_period_start,
        current_period_end
      FROM [dbo].[user_subscriptions]
      WHERE subscription_id IS NOT NULL
        AND (status = 'active' OR status = 'trialing')
        AND (
          current_period_start IS NULL 
          OR current_period_end IS NULL 
          OR DATEDIFF(SECOND, current_period_start, current_period_end) = 0
        )
    `);
    
    const subscriptionsToUpdate = result.recordset;
    console.log(`✅ Found ${subscriptionsToUpdate.length} subscription(s) with NULL billing dates`);
    console.log('');
    
    if (subscriptionsToUpdate.length === 0) {
      console.log('✅ No subscriptions need updating. All billing dates are populated.');
      return;
    }
    
    // Process each subscription
    let updated = 0;
    let failed = 0;
    
    for (const sub of subscriptionsToUpdate) {
      try {
        console.log(`📝 Processing subscription ${sub.subscription_id} for user ${sub.UserId}...`);
        
        // Fetch subscription from Stripe with expanded invoice and price
        const stripeSubscription = await stripe.subscriptions.retrieve(sub.subscription_id, {
          expand: ['latest_invoice', 'items.data.price']
        });
        
        console.log(`   Status in Stripe: ${stripeSubscription.status}`);
        console.log(`   Status in DB: ${sub.status}`);
        console.log(`   current_period_start: ${stripeSubscription.current_period_start || 'NULL'}`);
        console.log(`   current_period_end: ${stripeSubscription.current_period_end || 'NULL'}`);
        
        // Check if dates exist but are null/undefined
        let currentPeriodStart = stripeSubscription.current_period_start;
        let currentPeriodEnd = stripeSubscription.current_period_end;
        
        // If dates are missing, try to get them from the latest invoice
        if ((!currentPeriodStart || !currentPeriodEnd) && stripeSubscription.latest_invoice) {
          const invoiceId = typeof stripeSubscription.latest_invoice === 'string' 
            ? stripeSubscription.latest_invoice 
            : stripeSubscription.latest_invoice.id;
          
          console.log(`   📝 Checking latest invoice ${invoiceId} for dates...`);
          const invoice = await stripe.invoices.retrieve(invoiceId);
          
          if (invoice.period_start && invoice.period_end) {
            let periodStart = invoice.period_start;
            let periodEnd = invoice.period_end;
            
            // If dates are the same (invalid for monthly subscription), calculate proper end date
            if (periodStart === periodEnd) {
              console.log(`   ⚠️ Invoice has same start/end dates, calculating monthly period_end...`);
              
              // Try to get billing interval from subscription items
              if (stripeSubscription.items && stripeSubscription.items.data && stripeSubscription.items.data.length > 0) {
                const price = stripeSubscription.items.data[0].price;
                
                // If price has interval, use it; otherwise default to 1 month
                const interval = price?.recurring?.interval || 'month';
                const intervalCount = price?.recurring?.interval_count || 1;
                
                // Calculate period_end based on interval
                let secondsToAdd = 0;
                if (interval === 'month') {
                  // Approximate: 30.44 days per month on average
                  secondsToAdd = intervalCount * 30.44 * 24 * 60 * 60;
                } else if (interval === 'year') {
                  secondsToAdd = intervalCount * 365.25 * 24 * 60 * 60;
                } else if (interval === 'week') {
                  secondsToAdd = intervalCount * 7 * 24 * 60 * 60;
                } else if (interval === 'day') {
                  secondsToAdd = intervalCount * 24 * 60 * 60;
                }
                
                periodEnd = periodStart + Math.round(secondsToAdd);
                console.log(`   Calculated period_end: ${intervalCount} ${interval}(s) from period_start`);
              } else {
                // Fallback: add 1 month (30 days)
                periodEnd = periodStart + (30 * 24 * 60 * 60);
                console.log(`   Using fallback: 30 days from period_start`);
              }
            }
            
            currentPeriodStart = periodStart;
            currentPeriodEnd = periodEnd;
            console.log(`   ✅ Found dates in invoice: start=${new Date(currentPeriodStart * 1000).toISOString()}, end=${new Date(currentPeriodEnd * 1000).toISOString()}`);
          }
        }
        
        if (!currentPeriodStart || !currentPeriodEnd) {
          if (stripeSubscription.status === 'incomplete' || stripeSubscription.status === 'incomplete_expired') {
            console.warn(`   ⚠️ Subscription is incomplete in Stripe - billing dates not available until payment succeeds`);
            console.warn(`   ⚠️ Database shows status '${sub.status}' but Stripe shows '${stripeSubscription.status}'`);
            console.warn(`   ⚠️ Consider updating database status to match Stripe or complete the payment`);
          } else {
            console.warn(`   ⚠️ Stripe subscription missing billing dates despite status '${stripeSubscription.status}'`);
            console.warn(`   ⚠️ This subscription may need to be recreated or the payment completed`);
          }
          failed++;
          continue;
        }
        
        // Convert to ISO strings
        const periodStartISO = new Date(currentPeriodStart * 1000).toISOString();
        const periodEndISO = new Date(currentPeriodEnd * 1000).toISOString();
        
        console.log(`   ✅ Retrieved dates from Stripe:`);
        console.log(`      Start: ${periodStartISO}`);
        console.log(`      End: ${periodEndISO}`);
        
        // Update database
        const updateRequest = pool.request();
        updateRequest.input('userId', mssql.Int, sub.UserId);
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
        
        console.log(`   ✅ Updated database`);
        updated++;
        console.log('');
        
        // Rate limiting - wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (err) {
        console.error(`   ❌ Error processing subscription ${sub.subscription_id}:`, err.message);
        failed++;
        console.log('');
      }
    }
    
    console.log('');
    console.log('✅ Backfill complete!');
    console.log(`   Updated: ${updated}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Total: ${subscriptionsToUpdate.length}`);
    
  } catch (error) {
    console.error('');
    console.error('❌ Backfill failed:', error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    if (error.stack) {
      console.error('');
      console.error('Stack trace:');
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

// Run if called directly
if (require.main === module) {
  backfillDates()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Backfill failed:', error);
      process.exit(1);
    });
}

module.exports = { backfillDates };

