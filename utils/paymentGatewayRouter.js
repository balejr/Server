/**
 * Payment Gateway Router
 * Determines which payment gateway (Stripe, Apple Pay, Google Pay) to use for a user
 * based on their original payment method
 */

const { getPool } = require('../config/db');
const mssql = require('mssql');

/**
 * Get the payment gateway for a user
 * @param {number} userId - User ID
 * @returns {Promise<{gateway: string, customerId: string, subscriptionId: string, paymentMethod: string}>}
 */
async function getPaymentGateway(userId) {
  const pool = getPool();
  
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  
  // Query user's subscription details
  const result = await pool.request()
    .input('userId', mssql.Int, parseInt(userId, 10))
    .query(`
      SELECT 
        customer_id,
        subscription_id,
        payment_intent_id,
        status,
        [plan],
        billing_interval
      FROM [dbo].[user_subscriptions]
      WHERE UserId = @userId
    `);
  
  if (result.recordset.length === 0) {
    throw new Error(`No subscription found for user ${userId}`);
  }
  
  const subscription = result.recordset[0];
  
  // Determine gateway from customer_id or payment method
  let gateway = 'stripe'; // Default to Stripe
  let paymentMethod = 'card'; // Default payment method
  
  // Check if this is an Apple Pay subscription
  // Apple Pay subscriptions typically don't have a Stripe customer_id
  // or have specific metadata indicating Apple IAP
  if (!subscription.customer_id || subscription.customer_id.startsWith('apple_')) {
    gateway = 'apple_pay';
    paymentMethod = 'apple_pay';
  } else if (subscription.customer_id.startsWith('cus_')) {
    // Stripe customer ID format
    gateway = 'stripe';
    
    // Try to determine payment method from payment_intent if available
    if (subscription.payment_intent_id) {
      // Could query Stripe API here to get actual payment method
      // For now, assume card unless we have other indicators
      paymentMethod = 'card';
    }
  }
  
  return {
    gateway,
    customerId: subscription.customer_id,
    subscriptionId: subscription.subscription_id,
    paymentMethod,
    currentPlan: subscription.plan,
    currentBillingInterval: subscription.billing_interval,
    status: subscription.status
  };
}

/**
 * Validate that a gateway is supported
 * @param {string} gateway - Gateway name ('stripe', 'apple_pay', 'google_pay')
 * @returns {boolean}
 */
function isGatewaySupported(gateway) {
  const supportedGateways = ['stripe', 'apple_pay']; // Google Pay coming soon
  return supportedGateways.includes(gateway);
}

/**
 * Get gateway-specific configuration
 * @param {string} gateway - Gateway name
 * @returns {object} Gateway configuration
 */
function getGatewayConfig(gateway) {
  switch (gateway) {
    case 'stripe':
      return {
        name: 'Stripe',
        supportsProration: true,
        supportsPause: true,
        supportsImmediateCancellation: false, // We only do end-of-period
        requiresNativeSDK: false
      };
    case 'apple_pay':
      return {
        name: 'Apple In-App Purchase',
        supportsProration: false, // Apple handles this differently
        supportsPause: true,
        supportsImmediateCancellation: false,
        requiresNativeSDK: true
      };
    case 'google_pay':
      return {
        name: 'Google Play Billing',
        supportsProration: true,
        supportsPause: true,
        supportsImmediateCancellation: false,
        requiresNativeSDK: true
      };
    default:
      throw new Error(`Unsupported gateway: ${gateway}`);
  }
}

module.exports = {
  getPaymentGateway,
  isGatewaySupported,
  getGatewayConfig
};

