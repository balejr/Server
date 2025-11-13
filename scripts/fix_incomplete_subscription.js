// Script to fix incomplete subscription when PaymentIntent has succeeded
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

async function fixIncompleteSubscription() {
  let pool;
  
  try {
    console.log('🔌 Connecting to database...');
    pool = await mssql.connect(config);
    console.log('✅ Connected to database');
    
    const userId = 66;
    const subscriptionId = 'sub_1SSoTMAirABIHL4jmhpfQWeu';
    
    // Step 1: Retrieve subscription from Stripe
    console.log(`\n🔍 Retrieving subscription from Stripe...`);
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice.payment_intent']
    });
    
    console.log(`  Status: ${subscription.status}`);
    
    // Step 2: Check PaymentIntent status
    let paymentIntent = null;
    let invoice = null;
    
    if (subscription.latest_invoice) {
      invoice = typeof subscription.latest_invoice === 'string'
        ? await stripe.invoices.retrieve(subscription.latest_invoice, { expand: ['payment_intent'] })
        : subscription.latest_invoice;
      
      console.log(`\n📄 Invoice Details:`);
      console.log(`  Invoice ID: ${invoice.id}`);
      console.log(`  Invoice Status: ${invoice.status}`);
      console.log(`  Amount Due: $${(invoice.amount_due / 100).toFixed(2)}`);
      
      if (invoice.payment_intent) {
        paymentIntent = typeof invoice.payment_intent === 'string'
          ? await stripe.paymentIntents.retrieve(invoice.payment_intent)
          : invoice.payment_intent;
        
        console.log(`\n💳 PaymentIntent Status: ${paymentIntent.status}`);
        console.log(`  PaymentIntent ID: ${paymentIntent.id}`);
      } else {
        console.log(`\n⚠️ Invoice has no PaymentIntent attached`);
      }
    }
    
    // Step 3: If PaymentIntent succeeded but subscription is incomplete, try to fix
    if (paymentIntent && paymentIntent.status === 'succeeded' && subscription.status === 'incomplete') {
      console.log('\n⚠️ PaymentIntent succeeded but subscription is still incomplete');
      
      // Try to pay the invoice if it's open
      if (invoice && invoice.status === 'open' && paymentIntent.status === 'succeeded') {
        console.log('   Attempting to pay the invoice...');
        try {
          // Stripe should automatically pay invoices when PaymentIntent succeeds
          // But sometimes we need to manually trigger it
          const paidInvoice = await stripe.invoices.pay(invoice.id);
          console.log(`   Invoice paid, new status: ${paidInvoice.status}`);
          
          // Wait a moment for Stripe to process
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (payErr) {
          console.log(`   Could not pay invoice: ${payErr.message}`);
          if (payErr.code === 'invoice_already_paid') {
            console.log('   Invoice is already paid, Stripe may be processing...');
          }
        }
      }
      
      console.log('   Refreshing subscription...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const refreshedSubscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['latest_invoice.payment_intent']
      });
      
      console.log(`  Refreshed Status: ${refreshedSubscription.status}`);
      
      if (refreshedSubscription.status === 'active') {
        console.log('  ✅ Subscription is now active!');
        
        // Update database
        const updateRequest = pool.request();
        updateRequest.input('userId', mssql.Int, userId);
        updateRequest.input('status', mssql.NVarChar(32), 'active');
        updateRequest.input('subscriptionId', mssql.NVarChar(128), refreshedSubscription.id);
        updateRequest.input('customerId', mssql.NVarChar(128), refreshedSubscription.customer);
        
        let currentPeriodStart = null;
        let currentPeriodEnd = null;
        
        if (refreshedSubscription.current_period_start) {
          currentPeriodStart = new Date(refreshedSubscription.current_period_start * 1000).toISOString();
          updateRequest.input('currentPeriodStart', mssql.DateTimeOffset, currentPeriodStart);
        }
        if (refreshedSubscription.current_period_end) {
          currentPeriodEnd = new Date(refreshedSubscription.current_period_end * 1000).toISOString();
          updateRequest.input('currentPeriodEnd', mssql.DateTimeOffset, currentPeriodEnd);
        }
        
        const updateFields = [
          'status = @status',
          'subscription_id = @subscriptionId',
          'customer_id = @customerId',
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
        
        console.log('\n✅ Database updated with active subscription and billing dates');
      } else {
        console.log(`\n⚠️ Subscription is still ${refreshedSubscription.status}`);
        console.log('   This may require manual intervention in Stripe dashboard');
        console.log('   Or the webhook needs to process the payment_succeeded event');
      }
    } else if (subscription.status === 'active') {
      console.log('\n✅ Subscription is already active');
      
      // Still update database with billing dates if missing
      const updateRequest = pool.request();
      updateRequest.input('userId', mssql.Int, userId);
      updateRequest.input('subscriptionId', mssql.NVarChar(128), subscription.id);
      updateRequest.input('customerId', mssql.NVarChar(128), subscription.customer);
      
      let currentPeriodStart = null;
      let currentPeriodEnd = null;
      
      if (subscription.current_period_start) {
        currentPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
        updateRequest.input('currentPeriodStart', mssql.DateTimeOffset, currentPeriodStart);
      }
      if (subscription.current_period_end) {
        currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
        updateRequest.input('currentPeriodEnd', mssql.DateTimeOffset, currentPeriodEnd);
      }
      
      const updateFields = [
        'subscription_id = @subscriptionId',
        'customer_id = @customerId',
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
      
      console.log('✅ Database updated with billing dates');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error('Stack:', err.stack);
  } finally {
    if (pool) {
      await pool.close();
      console.log('\n🔌 Database connection closed');
    }
  }
}

fixIncompleteSubscription()
  .then(() => {
    console.log('\n✨ Script completed');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Script failed:', err);
    process.exit(1);
  });

