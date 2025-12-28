# Email OTP Integration - Implementation Guide

## ✅ Implementation Complete

This document describes the email OTP integration that extends the existing Twilio Verify + SendGrid infrastructure to support signup, signin, and MFA flows via email.

## 🎯 Overview

The backend now supports **5 email OTP purposes**:
1. **signup** - Email verification during account creation
2. **verification** - Alternative name for signup (frontend compatibility)
3. **signin** - Direct signin using email OTP (passwordless)
4. **mfa** - Multi-factor authentication via email
5. **password_reset** - Password recovery flow

## 📋 What Was Implemented

### 1. Database Migration ✅

**Files:**
- `scripts/add_email_verification_purposes.sql`
- `scripts/run-email-verification-migration.js`

**Changes:**
- Updated `OTPVerifications` table constraint to allow `'verification'` purpose
- Constraint now allows: `login`, `signin`, `signup`, `mfa`, `password_reset`, `phone_verify`, `verification`

**How to run:**
```bash
# Option 1: Run SQL script directly in Azure SQL Database
# Use scripts/add_email_verification_purposes.sql

# Option 2: Run Node.js migration script
node scripts/run-email-verification-migration.js
```

### 2. Extended `/auth/send-email-otp` Endpoint ✅

**Location:** `routes/authRoutes.js` (line ~1760)

