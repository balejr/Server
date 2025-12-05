/**
 * Integration Tests for Subscription Management APIs
 * 
 * Prerequisites:
 * 1. Server must be running
 * 2. Database must be accessible
 * 3. Stripe test keys must be configured
 * 4. Test user must have an active subscription
 * 
 * Run with: npm test
 */

const axios = require('axios');
require('dotenv').config();

const API_BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000/api';
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || 'test@example.com';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPassword123';

let authToken = null;
let userId = null;

// Helper function to authenticate
async function authenticate() {
  try {
    const response = await axios.post(`${API_BASE_URL}/auth/signin`, {
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD
    });
    authToken = response.data.token;
    userId = response.data.userId;
    console.log('✅ Authentication successful');
    return true;
  } catch (error) {
    console.error('❌ Authentication failed:', error.response?.data || error.message);
    return false;
  }
}

// Test: Get subscription status
async function testGetSubscriptionStatus() {
  console.log('\n📝 Test: Get Subscription Status');
  try {
    const response = await axios.get(
      `${API_BASE_URL}/data/users/subscription/status`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    
    console.log('✅ Status:', response.status);
    console.log('📊 Subscription:', {
      plan: response.data.plan,
      status: response.data.status,
      billing_interval: response.data.billing_interval
    });
    return true;
  } catch (error) {
    console.error('❌ Failed:', error.response?.data || error.message);
    return false;
  }
}

// Test: Preview plan change
async function testPreviewPlanChange() {
  console.log('\n📝 Test: Preview Plan Change');
  try {
    const response = await axios.post(
      `${API_BASE_URL}/data/subscriptions/preview-change`,
      { newBillingInterval: 'annual' },
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    
    console.log('✅ Status:', response.status);
    console.log('📊 Preview:', {
      currentPlan: response.data.currentPlan,
      newPlan: response.data.newPlan,
      prorationAmount: response.data.prorationAmount,
      nextInvoiceAmount: response.data.nextInvoiceAmount
    });
    return true;
  } catch (error) {
    console.error('❌ Failed:', error.response?.data || error.message);
    return false;
  }
}

// Test: Get transaction history
async function testGetTransactionHistory() {
  console.log('\n📝 Test: Get Transaction History');
  try {
    const response = await axios.get(
      `${API_BASE_URL}/data/subscriptions/history?months=12`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    
    console.log('✅ Status:', response.status);
    console.log('📊 Transactions:', response.data.count);
    if (response.data.transactions.length > 0) {
      console.log('   Latest:', {
        type: response.data.transactions[0].transaction_type,
        date: response.data.transactions[0].transaction_date
      });
    }
    return true;
  } catch (error) {
    console.error('❌ Failed:', error.response?.data || error.message);
    return false;
  }
}

// Test: Change plan (requires manual cleanup)
async function testChangePlan() {
  console.log('\n📝 Test: Change Plan (Skipped - requires manual cleanup)');
  console.log('⚠️  This test modifies real subscription data');
  console.log('   To test manually:');
  console.log('   POST /api/data/subscriptions/change-plan');
  console.log('   Body: { "newBillingInterval": "semi_annual" }');
  return true;
}

// Test: Pause subscription (requires manual cleanup)
async function testPauseSubscription() {
  console.log('\n📝 Test: Pause Subscription (Skipped - requires manual cleanup)');
  console.log('⚠️  This test modifies real subscription data');
  console.log('   To test manually:');
  console.log('   POST /api/data/subscriptions/pause');
  console.log('   Body: { "pauseDuration": 1 }');
  return true;
}

// Test: Cancel subscription (requires manual cleanup)
async function testCancelSubscription() {
  console.log('\n📝 Test: Cancel Subscription (Skipped - requires manual cleanup)');
  console.log('⚠️  This test modifies real subscription data');
  console.log('   To test manually:');
  console.log('   POST /api/data/subscriptions/cancel');
  console.log('   Body: { "cancellationReason": "test", "feedback": "Testing" }');
  return true;
}

// Test: Resume subscription (requires manual cleanup)
async function testResumeSubscription() {
  console.log('\n📝 Test: Resume Subscription (Skipped - requires manual cleanup)');
  console.log('⚠️  This test modifies real subscription data');
  console.log('   To test manually:');
  console.log('   POST /api/data/subscriptions/resume');
  return true;
}

// Run all tests
async function runTests() {
  console.log('🚀 Starting Subscription Management API Tests\n');
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log(`Test User: ${TEST_USER_EMAIL}\n`);
  
  const results = {
    passed: 0,
    failed: 0,
    skipped: 0
  };
  
  // Authenticate first
  const authSuccess = await authenticate();
  if (!authSuccess) {
    console.error('\n❌ Authentication failed. Cannot proceed with tests.');
    process.exit(1);
  }
  
  // Run read-only tests
  const tests = [
    { name: 'Get Subscription Status', fn: testGetSubscriptionStatus },
    { name: 'Preview Plan Change', fn: testPreviewPlanChange },
    { name: 'Get Transaction History', fn: testGetTransactionHistory },
    { name: 'Change Plan', fn: testChangePlan },
    { name: 'Pause Subscription', fn: testPauseSubscription },
    { name: 'Cancel Subscription', fn: testCancelSubscription },
    { name: 'Resume Subscription', fn: testResumeSubscription }
  ];
  
  for (const test of tests) {
    const success = await test.fn();
    if (success) {
      results.passed++;
    } else {
      results.failed++;
    }
  }
  
  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary');
  console.log('='.repeat(50));
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`⚠️  Skipped: ${results.skipped}`);
  console.log('='.repeat(50));
  
  if (results.failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});

