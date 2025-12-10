// test-profile-endpoint.js
// Script to test the new POST /api/user/profile endpoint

require('dotenv').config();
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
// const BASE_URL = 'https://apogeehnp.azurewebsites.net'; // Uncomment for production test

// You'll need to replace this with a valid JWT token from your app
const TEST_TOKEN = 'YOUR_JWT_TOKEN_HERE';

async function testProfileEndpoint() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   TESTING PRE-ASSESSMENT PROFILE ENDPOINT');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Test 1: Valid profile data
  console.log('📋 Test 1: Valid profile data submission');
  try {
    const response = await axios.post(
      `${BASE_URL}/api/user/profile`,
      {
        dob: '1995-06-15',
        height: '180',
        heightUnit: 'cm',
        weight: '75',
        weightUnit: 'kg',
        goals: ['Weight Loss', 'Cardio', 'Strength']
      },
      {
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('✅ Test 1 PASSED');
    console.log('   Response:', response.data);
  } catch (error) {
    console.log('❌ Test 1 FAILED');
    console.log('   Error:', error.response?.data || error.message);
  }

  console.log('\n─────────────────────────────────────────────────────────\n');

  // Test 2: Invalid age (under 13)
  console.log('📋 Test 2: Invalid age (under 13) - should reject');
  try {
    const response = await axios.post(
      `${BASE_URL}/api/user/profile`,
      {
        dob: '2015-01-01', // Makes user ~10 years old
        height: '150',
        heightUnit: 'cm',
        weight: '40',
        weightUnit: 'kg',
        goals: ['Cardio']
      },
      {
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('❌ Test 2 FAILED - Should have rejected under 13');
    console.log('   Response:', response.data);
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.field === 'dob') {
      console.log('✅ Test 2 PASSED - Correctly rejected');
      console.log('   Error message:', error.response.data.error);
    } else {
      console.log('❌ Test 2 FAILED - Wrong error type');
      console.log('   Error:', error.response?.data || error.message);
    }
  }

  console.log('\n─────────────────────────────────────────────────────────\n');

  // Test 3: Invalid height (out of range)
  console.log('📋 Test 3: Invalid height (500 cm) - should reject');
  try {
    const response = await axios.post(
      `${BASE_URL}/api/user/profile`,
      {
        dob: '1995-06-15',
        height: '500',
        heightUnit: 'cm',
        weight: '75',
        weightUnit: 'kg',
        goals: ['Cardio']
      },
      {
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('❌ Test 3 FAILED - Should have rejected invalid height');
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.field === 'height') {
      console.log('✅ Test 3 PASSED - Correctly rejected');
      console.log('   Error message:', error.response.data.error);
    } else {
      console.log('❌ Test 3 FAILED - Wrong error type');
      console.log('   Error:', error.response?.data || error.message);
    }
  }

  console.log('\n─────────────────────────────────────────────────────────\n');

  // Test 4: Invalid weight (out of range)
  console.log('📋 Test 4: Invalid weight (10 kg) - should reject');
  try {
    const response = await axios.post(
      `${BASE_URL}/api/user/profile`,
      {
        dob: '1995-06-15',
        height: '180',
        heightUnit: 'cm',
        weight: '10',
        weightUnit: 'kg',
        goals: ['Cardio']
      },
      {
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('❌ Test 4 FAILED - Should have rejected invalid weight');
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.field === 'weight') {
      console.log('✅ Test 4 PASSED - Correctly rejected');
      console.log('   Error message:', error.response.data.error);
    } else {
      console.log('❌ Test 4 FAILED - Wrong error type');
      console.log('   Error:', error.response?.data || error.message);
    }
  }

  console.log('\n─────────────────────────────────────────────────────────\n');

  // Test 5: Partial update (only goals)
  console.log('📋 Test 5: Partial update (only goals)');
  try {
    const response = await axios.post(
      `${BASE_URL}/api/user/profile`,
      {
        goals: ['Muscle Gain', 'Strength']
      },
      {
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('✅ Test 5 PASSED');
    console.log('   Response:', response.data);
  } catch (error) {
    console.log('❌ Test 5 FAILED');
    console.log('   Error:', error.response?.data || error.message);
  }

  console.log('\n─────────────────────────────────────────────────────────\n');

  // Test 6: GET profile to verify data was saved
  console.log('📋 Test 6: GET profile to verify data');
  try {
    const response = await axios.get(
      `${BASE_URL}/api/user/profile`,
      {
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`
        }
      }
    );
    console.log('✅ Test 6 PASSED');
    console.log('   Profile data:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Test 6 FAILED');
    console.log('   Error:', error.response?.data || error.message);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('   TESTING COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');
}

// Check if token is provided
if (TEST_TOKEN === 'YOUR_JWT_TOKEN_HERE') {
  console.log('⚠️  Please set a valid JWT token in the TEST_TOKEN variable.');
  console.log('   You can get one by logging into the app and copying the token.');
  console.log('\n💡 To run this test:');
  console.log('   1. Start the server: node server.js');
  console.log('   2. Get a valid JWT token from the app');
  console.log('   3. Update TEST_TOKEN in this file');
  console.log('   4. Run: node test-profile-endpoint.js\n');
  process.exit(0);
}

testProfileEndpoint().catch(error => {
  console.error('💥 Fatal error:', error.message);
  process.exit(1);
});

