/**
 * Test script for Email OTP Integration
 * Tests all email OTP flows: signup, signin, MFA, password reset
 * 
 * Usage: node scripts/test-email-otp.js
 */

const readline = require("readline");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000/api/auth";

// Simple readline interface for getting user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function makeRequest(endpoint, method, body) {
  const url = `${BASE_URL}${endpoint}`;
  console.log(`\n🔄 ${method} ${url}`);
  console.log("📤 Request body:", JSON.stringify(body, null, 2));

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log(`📥 Response (${response.status}):`, JSON.stringify(data, null, 2));
    return { status: response.status, data };
  } catch (error) {
    console.error("❌ Request failed:", error.message);
    return { error: error.message };
  }
}

// ============================================
// Test 1: Signup Flow with Email OTP
// ============================================
async function testSignupEmailOTP() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1: SIGNUP FLOW WITH EMAIL OTP");
  console.log("=".repeat(60));

  const email = await prompt("\n📧 Enter test email for signup: ");

  // Step 1: Send OTP
  console.log("\n📤 Step 1: Sending OTP for signup...");
  const sendResult = await makeRequest("/send-email-otp", "POST", {
    email,
    purpose: "signup",
  });

  if (sendResult.status !== 200) {
    console.log("❌ Failed to send OTP");
    return;
  }

  // Step 2: Verify OTP
  const code = await prompt("\n🔢 Enter the code from email: ");
  console.log("\n✅ Step 2: Verifying OTP...");
  const verifyResult = await makeRequest("/verify-email-otp", "POST", {
    email,
    code,
    purpose: "signup",
  });

  if (verifyResult.status === 200) {
    console.log("✅ Signup email verification complete!");
    console.log("💡 Frontend can now proceed to /auth/signup");
  } else {
    console.log("❌ Verification failed");
  }
}

// ============================================
// Test 2: Signin Flow with Email OTP
// ============================================
async function testSigninEmailOTP() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: SIGNIN FLOW WITH EMAIL OTP (Direct)");
  console.log("=".repeat(60));

  const email = await prompt("\n📧 Enter registered email for signin: ");

  // Step 1: Send OTP
  console.log("\n📤 Step 1: Sending OTP for signin...");
  const sendResult = await makeRequest("/send-email-otp", "POST", {
    email,
    purpose: "signin",
  });

  if (sendResult.status !== 200) {
    console.log("❌ Failed to send OTP");
    return;
  }

  // Step 2: Verify OTP (should return tokens)
  const code = await prompt("\n🔢 Enter the code from email: ");
  console.log("\n✅ Step 2: Verifying OTP...");
  const verifyResult = await makeRequest("/verify-email-otp", "POST", {
    email,
    code,
    purpose: "signin",
  });

  if (verifyResult.status === 200 && verifyResult.data.accessToken) {
    console.log("✅ Signin successful! Received tokens:");
    console.log("   Access Token:", verifyResult.data.accessToken.substring(0, 20) + "...");
    console.log("   Refresh Token:", verifyResult.data.refreshToken.substring(0, 20) + "...");
  } else {
    console.log("❌ Signin failed");
  }
}

// ============================================
// Test 3: MFA with Email
// ============================================
async function testMFAEmail() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: MFA WITH EMAIL");
  console.log("=".repeat(60));

  const userId = await prompt("\n🆔 Enter user ID (for MFA-enabled account): ");

  // Step 1: Send MFA code
  console.log("\n📤 Step 1: Sending MFA code via email...");
  const sendResult = await makeRequest("/send-mfa-code", "POST", {
    userId: parseInt(userId),
    method: "email",
  });

  if (sendResult.status !== 200) {
    console.log("❌ Failed to send MFA code");
    return;
  }

  // Step 2: Get mfaSessionToken from signin
  const mfaSessionToken = await prompt("\n🔑 Enter MFA session token (from signin response): ");
  const code = await prompt("🔢 Enter the MFA code from email: ");

  console.log("\n✅ Step 2: Verifying MFA code...");
  const verifyResult = await makeRequest("/verify-mfa-login", "POST", {
    userId: parseInt(userId),
    mfaSessionToken,
    code,
  });

  if (verifyResult.status === 200 && verifyResult.data.accessToken) {
    console.log("✅ MFA verification successful! Received tokens:");
    console.log("   Access Token:", verifyResult.data.accessToken.substring(0, 20) + "...");
  } else {
    console.log("❌ MFA verification failed");
  }
}

// ============================================
// Test 4: Password Reset with Email OTP
// ============================================
async function testPasswordResetEmailOTP() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 4: PASSWORD RESET WITH EMAIL OTP");
  console.log("=".repeat(60));

  const email = await prompt("\n📧 Enter email for password reset: ");

  // Step 1: Send OTP
  console.log("\n📤 Step 1: Sending password reset OTP...");
  const sendResult = await makeRequest("/send-email-otp", "POST", {
    email,
    purpose: "password_reset",
  });

  if (sendResult.status !== 200) {
    console.log("❌ Failed to send OTP");
    return;
  }

  // Step 2: Verify OTP (should return resetToken)
  const code = await prompt("\n🔢 Enter the code from email: ");
  console.log("\n✅ Step 2: Verifying OTP...");
  const verifyResult = await makeRequest("/verify-email-otp", "POST", {
    email,
    code,
    purpose: "password_reset",
  });

  if (verifyResult.status === 200 && verifyResult.data.resetToken) {
    console.log("✅ Email verified! Received reset token:");
    console.log("   Reset Token:", verifyResult.data.resetToken.substring(0, 20) + "...");
    
    // Step 3: Reset password
    const newPassword = await prompt("\n🔑 Enter new password: ");
    console.log("\n✅ Step 3: Resetting password...");
    const resetResult = await makeRequest("/reset-password", "POST", {
      email,
      resetToken: verifyResult.data.resetToken,
      newPassword,
    });

    if (resetResult.status === 200) {
      console.log("✅ Password reset successful!");
    } else {
      console.log("❌ Password reset failed");
    }
  } else {
    console.log("❌ Verification failed");
  }
}

// ============================================
// Main Menu
// ============================================
async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("EMAIL OTP INTEGRATION TEST SUITE");
  console.log("=".repeat(60));
  console.log("\nTesting endpoint:", BASE_URL);
  console.log("\nℹ️  Make sure your server is running!");
  console.log("ℹ️  Check your email for verification codes");

  while (true) {
    console.log("\n" + "=".repeat(60));
    console.log("Select a test to run:");
    console.log("=".repeat(60));
    console.log("1. Test Signup with Email OTP");
    console.log("2. Test Signin with Email OTP");
    console.log("3. Test MFA with Email");
    console.log("4. Test Password Reset with Email OTP");
    console.log("5. Exit");

    const choice = await prompt("\nEnter your choice (1-5): ");

    switch (choice) {
      case "1":
        await testSignupEmailOTP();
        break;
      case "2":
        await testSigninEmailOTP();
        break;
      case "3":
        await testMFAEmail();
        break;
      case "4":
        await testPasswordResetEmailOTP();
        break;
      case "5":
        console.log("\n👋 Exiting test suite...");
        rl.close();
        return;
      default:
        console.log("\n❌ Invalid choice. Please select 1-5.");
    }
  }
}

// Run the test suite
main().catch((error) => {
  console.error("\n❌ Test suite error:", error);
  rl.close();
  process.exit(1);
});






