// Script to check PaymentIntent status
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function checkPaymentIntent() {
  try {
    const paymentIntentId = 'pi_3SSoTNAirABIHL4j0njaDYHh';
    
    console.log(`🔍 Checking PaymentIntent: ${paymentIntentId}...`);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    console.log('\n📊 PaymentIntent Details:');
    console.log(`  ID: ${paymentIntent.id}`);
    console.log(`  Status: ${paymentIntent.status}`);
    console.log(`  Amount: $${(paymentIntent.amount / 100).toFixed(2)} ${paymentIntent.currency.toUpperCase()}`);
    console.log(`  Customer: ${paymentIntent.customer || 'NULL'}`);
    console.log(`  Created: ${new Date(paymentIntent.created * 1000).toISOString()}`);
    
    if (paymentIntent.last_payment_error) {
      console.log(`\n❌ Last Payment Error:`);
      console.log(`  Message: ${paymentIntent.last_payment_error.message}`);
      console.log(`  Type: ${paymentIntent.last_payment_error.type}`);
      console.log(`  Code: ${paymentIntent.last_payment_error.code || 'N/A'}`);
    }
    
    if (paymentIntent.payment_method) {
      console.log(`\n💳 Payment Method: ${paymentIntent.payment_method}`);
    }
    
    console.log(`\n📋 Next Actions:`);
    if (paymentIntent.status === 'requires_payment_method') {
      console.log('  ⚠️ Payment method is required');
      console.log('  → User needs to provide a payment method');
    } else if (paymentIntent.status === 'requires_confirmation') {
      console.log('  ⚠️ Payment requires confirmation');
      console.log('  → Payment method attached but not confirmed');
    } else if (paymentIntent.status === 'requires_action') {
      console.log('  ⚠️ Payment requires action (3D Secure, etc.)');
      console.log('  → User needs to complete authentication');
    } else if (paymentIntent.status === 'processing') {
      console.log('  ⏳ Payment is processing');
    } else if (paymentIntent.status === 'succeeded') {
      console.log('  ✅ Payment succeeded');
    } else if (paymentIntent.status === 'canceled') {
      console.log('  ❌ Payment was canceled');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

checkPaymentIntent()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });

