/**
 * Script to create Stripe Product and recurring Price for FitNext Premium
 * Run this once to set up the subscription product in Stripe
 * 
 * Usage: node scripts/create-stripe-product.js
 * 
 * Make sure STRIPE_SECRET_KEY is set in your environment
 */

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createProductAndPrice() {
  try {
    console.log('🔄 Creating Stripe Product and Price...');

    // Create Product
    const product = await stripe.products.create({
      name: 'FitNext Premium',
      description: 'Monthly subscription to FitNext Premium features',
      metadata: {
        app: 'FitNext',
        plan: 'premium'
      }
    });
    console.log('✅ Product created:', product.id);

    // Create recurring Price ($9.99/month)
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 999, // $9.99 in cents
      currency: 'usd',
      recurring: {
        interval: 'month',
        interval_count: 1
      },
      metadata: {
        plan: 'premium',
        app: 'FitNext'
      }
    });
    console.log('✅ Price created:', price.id);

    console.log('\n📋 Configuration:');
    console.log('Add this to your environment variables:');
    console.log(`STRIPE_PRICE_ID=${price.id}`);
    console.log(`\nProduct ID: ${product.id}`);
    console.log(`Price ID: ${price.id}`);

    return { productId: product.id, priceId: price.id };
  } catch (error) {
    console.error('❌ Error creating product/price:', error.message);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  createProductAndPrice()
    .then(() => {
      console.log('\n✅ Setup complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    });
}

module.exports = { createProductAndPrice };