**New Features:**
- ✅ Validates purpose parameter (must be one of the 5 valid purposes)
- ✅ **For signup/verification**: Checks that email is NOT already registered
- ✅ **For signin/mfa**: Checks that user EXISTS in database
- ✅ **For password_reset**: Maintains existing security (doesn't reveal if email exists)
- ✅ Rate limiting applies to all purposes
- ✅ Records OTP attempts in database

**API Request:**
```json
POST /api/auth/send-email-otp
{
  "email": "user@example.com",
  "purpose": "signup" | "verification" | "signin" | "mfa" | "password_reset"
}
```

**API Response:**
```json
{
  "success": true,
  "message": "Verification code sent successfully",
  "remainingAttempts": 99
}
```

**Error Responses:**
- `400` - Invalid email format or purpose
- `404` - User not found (for signin/mfa)
- `409` - Email already registered (for signup/verification)
- `429` - Rate limit exceeded
- `500` - Server error

### 3. Extended `/auth/verify-email-otp` Endpoint ✅

**Location:** `routes/authRoutes.js` (line ~1849)

**New Features:**
- ✅ **For signup/verification**: Returns `{ verified: true }` - user can proceed to complete signup
- ✅ **For signin/mfa**: Returns full authentication tokens (accessToken, refreshToken, user info)
- ✅ **For password_reset**: Returns resetToken for password reset authorization
- ✅ Updates OTP status in database
- ✅ Resets rate limit on successful verification

**API Request:**
```json
POST /api/auth/verify-email-otp
{
  "email": "user@example.com",
  "code": "123456",
  "purpose": "signup" | "verification" | "signin" | "mfa" | "password_reset"
}
```

**API Responses:**

**Signup/Verification:**
```json
{
  "success": true,
  "message": "Email verified successfully",
  "verified": true
}
```

**Signin/MFA:**
```json
{
  "success": true,
  "message": "Login successful!",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "user": {
    "id": 123,
    "email": "user@example.com",
    "phoneNumber": "+12345678900",
    "phoneVerified": true,
    "preferredLoginMethod": "email",
    "mfaEnabled": false,
    "biometricEnabled": false
  }
}
```

**Password Reset:**
```json
{
  "success": true,
  "message": "Email verified successfully",
  "verified": true,
  "resetToken": "a1b2c3d4..."
}
```

### 4. Enhanced Signup Endpoint ✅

**Location:** `routes/authRoutes.js` (line ~44)

**New Features:**
- ✅ Checks for email verification in last 30 minutes
- ✅ Logs email verification status during signup
- ✅ Supports both phone OTP and email OTP verification before signup

**Verification Check:**
```javascript
// Checks OTPVerifications table for approved email verification
// Within last 30 minutes with purpose 'signup' or 'verification'
```

### 5. Test Suite ✅

**File:** `scripts/test-email-otp.js`

**Features:**
- ✅ Interactive test menu
- ✅ Tests all 4 email OTP flows:
  1. Signup with email OTP
  2. Signin with email OTP (passwordless)
  3. MFA with email
  4. Password reset with email OTP
- ✅ Step-by-step prompts for manual testing
- ✅ Displays requests and responses

**How to run:**
```bash
node scripts/test-email-otp.js
```

## 🔐 Security Features

All existing security measures remain in place:

✅ **Rate Limiting**
- Max 100 OTP attempts per hour per email/phone
- Implemented via `checkRateLimit()` function
- Tracked in `OTPVerifications` table

✅ **OTP Expiry**
- Twilio Verify OTP codes expire after 10 minutes
- Reset tokens expire after 10 minutes
- MFA session tokens expire after 10 minutes

✅ **Secure Storage**
- All OTP attempts recorded in database
- Reset tokens hashed and stored securely
- Refresh tokens stored with expiration

✅ **Input Validation**
- Email format validation
- Purpose parameter validation
- Code format validation

✅ **Error Handling**
- Password reset doesn't reveal if email exists
- Generic error messages for security
- Proper HTTP status codes

## 📊 API Flow Diagrams

### Signup Flow with Email OTP

```
Frontend                    Backend                     Twilio/SendGrid
   |                           |                              |
   |-- POST /send-email-otp -->|                              |
   |   (email, purpose=signup) |                              |
   |                           |-- Check email not exists --> |
   |                           |-- sendEmailOTP() ----------->|
   |                           |<---- OTP sent via email -----|
   |<-- Success (200) ---------|                              |
   |                           |                              |
   |                           |                              |
   |-- POST /verify-email-otp->|                              |
   |   (email, code, signup)   |                              |
   |                           |-- verifyEmailOTP() --------->|
   |                           |<---- Verification status ----|
   |<-- { verified: true } ----|                              |
   |                           |                              |
   |-- POST /signup ---------->|                              |
   |   (email, password, ...)  |                              |
   |<-- { tokens, user } ------|                              |
```

### Signin Flow with Email OTP (Passwordless)

```
Frontend                    Backend                     Twilio/SendGrid
   |                           |                              |
   |-- POST /send-email-otp -->|                              |
   |   (email, purpose=signin) |                              |
   |                           |-- Check user exists -------> |
   |                           |-- sendEmailOTP() ----------->|
   |                           |<---- OTP sent via email -----|
   |<-- Success (200) ---------|                              |
   |                           |                              |
   |-- POST /verify-email-otp->|                              |
   |   (email, code, signin)   |                              |
   |                           |-- verifyEmailOTP() --------->|
   |                           |<---- Verification status ----|
   |                           |-- Generate tokens ---------->|
   |<-- { tokens, user } ------|                              |
```

### MFA Flow with Email (Existing - Already Working)

```
Frontend                    Backend                     Twilio/SendGrid
   |                           |                              |
   |-- POST /signin ---------->|                              |
   |   (email, password)       |                              |
   |                           |-- Validate credentials ----> |
   |                           |-- MFA enabled? ------------> |
   |<-- { mfaRequired: true,   |                              |
   |     mfaSessionToken } ----|                              |
   |                           |                              |
   |-- POST /send-mfa-code --->|                              |
   |   (userId, method=email)  |                              |
   |                           |-- sendEmailOTP() ----------->|
   |                           |<---- OTP sent via email -----|
   |<-- Success (200) ---------|                              |
   |                           |                              |
   |-- POST /verify-mfa-login->|                              |
   |   (userId, code, token)   |                              |
   |                           |-- Validate MFA session ----> |
   |                           |-- verifyEmailOTP() --------->|
   |                           |<---- Verification status ----|
   |                           |-- Generate tokens ---------->|
   |<-- { tokens, user } ------|                              |
```

## 🧪 Testing Checklist

Use `scripts/test-email-otp.js` to test each flow:

- [ ] **Signup Flow**
  - [ ] Send OTP to unregistered email → Success
  - [ ] Send OTP to existing email → Error 409
  - [ ] Verify with correct code → `{ verified: true }`
  - [ ] Verify with wrong code → Error 400
  - [ ] Complete signup after verification → Success

- [ ] **Signin Flow**
  - [ ] Send OTP to registered email → Success
  - [ ] Send OTP to unregistered email → Error 404
  - [ ] Verify with correct code → Returns tokens
  - [ ] Verify with wrong code → Error 400

- [ ] **MFA Flow**
  - [ ] MFA-enabled user signs in → Receives mfaSessionToken
  - [ ] Send MFA code via email → Success
  - [ ] Verify MFA code → Returns tokens
  - [ ] Invalid MFA code → Error 400
  - [ ] Expired MFA session → Error 401

- [ ] **Password Reset**
  - [ ] Send reset OTP → Success (doesn't reveal if email exists)
  - [ ] Verify OTP → Returns resetToken
  - [ ] Reset password with valid token → Success
  - [ ] Reset password with expired token → Error 400

- [ ] **Rate Limiting**
  - [ ] Test 100+ requests within 1 hour → Error 429

- [ ] **OTP Expiry**
  - [ ] Wait 10+ minutes after OTP sent → Code expires

## 🌐 Environment Variables

Ensure these are configured in your `.env` or Azure App Service:

```bash
# Twilio Verify Configuration
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Database Configuration
DB_HOST=your-server.database.windows.net
DB_NAME=your-database
DB_USER=your-username
DB_PASSWORD=your-password

# JWT Configuration
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret
```

**Note:** SendGrid is configured in the Twilio Verify console, not via environment variables.

## 📦 API Endpoint Summary

| Endpoint | Method | Purpose Support | Returns |
|----------|--------|----------------|---------|
| `/auth/send-email-otp` | POST | `signup`, `verification`, `signin`, `mfa`, `password_reset` | `{ success, message }` |
| `/auth/verify-email-otp` | POST | `signup`, `verification`, `signin`, `mfa`, `password_reset` | Varies by purpose (see above) |
| `/auth/send-mfa-code` | POST | Already supports email ✅ | `{ success, method }` |
| `/auth/verify-mfa-login` | POST | Already supports email ✅ | `{ success, tokens, user }` |
| `/auth/signup` | POST | Enhanced with email verification check ✅ | `{ success, tokens, user }` |

## 🔄 Migration Steps

1. **Run Database Migration:**
   ```bash
   node scripts/run-email-verification-migration.js
   ```

2. **Restart Server:**
   ```bash
   # If using pm2
   pm2 restart server
   
   # Or restart Azure App Service
   ```

3. **Test Implementation:**
   ```bash
   node scripts/test-email-otp.js
   ```

## 🚀 Frontend Integration

The frontend can now use these flows:

### Signup with Email OTP
```javascript
// 1. Send OTP
await fetch('/api/auth/send-email-otp', {
  method: 'POST',
  body: JSON.stringify({ email: 'user@example.com', purpose: 'signup' })
});

// 2. User enters code
await fetch('/api/auth/verify-email-otp', {
  method: 'POST',
  body: JSON.stringify({ email: 'user@example.com', code: '123456', purpose: 'signup' })
});

// 3. Complete signup
await fetch('/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ email: 'user@example.com', password: '...', ... })
});
```

### Passwordless Signin with Email OTP
```javascript
// 1. Send OTP
await fetch('/api/auth/send-email-otp', {
  method: 'POST',
  body: JSON.stringify({ email: 'user@example.com', purpose: 'signin' })
});

// 2. Verify and get tokens directly
const response = await fetch('/api/auth/verify-email-otp', {
  method: 'POST',
  body: JSON.stringify({ email: 'user@example.com', code: '123456', purpose: 'signin' })
});

const { accessToken, refreshToken, user } = await response.json();
```

## 🎉 Summary

**What's New:**
- ✅ Email OTP for signup (verify email before account creation)
- ✅ Email OTP for signin (passwordless login)
- ✅ Email OTP for MFA (already working, confirmed functional)
- ✅ Extended password reset with new flow options
- ✅ Database constraint updated for new purposes
- ✅ Comprehensive test suite for all flows

**What's Unchanged:**
- ✅ All existing security measures
- ✅ Phone OTP flows (still working as before)
- ✅ Password-based login (still available)
- ✅ Rate limiting and OTP expiry
- ✅ Existing MFA functionality

**Zero Breaking Changes** - All existing functionality preserved! 🎊






