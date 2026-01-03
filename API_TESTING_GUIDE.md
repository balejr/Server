# API Testing Guide

A comprehensive step-by-step guide for testing all API routes in the ApogeeHnP backend, including authentication, user profiles, data management, AI features, and subscriptions.

> **For backend architecture, error code meanings, and configuration values**, see [Backend Developer Guide](BACKEND_DEVELOPER_GUIDE.md).

---

## Table of Contents

1. [Setup](#setup)
2. [Basic Authentication](#basic-authentication)
3. [Phone OTP Flow](#phone-otp-flow)
4. [Email OTP Flow](#email-otp-flow)
5. [MFA (Two-Factor Authentication)](#mfa-two-factor-authentication)
6. [Password Reset Flow](#password-reset-flow)
7. [User Profile](#user-profile)
8. [Utility Routes](#utility-routes)
9. [Data Routes](#data-routes)
10. [AI Workout Plans](#ai-workout-plans)
11. [Chatbot / AI Assistant](#chatbot--ai-assistant)
12. [Usage Tracking](#usage-tracking)
13. [Subscription Management](#subscription-management)
14. [Testing Security Fixes](#-testing-security-fixes)
15. [Troubleshooting](#troubleshooting)

---

## Setup

> **For architecture details, token storage implementation, and system internals**, see the [Backend Developer Guide](BACKEND_DEVELOPER_GUIDE.md).

### Base URL

```
https://apogeehnp.azurewebsites.net/api
```

### Postman Configuration

1. Open Postman
2. Create a new Collection called "ApogeeHnP Auth Testing"
3. For each request:
   - Select the correct HTTP method (POST/GET)
   - Paste the full URL
   - Go to **Body** tab → Select **raw** → Select **JSON** from dropdown
   - Paste the JSON body

### Saving Tokens

After signin, you'll receive tokens in the response. **Save these values** - you'll need them:

| Value             | Where to Find                  | What It's For                             |
| ----------------- | ------------------------------ | ----------------------------------------- |
| `accessToken`     | Response body                  | Authorization header for protected routes |
| `refreshToken`    | Response body                  | Getting new access tokens                 |
| `user.id`         | Response body                  | User ID for various requests              |
| `mfaSessionToken` | Response body (if MFA enabled) | Completing MFA verification               |

---

## Basic Authentication

### Step 1: Check if Email Exists

Before signing up, check if an email is already registered.

| Setting    | Value                                                                            |
| ---------- | -------------------------------------------------------------------------------- |
| **Method** | `GET`                                                                            |
| **URL**    | `https://apogeehnp.azurewebsites.net/api/auth/checkemail?email=test@example.com` |
| **Body**   | None                                                                             |

**Expected Response:**

```json
{
  "exists": false
}
```

> 🔒 **Security Fix #7 Test:** Try with different case variations (e.g., `Test@Example.com`, `TEST@EXAMPLE.COM`) - all should return the same result due to case-insensitive email handling.

---

### Step 2: Sign Up (Create Account)

| Setting       | Value                                                 |
| ------------- | ----------------------------------------------------- |
| **Method**    | `POST`                                                |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/signup` |
| **Body Type** | raw → JSON                                            |

**Body:**

```json
{
  "email": "testuser@example.com",
  "password": "SecurePassword123",
  "firstName": "Test",
  "lastName": "User",
  "phoneNumber": "+12025551234",
  "fitnessGoal": "muscle_gain",
  "age": 28,
  "weight": 175,
  "height": 70,
  "gender": "male",
  "fitnessLevel": "intermediate",
  "preferredLoginMethod": "email"
}
```

**Expected Response (200 OK):**

```json
{
  "success": true,
  "message": "User created successfully!",
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "expiresIn": 900,
  "userId": 32,
  "user": {
    "id": 32,
    "email": "testuser@example.com",
    "phoneNumber": "+12025551234",
    "phoneVerified": false,
    "preferredLoginMethod": "email"
  }
}
```

> 📝 **Save the `accessToken` and `userId`** - you'll need them for the next steps!

> 🔒 **Security Fix #3 Test:** Try signing up without `phoneNumber` - should return `400 Bad Request` with "Phone number is required".

> 🔒 **Security Fix #10 Test:** Try signing up with `TestUser@Example.com` after `testuser@example.com` exists - should return `409 Email already registered` due to case-insensitive duplicate check.

---

### Step 3: Sign In (Email + Password)

| Setting       | Value                                                 |
| ------------- | ----------------------------------------------------- |
| **Method**    | `POST`                                                |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/signin` |
| **Body Type** | raw → JSON                                            |

**Body:**

```json
{
  "email": "testuser@example.com",
  "password": "SecurePassword123"
}
```

**Expected Response (200 OK):**

```json
{
  "success": true,
  "message": "Login successful!",
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "expiresIn": 900,
  "user": {
    "id": 32,
    "email": "testuser@example.com",
    "phoneNumber": "+12025551234",
    "phoneVerified": false,
    "preferredLoginMethod": "email",
    "mfaEnabled": false,
    "biometricEnabled": false
  }
}
```

> ⚠️ **If MFA is enabled**, you'll get `mfaRequired: true` instead of tokens. See [MFA Flow](#mfa-two-factor-authentication).

> 🔒 **Security Fix #2 Verification:** Confirm the response contains `accessToken` and `refreshToken` (not just `token`).

> 🔒 **Security Fix #7 Test:** Sign in with `TESTUSER@EXAMPLE.COM` - should work if account exists with lowercase email.

---

### Step 4: Get Auth Status

Check the current user's authentication settings.

| Setting     | Value                                                 |
| ----------- | ----------------------------------------------------- |
| **Method**  | `GET`                                                 |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/auth/status` |
| **Headers** | `Authorization: Bearer <your_access_token>`           |

**How to add the header:**

1. Go to the **Headers** tab
2. Add a new row:
   - Key: `Authorization`
   - Value: `Bearer eyJhbGci...` (paste your access token after "Bearer ")

**Expected Response:**

```json
{
  "success": true,
  "authStatus": {
    "email": "testuser@example.com",
    "phoneNumber": "+12025551234",
    "phoneVerified": false,
    "preferredLoginMethod": "email",
    "mfaEnabled": false,
    "mfaMethod": null,
    "biometricEnabled": false
  }
}
```

---

### Step 5: Refresh Token

Get a new access token when the current one expires.

| Setting       | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| **Method**    | `POST`                                                       |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/refresh-token` |
| **Body Type** | raw → JSON                                                   |

**Body:**

```json
{
  "refreshToken": "eyJhbGci...paste_your_refresh_token_here"
}
```

**Expected Response:**

```json
{
  "success": true,
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "expiresIn": 900
}
```

> 🔒 **Security Fix #4 Test:** See [Testing Race Conditions](#test-4-refresh-token-race-condition-fix-4) for concurrent request testing.

> 🔒 **Security Fix #8 Test:** See [Testing Logged In Elsewhere](#test-8-logged-in-elsewhere-detection-fix-8) for multi-device testing.

---

### Step 6: Logout

Invalidate the session on the server.

| Setting     | Value                                                 |
| ----------- | ----------------------------------------------------- |
| **Method**  | `POST`                                                |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/auth/logout` |
| **Headers** | `Authorization: Bearer <your_access_token>`           |
| **Body**    | `{}` (empty object)                                   |

**Expected Response:**

```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## Phone OTP Flow

### Step 7: Check if Phone Exists

| Setting    | Value                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| **Method** | `GET`                                                                              |
| **URL**    | `https://apogeehnp.azurewebsites.net/api/auth/checkphone?phoneNumber=+12025551234` |

**Expected Response:**

```json
{
  "success": true,
  "exists": true
}
```

---

### Step 8: Send Phone OTP

| Setting       | Value                                                         |
| ------------- | ------------------------------------------------------------- |
| **Method**    | `POST`                                                        |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/send-phone-otp` |
| **Body Type** | raw → JSON                                                    |

**Body:**

```json
{
  "phoneNumber": "+12025551234",
  "purpose": "signin"
}
```

**Purpose Options:**
| Purpose | When to Use |
|---------|-------------|
| `signin` | Logging in via phone |
| `signup` | Verifying phone during registration |
| `verification` | General phone verification |
| `mfa` | MFA verification |

**Expected Response:**

```json
{
  "success": true,
  "message": "Verification code sent successfully",
  "remainingAttempts": 14
}
```

> 📱 **Check your phone** for the 6-digit SMS code!

> 🔒 **Security Fix #12 Test:** Rate limit is now 15 requests per hour. After 15 requests, you'll get `429 Too Many Requests`.

---

### Step 9: Verify Phone OTP

| Setting       | Value                                                           |
| ------------- | --------------------------------------------------------------- |
| **Method**    | `POST`                                                          |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/verify-phone-otp` |
| **Body Type** | raw → JSON                                                      |

**Body:**

```json
{
  "phoneNumber": "+12025551234",
  "code": "123456",
  "purpose": "signin"
}
```

**Expected Response (for signin):**

```json
{
  "success": true,
  "message": "Login successful!",
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "user": { ... }
}
```

**Expected Response (for signup/verification):**

```json
{
  "success": true,
  "message": "Phone number verified successfully",
  "phoneVerified": true
}
```

---

## Email OTP Flow

### Step 10: Send Email OTP

| Setting       | Value                                                         |
| ------------- | ------------------------------------------------------------- |
| **Method**    | `POST`                                                        |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/send-email-otp` |
| **Body Type** | raw → JSON                                                    |

**Body:**

```json
{
  "email": "testuser@example.com",
  "purpose": "signin"
}
```

**Purpose Options:**
| Purpose | When to Use |
|---------|-------------|
| `signup` | Verifying email during registration |
| `verification` | General email verification |
| `signin` | Passwordless login |
| `mfa` | MFA verification |
| `password_reset` | Password reset flow |

**Expected Response:**

```json
{
  "success": true,
  "message": "Verification code sent successfully",
  "remainingAttempts": 14
}
```

> 📧 **Check your email** for the 6-digit code!

> 🔒 **Security Fix #7 Test:** Try with different email case variations - all should work and find the same account.

> 🔒 **Security Fix #12 Test:** Rate limit is 15 requests per hour per email.

---

### Step 11: Verify Email OTP

| Setting       | Value                                                           |
| ------------- | --------------------------------------------------------------- |
| **Method**    | `POST`                                                          |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/verify-email-otp` |
| **Body Type** | raw → JSON                                                      |

**Body:**

```json
{
  "email": "testuser@example.com",
  "code": "123456",
  "purpose": "signin"
}
```

**Expected Response (for signin):**

```json
{
  "success": true,
  "message": "Login successful!",
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "user": { ... }
}
```

> 🔒 **Security Fix #7 Test:** Verify with email in different case than when OTP was sent - should still work.

---

### ~~Step 12: Sign In with Email OTP (Passwordless)~~ ❌ REMOVED

> 🔒 **Security Fix #13:** This endpoint (`/auth/signin-email-otp`) has been removed as it was dead code. Use the two-step flow instead:
>
> 1. Send Email OTP (Step 10) with `purpose: "signin"`
> 2. Verify Email OTP (Step 11) with `purpose: "signin"`

---

## MFA (Two-Factor Authentication)

### Step 13: Setup MFA

**Part A: Send verification code**

| Setting       | Value                                                    |
| ------------- | -------------------------------------------------------- |
| **Method**    | `POST`                                                   |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/setup-mfa` |
| **Headers**   | `Authorization: Bearer <your_access_token>`              |
| **Body Type** | raw → JSON                                               |

**Body:**

```json
{
  "method": "sms"
}
```

**Expected Response:**

```json
{
  "success": true,
  "message": "Verification code sent. Enter the code to complete MFA setup.",
  "method": "sms"
}
```

**Part B: Verify and enable MFA**

Same endpoint, but include the code:

**Body:**

```json
{
  "method": "sms",
  "code": "123456"
}
```

**Expected Response:**

```json
{
  "success": true,
  "message": "MFA enabled successfully",
  "mfaEnabled": true,
  "mfaMethod": "sms"
}
```

---

### Step 14: Enable MFA Direct (Skip Verification)

Use this if the phone/email was already verified.

| Setting       | Value                                                            |
| ------------- | ---------------------------------------------------------------- |
| **Method**    | `POST`                                                           |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/enable-mfa-direct` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                      |
| **Body Type** | raw → JSON                                                       |

**Body:**

```json
{
  "method": "sms",
  "alreadyVerified": true
}
```

---

### Step 15: Sign In with MFA

When MFA is enabled, signin returns a different response:

**Step 15a: Initial signin**

Same as Step 3, but response will be:

```json
{
  "success": true,
  "message": "MFA required. Please select your preferred verification method.",
  "mfaRequired": true,
  "mfaMethod": "sms",
  "mfaSessionToken": "abc123...",
  "userId": 32,
  "phoneNumber": "+12025551234",
  "email": "testuser@example.com",
  "maskedPhone": "+1 ***-***-1234",
  "maskedEmail": "t***r@example.com",
  "availableMethods": ["sms", "email"]
}
```

> 📝 **Save the `mfaSessionToken` and `userId`** - you need them next!

---

### Step 16: Send MFA Code

| Setting       | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| **Method**    | `POST`                                                       |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/send-mfa-code` |
| **Body Type** | raw → JSON                                                   |

**Body:**

```json
{
  "userId": 32,
  "method": "sms"
}
```

**Expected Response:**

```json
{
  "success": true,
  "message": "MFA code sent",
  "method": "sms"
}
```

---

### Step 17: Verify MFA Login

| Setting       | Value                                                           |
| ------------- | --------------------------------------------------------------- |
| **Method**    | `POST`                                                          |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/verify-mfa-login` |
| **Body Type** | raw → JSON                                                      |

**Body:**

```json
{
  "userId": 32,
  "mfaSessionToken": "abc123...paste_from_signin_response",
  "code": "123456",
  "method": "sms"
}
```

**Expected Response:**

```json
{
  "success": true,
  "message": "MFA verification successful",
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "user": { ... }
}
```

🎉 **You're now logged in with MFA!**

> 🔒 **Security Fix #6 Test:** See [Testing MFA Session Race Condition](#test-6-mfa-session-token-race-condition-fix-6) for concurrent request testing.

---

### Step 18: Disable MFA

| Setting     | Value                                                      |
| ----------- | ---------------------------------------------------------- |
| **Method**  | `POST`                                                     |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/auth/disable-mfa` |
| **Headers** | `Authorization: Bearer <your_access_token>`                |
| **Body**    | `{}`                                                       |

---

## Password Reset Flow

### Step 19: Forgot Password

| Setting       | Value                                                          |
| ------------- | -------------------------------------------------------------- |
| **Method**    | `POST`                                                         |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/forgot-password` |
| **Body Type** | raw → JSON                                                     |

**Body:**

```json
{
  "email": "testuser@example.com"
}
```

**Expected Response:**

```json
{
  "success": true,
  "message": "If an account exists, a reset code has been sent.",
  "useTwilio": true
}
```

> 🔒 **Security Fix #7 Test:** Try with different email case variations - all should work.

> 🔒 **Security Fix #11 Test:** Rate limiting is now case-insensitive. Trying `test@example.com` then `TEST@EXAMPLE.COM` counts toward the same rate limit.

---

### Step 20: Reset Password (Method A - Direct Code)

| Setting       | Value                                                         |
| ------------- | ------------------------------------------------------------- |
| **Method**    | `POST`                                                        |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/reset-password` |
| **Body Type** | raw → JSON                                                    |

**Body:**

```json
{
  "email": "testuser@example.com",
  "code": "123456",
  "newPassword": "NewSecurePassword456",
  "useTwilio": true
}
```

> 🔒 **Security Fix #5 Test:** See [Testing Password Reset Race Condition](#test-5-password-reset-race-condition-fix-5) for concurrent request testing.

---

### Step 21: Reset Password (Method B - With Reset Token)

More secure method using a reset token from verify-email-otp.

**Step 21a: First verify the email OTP**

```json
{
  "email": "testuser@example.com",
  "code": "123456",
  "purpose": "password_reset"
}
```

This returns a `resetToken` in the response.

**Step 21b: Then reset the password**

```json
{
  "email": "testuser@example.com",
  "resetToken": "abc123...from_previous_response",
  "newPassword": "NewSecurePassword456"
}
```

> 🔒 **Security Fix #5 Test:** Using a `resetToken` twice should return `400` with `errorCode: "TOKEN_ALREADY_USED"`.

---

## User Profile

### Get User Profile

Retrieve the authenticated user's profile information.

| Setting     | Value                                                  |
| ----------- | ------------------------------------------------------ |
| **Method**  | `GET`                                                  |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/user/profile` |
| **Headers** | `Authorization: Bearer <your_access_token>`            |

**Expected Response (200 OK):**

```json
{
  "FirstName": "Test",
  "LastName": "User",
  "FitnessGoal": "muscle_gain",
  "Age": 28,
  "Weight": 175,
  "Height": 70,
  "Gender": "male",
  "FitnessLevel": "intermediate",
  "ProfileImageUrl": null
}
```

---

### Update User Profile (Simple)

Update profile fields without image upload.

| Setting       | Value                                                  |
| ------------- | ------------------------------------------------------ |
| **Method**    | `PATCH`                                                |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/user/profile` |
| **Headers**   | `Authorization: Bearer <your_access_token>`            |
| **Body Type** | raw → JSON                                             |

**Body:**

```json
{
  "firstName": "Updated",
  "lastName": "Name",
  "fitnessGoal": "weight_loss",
  "age": 30,
  "weight": 170,
  "height": 70,
  "gender": "male",
  "fitnessLevel": "advanced"
}
```

**Expected Response (200 OK):**

```json
{
  "message": "Profile updated successfully"
}
```

---

### Delete User Account

Permanently delete user account and all associated data.

| Setting     | Value                                                  |
| ----------- | ------------------------------------------------------ |
| **Method**  | `DELETE`                                               |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/user/profile` |
| **Headers** | `Authorization: Bearer <your_access_token>`            |
| **Body**    | `{}`                                                   |

**Expected Response (200 OK):**

```json
{
  "success": true,
  "message": "Account and all data deleted successfully"
}
```

> ⚠️ **Warning:** This action is irreversible. All user data including workout history, logs, and subscriptions will be permanently deleted.

> 🔒 **Security:** If MFA is enabled, you must complete MFA verification first. The request will return `403 Forbidden` with `mfaRequired: true` if MFA verification is needed.

---

## Utility Routes

### Update Login Preference

| Setting       | Value                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| **Method**    | `PATCH`                                                                |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/update-login-preference` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                            |
| **Body Type** | raw → JSON                                                             |

**Body:**

```json
{
  "preferredLoginMethod": "phone"
}
```

**Options:** `email`, `phone`, `biometric`

---

### Verify Phone Number (Authenticated User)

| Setting       | Value                                                              |
| ------------- | ------------------------------------------------------------------ |
| **Method**    | `POST`                                                             |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/verify-phone-number` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                        |
| **Body Type** | raw → JSON                                                         |

**Body (to send code):**

```json
{
  "phoneNumber": "+12025559999"
}
```

**Body (to verify code):**

```json
{
  "phoneNumber": "+12025559999",
  "code": "123456"
}
```

---

### Update Profile

| Setting       | Value                                                            |
| ------------- | ---------------------------------------------------------------- |
| **Method**    | `PUT`                                                            |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/update-profile/32` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                      |
| **Body Type** | raw → JSON                                                       |

**Body:**

```json
{
  "firstName": "Updated",
  "lastName": "Name"
}
```

> 🔒 **Security Fix #12 Test:** See [Testing Profile Update Authorization](#test-12-profile-update-authorization-fix-12).

---

---

## Data Routes

> **Note:** All data routes require authentication via the `Authorization: Bearer <token>` header.

### Daily Logs

#### Create Daily Log

| Setting       | Value                                                   |
| ------------- | ------------------------------------------------------- |
| **Method**    | `POST`                                                  |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/dailylog` |
| **Headers**   | `Authorization: Bearer <your_access_token>`             |
| **Body Type** | raw → JSON                                              |

**Body:**

```json
{
  "effectiveDate": "2025-01-02",
  "sleep": 7.5,
  "steps": 10000,
  "heartrate": 72,
  "waterIntake": 2.5,
  "sleepQuality": "good",
  "caloriesBurned": 2500,
  "restingHeartRate": 60,
  "heartrateVariability": 45,
  "weight": 175
}
```

**Expected Response (201 Created):**

```json
{
  "success": true,
  "message": "Daily log created successfully",
  "logId": 123
}
```

---

#### Get All Daily Logs

| Setting     | Value                                                    |
| ----------- | -------------------------------------------------------- |
| **Method**  | `GET`                                                    |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/dailylogs` |
| **Headers** | `Authorization: Bearer <your_access_token>`              |

**Optional Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)

---

#### Get Daily Log by ID

| Setting     | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| **Method**  | `GET`                                                       |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/dailylog/123` |
| **Headers** | `Authorization: Bearer <your_access_token>`                 |

---

#### Update Daily Log

| Setting       | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| **Method**    | `PATCH`                                                     |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/dailylog/123` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                 |
| **Body Type** | raw → JSON                                                  |

**Body (partial update):**

```json
{
  "steps": 12000,
  "waterIntake": 3.0
}
```

---

#### Delete Daily Log

| Setting     | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| **Method**  | `DELETE`                                                    |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/dailylog/123` |
| **Headers** | `Authorization: Bearer <your_access_token>`                 |

---

#### Get Weekly Dashboard Summary

| Setting     | Value                                                                |
| ----------- | -------------------------------------------------------------------- |
| **Method**  | `GET`                                                                |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/dashboard/weekly-summary` |
| **Headers** | `Authorization: Bearer <your_access_token>`                          |

**Expected Response:**

```json
{
  "success": true,
  "data": [
    {
      "Date": "2025-01-01",
      "DayName": "Wednesday",
      "PlannedWorkouts": 1,
      "TotalExercises": 6,
      "CompletedExercises": 4,
      "CompletionPercent": 66.67
    }
  ]
}
```

---

### Exercise Instances

#### Create Exercise Instance

| Setting       | Value                                                            |
| ------------- | ---------------------------------------------------------------- |
| **Method**    | `POST`                                                           |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/exerciseexistence` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                      |
| **Body Type** | raw → JSON                                                       |

**Body:**

```json
{
  "exerciseId": "ex_001",
  "exerciseName": "Bench Press",
  "workoutRoutineId": 1,
  "sets": 3,
  "reps": 10,
  "weight": 135,
  "duration": 0,
  "completed": false,
  "notes": "Focus on form"
}
```

---

#### Get All Exercise Instances

| Setting     | Value                                                             |
| ----------- | ----------------------------------------------------------------- |
| **Method**  | `GET`                                                             |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/exerciseexistences` |
| **Headers** | `Authorization: Bearer <your_access_token>`                       |

---

#### Get Exercise Instances by Date

| Setting     | Value                                                                       |
| ----------- | --------------------------------------------------------------------------- |
| **Method**  | `GET`                                                                       |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/exerciseexistence/date/2025-01-02` |
| **Headers** | `Authorization: Bearer <your_access_token>`                                 |

---

#### Update Exercise Instance

| Setting       | Value                                                                |
| ------------- | -------------------------------------------------------------------- |
| **Method**    | `PATCH`                                                              |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/exerciseexistence/123` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                          |
| **Body Type** | raw → JSON                                                           |

**Body:**

```json
{
  "completed": true,
  "weight": 145,
  "notes": "Increased weight"
}
```

---

#### Delete Exercise Instance

| Setting     | Value                                                                |
| ----------- | -------------------------------------------------------------------- |
| **Method**  | `DELETE`                                                             |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/exerciseexistence/123` |
| **Headers** | `Authorization: Bearer <your_access_token>`                          |

---

### Workout Routines

#### Create Workout Routine

| Setting       | Value                                                           |
| ------------- | --------------------------------------------------------------- |
| **Method**    | `POST`                                                          |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/workoutroutine`   |
| **Headers**   | `Authorization: Bearer <your_access_token>`                     |
| **Body Type** | raw → JSON                                                      |

**Body:**

```json
{
  "workoutName": "Push Day",
  "workoutRoutineDate": "2025-01-02",
  "exerciseInstances": "1,2,3",
  "equipment": "barbell,dumbbell",
  "duration": 60,
  "caloriesBurned": 500,
  "intensity": 7,
  "load": 15000,
  "durationLeft": 0,
  "completed": false
}
```

---

#### Get All Workout Routines

| Setting     | Value                                                            |
| ----------- | ---------------------------------------------------------------- |
| **Method**  | `GET`                                                            |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/workoutroutines`   |
| **Headers** | `Authorization: Bearer <your_access_token>`                      |

---

#### Get Workout Routines by Date

| Setting     | Value                                                                       |
| ----------- | --------------------------------------------------------------------------- |
| **Method**  | `GET`                                                                       |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/workoutroutines/date/2025-01-02` |
| **Headers** | `Authorization: Bearer <your_access_token>`                                 |

---

#### Get Workout Routine by ID

| Setting     | Value                                                             |
| ----------- | ----------------------------------------------------------------- |
| **Method**  | `GET`                                                             |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/workoutroutine/123` |
| **Headers** | `Authorization: Bearer <your_access_token>`                       |

---

#### Update Workout Routine

| Setting       | Value                                                             |
| ------------- | ----------------------------------------------------------------- |
| **Method**    | `PATCH`                                                           |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/workoutroutine/123` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                       |
| **Body Type** | raw → JSON                                                        |

**Body:**

```json
{
  "completed": true,
  "caloriesBurned": 550
}
```

---

#### Delete Workout Routine

| Setting     | Value                                                             |
| ----------- | ----------------------------------------------------------------- |
| **Method**  | `DELETE`                                                          |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/workoutroutine/123` |
| **Headers** | `Authorization: Bearer <your_access_token>`                       |

---

### Mesocycles and Microcycles

#### Create Mesocycle

| Setting       | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| **Method**    | `POST`                                                      |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/mesocycle`    |
| **Headers**   | `Authorization: Bearer <your_access_token>`                 |
| **Body Type** | raw → JSON                                                  |

**Body:**

```json
{
  "name": "Strength Block",
  "startDate": "2025-01-01",
  "endDate": "2025-02-28",
  "goal": "Build strength",
  "status": "active"
}
```

---

#### Get All Mesocycles

| Setting     | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| **Method**  | `GET`                                                       |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/mesocycles`   |
| **Headers** | `Authorization: Bearer <your_access_token>`                 |

---

#### Get Mesocycles by Date Range

| Setting     | Value                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------- |
| **Method**  | `GET`                                                                                          |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/mesocycles/date?start_date=2025-01-01&end_date=2025-03-01` |
| **Headers** | `Authorization: Bearer <your_access_token>`                                                    |

---

#### Create Microcycle

| Setting       | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| **Method**    | `POST`                                                      |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/microcycle`   |
| **Headers**   | `Authorization: Bearer <your_access_token>`                 |
| **Body Type** | raw → JSON                                                  |

**Body:**

```json
{
  "mesocycleId": 1,
  "weekNumber": 1,
  "startDate": "2025-01-01",
  "endDate": "2025-01-07",
  "focus": "Volume accumulation"
}
```

---

#### Get Microcycles by Mesocycle

| Setting     | Value                                                         |
| ----------- | ------------------------------------------------------------- |
| **Method**  | `GET`                                                         |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/microcycles/1`  |
| **Headers** | `Authorization: Bearer <your_access_token>`                   |

---

#### Create Mesocycle with Microcycles

Create a mesocycle and its associated microcycles in a single transaction.

| Setting       | Value                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| **Method**    | `POST`                                                                   |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/mesocycle-with-microcycle` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                              |
| **Body Type** | raw → JSON                                                               |

---

## AI Workout Plans

AI-generated workout plans created through the chatbot are stored and can be managed via these endpoints.

### Get All Workout Plans

| Setting     | Value                                                        |
| ----------- | ------------------------------------------------------------ |
| **Method**  | `GET`                                                        |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/workout/plans`      |
| **Headers** | `Authorization: Bearer <your_access_token>`                  |

**Expected Response:**

```json
{
  "success": true,
  "plans": [
    {
      "PlanID": "plan_32_1735776000000",
      "Summary": "4-Day Muscle Building Plan",
      "Goal": "muscle_gain",
      "DaysPerWeek": 4,
      "DurationWeeks": 8,
      "Split": "Push-Pull-Legs",
      "Status": "draft",
      "TotalExercises": 24,
      "CreatedDate": "2025-01-02T12:00:00Z"
    }
  ]
}
```

---

### Get Most Recent Workout Plan

| Setting     | Value                                                              |
| ----------- | ------------------------------------------------------------------ |
| **Method**  | `GET`                                                              |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/workout/plans/recent`     |
| **Headers** | `Authorization: Bearer <your_access_token>`                        |

**Expected Response:**

```json
{
  "success": true,
  "plan": {
    "PlanID": "plan_32_1735776000000",
    "PlanData": [
      {
        "dayIndex": 0,
        "label": "Push Day",
        "main": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rpe": 8 }
        ]
      }
    ],
    "Summary": "4-Day Muscle Building Plan",
    "Goal": "muscle_gain",
    "Status": "draft"
  }
}
```

---

### Get Workout Plan by ID

| Setting     | Value                                                                         |
| ----------- | ----------------------------------------------------------------------------- |
| **Method**  | `GET`                                                                         |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/workout/plans/plan_32_1735776000000` |
| **Headers** | `Authorization: Bearer <your_access_token>`                                   |

---

### Update Workout Plan Status

| Setting       | Value                                                                                |
| ------------- | ------------------------------------------------------------------------------------ |
| **Method**    | `PUT`                                                                                |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/workout/plans/plan_32_1735776000000/status` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                                          |
| **Body Type** | raw → JSON                                                                           |

**Body:**

```json
{
  "status": "saved"
}
```

**Status Options:** `draft`, `saved`, `completed`, `archived`

---

### Delete Workout Plan

| Setting     | Value                                                                         |
| ----------- | ----------------------------------------------------------------------------- |
| **Method**  | `DELETE`                                                                      |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/workout/plans/plan_32_1735776000000` |
| **Headers** | `Authorization: Bearer <your_access_token>`                                   |

---

## Chatbot / AI Assistant

Interact with the FitNext AI fitness assistant for workout plans, nutrition guidance, and fitness questions.

### Send Message to AI

| Setting       | Value                                                      |
| ------------- | ---------------------------------------------------------- |
| **Method**    | `POST`                                                     |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/chatbot/chat`     |
| **Headers**   | `Authorization: Bearer <your_access_token>`                |
| **Body Type** | raw → JSON                                                 |

**Body:**

```json
{
  "message": "Create a 4-day workout plan for muscle gain",
  "sessionType": "workout_plan"
}
```

**Session Types:**
- `inquiry` - General fitness questions (default)
- `workout_plan` - Workout plan creation

**Expected Response:**

```json
{
  "success": true,
  "response": {
    "mode": "WORKOUT_CONFIRM",
    "intent": "WORKOUT_REQUEST",
    "message": {
      "title": "Confirm your plan",
      "body": "I can create a personalized 4-day muscle building workout plan. Ready to proceed?"
    },
    "payload": {
      "summary": {
        "goal": "muscle_gain",
        "daysPerWeek": 4,
        "experience": "intermediate"
      }
    }
  },
  "remaining_queries": {
    "general": 4,
    "workout": 2
  },
  "conversation_id": "session-32-1735776000000",
  "inquiry_type": "workout"
}
```

> **Usage Limits:** See [Configuration Reference](BACKEND_DEVELOPER_GUIDE.md#6-configuration-reference) for details.
> - Free users: 5 general inquiries + 3 workout inquiries per week
> - Premium users: 100 total inquiries per week

---

### Get Chat History

| Setting     | Value                                                            |
| ----------- | ---------------------------------------------------------------- |
| **Method**  | `GET`                                                            |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/chatbot/chat/history`   |
| **Headers** | `Authorization: Bearer <your_access_token>`                      |

**Optional Query Parameters:**
- `sessionId` - Specific session ID
- `limit` - Number of messages (default: 50)

---

### Clear Chat History

| Setting     | Value                                                            |
| ----------- | ---------------------------------------------------------------- |
| **Method**  | `DELETE`                                                         |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/chatbot/chat/history`   |
| **Headers** | `Authorization: Bearer <your_access_token>`                      |

**Optional Query Parameters:**
- `sessionId` - Clear specific session only (omit to clear all)

---

## Usage Tracking

Monitor your API usage limits and history.

### Get Current Usage Stats

| Setting     | Value                                                    |
| ----------- | -------------------------------------------------------- |
| **Method**  | `GET`                                                    |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/usage/usage`    |
| **Headers** | `Authorization: Bearer <your_access_token>`              |

**Expected Response:**

```json
{
  "success": true,
  "usage": {
    "general": {
      "remaining": 3,
      "used": 2,
      "limit": 5
    },
    "workout": {
      "remaining": 2,
      "used": 1,
      "limit": 3
    },
    "user_type": "free",
    "week_start": "2024-12-30T00:00:00.000Z"
  }
}
```

---

### Get Usage History

| Setting     | Value                                                          |
| ----------- | -------------------------------------------------------------- |
| **Method**  | `GET`                                                          |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/usage/usage/history`  |
| **Headers** | `Authorization: Bearer <your_access_token>`                    |

---

### Reset Usage (Testing)

For testing purposes, reset current week's usage.

| Setting       | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| **Method**    | `POST`                                                       |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/usage/usage/reset`  |
| **Headers**   | `Authorization: Bearer <your_access_token>`                  |
| **Body**      | `{}`                                                         |

---

## Subscription Management

Manage premium subscriptions and payments.

### Initialize Payment

Start a new subscription payment flow.

| Setting       | Value                                                               |
| ------------- | ------------------------------------------------------------------- |
| **Method**    | `POST`                                                              |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/payments/initialize`  |
| **Headers**   | `Authorization: Bearer <your_access_token>`                         |
| **Body Type** | raw → JSON                                                          |

**Body:**

```json
{
  "billingInterval": "monthly",
  "paymentGateway": "stripe"
}
```

**Billing Intervals:** `monthly`, `semi_annual`, `annual`

---

### Confirm Payment

Confirm a payment after Stripe checkout completion.

| Setting       | Value                                                            |
| ------------- | ---------------------------------------------------------------- |
| **Method**    | `POST`                                                           |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/payments/confirm`  |
| **Headers**   | `Authorization: Bearer <your_access_token>`                      |
| **Body Type** | raw → JSON                                                       |

**Body:**

```json
{
  "sessionId": "cs_test_..."
}
```

---

### Change Subscription Plan

Upgrade or downgrade your subscription plan.

| Setting       | Value                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| **Method**    | `POST`                                                                   |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/subscriptions/change-plan` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                              |
| **Body Type** | raw → JSON                                                               |

**Body:**

```json
{
  "newBillingInterval": "annual",
  "prorationBehavior": "always_invoice"
}
```

---

### Pause Subscription

Temporarily pause your subscription (1-3 months).

| Setting       | Value                                                              |
| ------------- | ------------------------------------------------------------------ |
| **Method**    | `POST`                                                             |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/subscriptions/pause` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                        |
| **Body Type** | raw → JSON                                                         |

**Body:**

```json
{
  "pauseDuration": 1
}
```

**Expected Response:**

```json
{
  "success": true,
  "status": "paused",
  "pauseDuration": 1,
  "resumeDate": "2025-02-02T00:00:00.000Z",
  "message": "Subscription paused for 1 month(s)"
}
```

---

### Cancel Subscription

Cancel your subscription at the end of the current billing period.

| Setting       | Value                                                               |
| ------------- | ------------------------------------------------------------------- |
| **Method**    | `POST`                                                              |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/subscriptions/cancel` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                         |
| **Body Type** | raw → JSON                                                          |

**Body (optional):**

```json
{
  "cancellationReason": "too_expensive",
  "feedback": "Would like more features for the price"
}
```

---

### Resume Subscription

Resume a paused subscription.

| Setting       | Value                                                               |
| ------------- | ------------------------------------------------------------------- |
| **Method**    | `POST`                                                              |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/subscriptions/resume` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                         |
| **Body**      | `{}`                                                                |

---

### Get Subscription History

View all subscription transactions.

| Setting     | Value                                                                |
| ----------- | -------------------------------------------------------------------- |
| **Method**  | `GET`                                                                |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/data/subscriptions/history` |
| **Headers** | `Authorization: Bearer <your_access_token>`                          |

**Query Parameters:** `?months=12` (optional, defaults to 12)

---

### Preview Plan Change

Preview proration before changing plans.

| Setting       | Value                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| **Method**    | `POST`                                                                      |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/data/subscriptions/preview-change` |
| **Headers**   | `Authorization: Bearer <your_access_token>`                                 |
| **Body Type** | raw → JSON                                                                  |

**Body:**

```json
{
  "newBillingInterval": "annual"
}
```

**Expected Response:**

```json
{
  "success": true,
  "currentPlan": "Premium Monthly",
  "newPlan": "Premium Annual",
  "prorationAmount": 5.50,
  "nextInvoiceAmount": 89.99,
  "currency": "USD"
}
```

---

### Subscription Testing Scenarios

#### Database Verification Queries

After performing subscription actions, verify database state:

```sql
-- Check user subscription status
SELECT UserId, [plan], status, billing_interval, 
       transaction_type, transaction_date, cancel_at_period_end
FROM user_subscriptions WHERE UserId = @userId;

-- Check transaction history
SELECT transaction_id, transaction_type, transaction_date,
       from_plan, to_plan, amount, proration_amount
FROM subscription_transactions 
WHERE UserId = @userId ORDER BY transaction_date DESC;
```

#### Error Handling Tests

| Test Case | Expected Error |
|-----------|----------------|
| Change to same plan | "Already on this plan" |
| Pause for 0 or 4+ months | "Pause duration must be between 1 and 3 months" |
| Manage subscription as Free user | "No subscription found" (404) |
| Call without auth token | 401 Unauthorized |

#### Webhook Events to Monitor

When testing subscription changes, verify these Stripe webhook events:
- `customer.subscription.updated` - Plan changes
- `invoice.payment_succeeded` - Proration charges
- `customer.subscription.deleted` - Cancellation completion

**Test with Stripe CLI:**
```bash
stripe listen --forward-to localhost:3000/api/data/webhook
```

---

## 🔒 Testing Security Fixes

This section provides specific tests to verify that security fixes are working correctly.

> **For detailed error code meanings and handling guidance**, see [Error Codes Reference](BACKEND_DEVELOPER_GUIDE.md#5-error-codes-reference).

---

### Test 1: Signup Atomicity (Fix #1)

**What it tests:** Race condition prevention and transaction atomicity during signup.

**Test Procedure:**

1. Create a Postman Collection Runner with 2 iterations of the same signup request
2. Set delay to 0ms (concurrent execution)
3. Both should NOT create duplicate accounts

**Expected Results:**

- First request: `200 OK` with user created
- Second request: `409 Conflict` with "Email already registered"

**Quick Manual Test:**

```json
// Try to sign up twice rapidly with same email
POST /auth/signup
{
  "email": "atomicity-test@example.com",
  "password": "Test123!",
  "firstName": "Test",
  "lastName": "User",
  "phoneNumber": "+12025551111"
}
```

---

### Test 3: Phone Number Required (Fix #3)

**What it tests:** Phone number is mandatory during signup.

| Setting       | Value                                                 |
| ------------- | ----------------------------------------------------- |
| **Method**    | `POST`                                                |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/signup` |
| **Body Type** | raw → JSON                                            |

**Body (missing phone):**

```json
{
  "email": "nophone@example.com",
  "password": "SecurePassword123",
  "firstName": "Test",
  "lastName": "User"
}
```

**Expected Response (400 Bad Request):**

```json
{
  "success": false,
  "message": "Phone number is required"
}
```

---

### Test 4: Refresh Token Race Condition (Fix #4)

**What it tests:** Optimistic locking prevents concurrent refresh token usage.

**Test Procedure:**

1. Sign in and save the `refreshToken`
2. Open two Postman tabs with the same refresh token request
3. Send both requests simultaneously (or use Collection Runner)

**Request:**

```json
POST /auth/refresh-token
{
  "refreshToken": "eyJhbGci...same_token_in_both"
}
```

**Expected Results:**

- First request: `200 OK` with new tokens
- Second request: `401 Unauthorized` with:

```json
{
  "success": false,
  "message": "Token has already been rotated. Please login again.",
  "errorCode": "TOKEN_ALREADY_ROTATED",
  "requireLogin": true
}
```

---

### Test 5: Password Reset Race Condition (Fix #5)

**What it tests:** Atomic password reset prevents token reuse.

**Test Procedure:**

1. Request forgot password to get a reset code/token
2. Prepare two reset password requests with the same code
3. Send both simultaneously

**Request:**

```json
POST /auth/reset-password
{
  "email": "testuser@example.com",
  "resetToken": "abc123...same_token",
  "newPassword": "NewPassword456"
}
```

**Expected Results:**

- First request: `200 OK` - password changed
- Second request: `400 Bad Request` with:

```json
{
  "success": false,
  "message": "Token has already been used. Please request a new password reset.",
  "errorCode": "TOKEN_ALREADY_USED"
}
```

---

### Test 6: MFA Session Token Race Condition (Fix #6)

**What it tests:** MFA session token can only be used once.

**Test Procedure:**

1. Sign in with MFA-enabled account to get `mfaSessionToken`
2. Get the MFA code from your phone/email
3. Prepare two verify-mfa-login requests
4. Send both simultaneously

**Request:**

```json
POST /auth/verify-mfa-login
{
  "userId": 32,
  "mfaSessionToken": "abc123...same_token",
  "code": "123456",
  "method": "sms"
}
```

**Expected Results:**

- First request: `200 OK` with tokens
- Second request: `401 Unauthorized` with:

```json
{
  "success": false,
  "message": "MFA session has already been used. Please sign in again.",
  "errorCode": "MFA_SESSION_ALREADY_USED",
  "requireLogin": true
}
```

---

### Test 7: Email Case Sensitivity (Fix #7)

**What it tests:** All email operations are case-insensitive.

**Test Steps:**

1. **Check Email (different cases):**

```
GET /auth/checkemail?email=TestUser@Example.com
GET /auth/checkemail?email=testuser@example.com
GET /auth/checkemail?email=TESTUSER@EXAMPLE.COM
```

All should return `{ "exists": true }` if account exists (or all `false` if not).

2. **Sign In (different case from signup):**

```json
POST /auth/signin
{
  "email": "TESTUSER@EXAMPLE.COM",
  "password": "SecurePassword123"
}
```

Should work if account was created with `testuser@example.com`.

3. **Send OTP (different case):**

```json
POST /auth/send-email-otp
{
  "email": "TestUser@Example.COM",
  "purpose": "signin"
}
```

Should find the account regardless of case.

---

### Test 8: Logged In Elsewhere Detection (Fix #8)

**What it tests:** When user logs in on another device, first device gets clear error.

**Test Procedure:**

1. Sign in on "Device A" - save `refreshToken`
2. Sign in on "Device B" with same account (this invalidates Device A's token)
3. Try to refresh token on Device A

**Request (from Device A after Device B login):**

```json
POST /auth/refresh-token
{
  "refreshToken": "eyJhbGci...device_a_old_token"
}
```

**Expected Response (401):**

```json
{
  "success": false,
  "message": "Your session was ended because you signed in on another device",
  "errorCode": "LOGGED_IN_ELSEWHERE",
  "requireLogin": true
}
```

---

### Test 10: Signup Case-Insensitive Duplicate Check (Fix #10)

**What it tests:** Can't create duplicate accounts with different email cases.

**Test Procedure:**

1. Sign up with `lowercase@example.com`
2. Try to sign up with `LOWERCASE@example.com`

**Second Request:**

```json
POST /auth/signup
{
  "email": "LOWERCASE@example.com",
  "password": "Test123!",
  "firstName": "Test",
  "lastName": "User",
  "phoneNumber": "+12025552222"
}
```

**Expected Response (409 Conflict):**

```json
{
  "success": false,
  "message": "Email already registered"
}
```

---

### Test 11: Forgot Password Rate Limit Case-Insensitive (Fix #11)

**What it tests:** Rate limiting works regardless of email case.

**Test Procedure:**

1. Send multiple forgot-password requests using different cases
2. All should count toward the same rate limit

**Requests:**

```json
// Request 1
POST /auth/forgot-password
{ "email": "test@example.com" }

// Request 2
POST /auth/forgot-password
{ "email": "TEST@example.com" }

// Request 3
POST /auth/forgot-password
{ "email": "Test@Example.COM" }
```

**Expected:** After hitting the limit, all case variations should be blocked with `429 Too Many Requests`.

---

### Test 12: Profile Update Authorization (Fix #12)

**What it tests:** Profile update requires authentication and authorization.

**Test 1: No Authentication**

| Setting       | Value                                                            |
| ------------- | ---------------------------------------------------------------- |
| **Method**    | `PUT`                                                            |
| **URL**       | `https://apogeehnp.azurewebsites.net/api/auth/update-profile/32` |
| **Headers**   | None                                                             |
| **Body Type** | raw → JSON                                                       |

**Body:**

```json
{
  "firstName": "Hacker"
}
```

**Expected Response (401 Unauthorized):**

```json
{
  "success": false,
  "message": "Access token required"
}
```

**Test 2: Wrong User (Authorization)**

| Setting     | Value                                                            |
| ----------- | ---------------------------------------------------------------- |
| **Method**  | `PUT`                                                            |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/auth/update-profile/99` |
| **Headers** | `Authorization: Bearer <token_for_user_32>`                      |

**Expected Response (403 Forbidden):**

```json
{
  "success": false,
  "message": "You can only update your own profile"
}
```

---

### Test 12b: OTP Rate Limiting (Fix #12)

**What it tests:** OTP requests are limited to 15 per hour.

**Test Procedure:**

1. Send 16 OTP requests for the same phone/email

**Expected:** After 15 requests, you'll receive `429 Too Many Requests`:

```json
{
  "success": false,
  "message": "Rate limit exceeded. Please try again later.",
  "remainingTime": 3600
}
```

---

### Test 15: Account Deletion Security (Fix #15)

**What it tests:** Account deletion requires MFA (if enabled) and cleans up all data.

**Test 1: With MFA Enabled**

1. Enable MFA on your account (Step 13)
2. Try to delete account without MFA verification

| Setting     | Value                                                  |
| ----------- | ------------------------------------------------------ |
| **Method**  | `DELETE`                                               |
| **URL**     | `https://apogeehnp.azurewebsites.net/api/user/profile` |
| **Headers** | `Authorization: Bearer <your_access_token>`            |

**Expected Response (403 Forbidden):**

```json
{
  "success": false,
  "message": "MFA verification required for this action",
  "mfaRequired": true,
  "operation": "delete_account"
}
```

**Test 2: Complete Deletion Flow (with MFA)**

1. Complete MFA verification (get MFA token)
2. Include MFA token in delete request
3. Verify account is fully deleted

---

## Troubleshooting

> **For detailed error code meanings and recommended frontend actions**, see [Error Codes Reference](BACKEND_DEVELOPER_GUIDE.md#5-error-codes-reference).
>
> **For configuration values (token expiry, rate limits, etc.)**, see [Configuration Reference](BACKEND_DEVELOPER_GUIDE.md#6-configuration-reference).

### Common Errors

| Error                           | Cause                              | Solution                                           |
| ------------------------------- | ---------------------------------- | -------------------------------------------------- |
| `401 Unauthorized`              | Missing or expired token           | Get a new access token via signin or refresh-token |
| `400 Invalid email or password` | Wrong credentials                  | Double-check email and password                    |
| `403 Forbidden`                 | Not authorized for resource        | Check you're accessing your own data               |
| `404 Not Found`                 | Resource doesn't exist             | Verify the ID/resource path is correct             |
| `409 Email already registered`  | Duplicate signup                   | Use signin instead, or use a different email       |
| `429 Too many requests`         | Rate limit hit                     | Wait a few minutes before trying again             |
| `OTP_INVALID`                   | Wrong or expired code              | Request a new code and try again                   |
| `MFA_SESSION_EXPIRED`           | Took too long                      | Start the signin process over                      |
| `TOKEN_EXPIRED`                 | Refresh token expired              | Need to sign in again with password                |
| `TOKEN_ALREADY_ROTATED`         | Concurrent refresh request         | Login again - token was used by another request    |
| `TOKEN_ALREADY_USED`            | Password reset token reused        | Request a new password reset                       |
| `MFA_SESSION_ALREADY_USED`      | MFA session used by another device | Sign in again from the beginning                   |
| `LOGGED_IN_ELSEWHERE`           | Logged in on another device        | Sign in again - your session was replaced          |
| `CODE_ALREADY_USED`             | OTP code used concurrently         | Request a new code                                 |
| `USAGE_LIMIT_EXCEEDED`          | Weekly AI query limit reached      | Wait until next week or upgrade to premium         |
| `SUBSCRIPTION_REQUIRED`         | Premium feature without subscription | Subscribe to access premium features             |
| `INVALID_SUBSCRIPTION_STATE`    | Invalid operation for current state | Check subscription status before action           |

### New Error Codes (Security Fixes)

| Error Code                 | Fix # | Meaning                                      |
| -------------------------- | ----- | -------------------------------------------- |
| `TOKEN_ALREADY_ROTATED`    | #4    | Refresh token was already used               |
| `TOKEN_ALREADY_USED`       | #5    | Password reset token was already used        |
| `CODE_ALREADY_USED`        | #5    | OTP code was already used for password reset |
| `MFA_SESSION_ALREADY_USED` | #6    | MFA session token was already consumed       |
| `LOGGED_IN_ELSEWHERE`      | #8    | Another device logged in with your account   |

### Feature Error Codes

| Error Code                   | Feature       | Meaning                                     |
| ---------------------------- | ------------- | ------------------------------------------- |
| `USAGE_LIMIT_EXCEEDED`       | Chatbot       | Weekly AI query limit reached               |
| `SUBSCRIPTION_REQUIRED`      | Subscriptions | Premium feature requires active subscription |
| `INVALID_SUBSCRIPTION_STATE` | Subscriptions | Operation not valid for current status      |
| `PLAN_NOT_FOUND`             | Workout Plans | Requested workout plan doesn't exist        |
| `ALREADY_SUBSCRIBED`         | Subscriptions | User already has an active subscription     |

### Checklist When Things Don't Work

1. ✅ Is the URL correct? Check for typos
2. ✅ Is the method correct? (POST vs GET)
3. ✅ Is the body set to `raw` → `JSON`?
4. ✅ Is the JSON valid? (no trailing commas, proper quotes)
5. ✅ For protected routes, is the `Authorization` header set?
6. ✅ Is the token still valid? Try refreshing it
7. ✅ Are you using the right userId from your signin response?
8. ✅ **NEW:** Check if you got `LOGGED_IN_ELSEWHERE` - you may need to sign in again
9. ✅ **NEW:** For race condition errors, start the flow over with fresh tokens

### Quick Copy: Authorization Header

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Complete Testing Checklist

Use this to verify all features work:

- [ ] **Basic Auth**

  - [ ] Check email exists (+ test case insensitivity)
  - [ ] Sign up new user (+ verify phone required)
  - [ ] Sign in with email/password (+ test case insensitivity)
  - [ ] Get auth status
  - [ ] Refresh token
  - [ ] Logout

- [ ] **Phone OTP**

  - [ ] Check phone exists
  - [ ] Send phone OTP (+ verify rate limit at 15/hour)
  - [ ] Verify phone OTP
  - [ ] Sign in with phone OTP

- [ ] **Email OTP**

  - [ ] Send email OTP (+ verify rate limit at 15/hour)
  - [ ] Verify email OTP (+ test case insensitivity)
  - [ ] Sign in with email OTP (using two-step flow)

- [ ] **MFA**

  - [ ] Setup MFA
  - [ ] Sign in with MFA enabled
  - [ ] Send MFA code
  - [ ] Verify MFA login
  - [ ] Disable MFA

- [ ] **Password Reset**

  - [ ] Forgot password (+ test case-insensitive rate limit)
  - [ ] Reset password with code
  - [ ] Sign in with new password

- [ ] **User Profile**

  - [ ] Get user profile
  - [ ] Update user profile
  - [ ] Delete user account

- [ ] **Data Routes**

  - [ ] Create/Read/Update/Delete daily logs
  - [ ] Get weekly dashboard summary
  - [ ] Create/Read/Update/Delete exercise instances
  - [ ] Create/Read/Update/Delete workout routines
  - [ ] Get workout routines by date
  - [ ] Create/Read/Update/Delete mesocycles
  - [ ] Create/Read/Update/Delete microcycles

- [ ] **AI Workout Plans**

  - [ ] Get all workout plans
  - [ ] Get most recent workout plan
  - [ ] Get workout plan by ID
  - [ ] Update workout plan status
  - [ ] Delete workout plan

- [ ] **Chatbot / AI Assistant**

  - [ ] Send message to AI (general inquiry)
  - [ ] Send message to AI (workout plan request)
  - [ ] Get chat history
  - [ ] Clear chat history
  - [ ] Verify usage limits (free vs premium)

- [ ] **Usage Tracking**

  - [ ] Get current usage stats
  - [ ] Get usage history
  - [ ] Reset usage (testing)

- [ ] **Subscription Management**

  - [ ] Initialize payment
  - [ ] Confirm payment
  - [ ] Change subscription plan
  - [ ] Pause subscription
  - [ ] Resume subscription
  - [ ] Cancel subscription
  - [ ] Get subscription history

- [ ] **Security Fixes Verification**

  - [ ] Email case sensitivity works across all endpoints
  - [ ] Phone number required at signup
  - [ ] Profile update requires auth + correct user
  - [ ] Rate limits enforced (15 OTP/hour)
  - [ ] LOGGED_IN_ELSEWHERE error when signing in elsewhere
  - [ ] TOKEN_ALREADY_ROTATED on concurrent refresh
  - [ ] MFA_SESSION_ALREADY_USED on concurrent MFA verify
  - [ ] TOKEN_ALREADY_USED on concurrent password reset
  - [ ] Account deletion requires MFA (if enabled)

---

> 📖 **API Documentation:** Swagger docs are available at `https://apogeehnp.azurewebsites.net/api/docs`

> 📚 **Backend Architecture:** For system internals, see [Backend Developer Guide](BACKEND_DEVELOPER_GUIDE.md)

> ℹ️ **Note:** Biometric authentication (Face ID/Touch ID) is now handled locally on the device and does not use backend endpoints.

---

*Last updated: January 2, 2026*

