// Script to attach PaymentIntent to invoice and pay it
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function attachPaymentToInvoice() {
  try {
    const subscriptionId = 'sub_1SSoTMAirABIHL4jmhpfQWeu';
    const paymentIntentId = 'pi_3SSoTNAirABIHL4j0njaDYHh';
    
    console.log('🔍 Retrieving subscription...');
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice']
    });
    
    if (!subscription.latest_invoice) {
      console.log('❌ No invoice found');
      return;
    }
    
    const invoice = typeof subscription.latest_invoice === 'string'
      ? await stripe.invoices.retrieve(subscription.latest_invoice)
      : subscription.latest_invoice;
    
    console.log(`\n📄 Invoice: ${invoice.id}`);
    console.log(`  Status: ${invoice.status}`);
    console.log(`  Payment Intent: ${invoice.payment_intent || 'NULL'}`);
    
    // Check PaymentIntent
    console.log(`\n💳 Checking PaymentIntent: ${paymentIntentId}...`);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    console.log(`  Status: ${paymentIntent.status}`);
    console.log(`  Customer: ${paymentIntent.customer}`);
    console.log(`  Amount: $${(paymentIntent.amount / 100).toFixed(2)}`);
    
    if (paymentIntent.status === 'succeeded' && invoice.status === 'open') {
      console.log('\n⚠️ PaymentIntent succeeded but invoice is still open');
      console.log('   The PaymentIntent was not attached to the invoice');
      console.log('\n💡 Solution Options:');
      console.log('   1. Cancel this incomplete subscription');
      console.log('   2. Create a new subscription (the payment flow will work correctly)');
      console.log('   3. Manually mark invoice as paid in Stripe dashboard (not recommended)');
      console.log('\n   The issue is that the PaymentIntent was created separately');
      console.log('   and never linked to the subscription invoice.');
      console.log('   This happens when the payment flow doesn\'t complete properly.');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

attachPaymentToInvoice()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });

