# Email OTP Integration - Quick Start Guide

## 🚀 Getting Started

This guide will help you deploy and test the email OTP integration.

## ⚡ Quick Deployment (3 Steps)

### Step 1: Run Database Migration

Choose one option:

**Option A: Using Node.js script (Recommended)**
```bash
node scripts/run-email-verification-migration.js
```

**Option B: Using SQL script directly**
- Open Azure SQL Query Editor
- Run `scripts/add_email_verification_purposes.sql`

### Step 2: Restart Your Server

**If using Azure App Service:**
- Go to Azure Portal → Your App Service → Overview
- Click "Restart"
- Wait for app to restart (30-60 seconds)

**If running locally:**
```bash
# Stop server (Ctrl+C)
# Then restart:
npm start
```

**If using PM2:**
```bash
pm2 restart server
```

### Step 3: Test the Implementation

```bash
node scripts/test-email-otp.js
```

Follow the interactive prompts to test:
1. ✅ Signup with email OTP
2. ✅ Signin with email OTP (passwordless)
3. ✅ MFA with email
4. ✅ Password reset with email OTP

## 📝 Quick API Examples

### Signup Flow

**1. Send OTP for signup:**
```bash
curl -X POST https://your-api.azurewebsites.net/api/auth/send-email-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "newuser@example.com", "purpose": "signup"}'
```

**2. Verify OTP:**
```bash
curl -X POST https://your-api.azurewebsites.net/api/auth/verify-email-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "newuser@example.com", "code": "123456", "purpose": "signup"}'
```

**3. Complete signup:**
```bash
curl -X POST https://your-api.azurewebsites.net/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "securepassword",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

### Passwordless Signin

**1. Send OTP:**
```bash
curl -X POST https://your-api.azurewebsites.net/api/auth/send-email-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "purpose": "signin"}'
```

**2. Verify OTP (get tokens directly):**
```bash
curl -X POST https://your-api.azurewebsites.net/api/auth/verify-email-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "code": "123456", "purpose": "signin"}'
```

Response includes `accessToken`, `refreshToken`, and `user` object!

## 🧪 Testing Checklist

Use this checklist to verify everything works:

- [ ] Database migration completed successfully
- [ ] Server restarted without errors
- [ ] Test script runs without errors
- [ ] Can send OTP for signup
- [ ] Can verify OTP for signup
- [ ] Can send OTP for signin
- [ ] Can verify OTP for signin (returns tokens)
- [ ] Can send MFA code via email
- [ ] Can verify MFA code
- [ ] Can send password reset OTP
- [ ] Can verify password reset OTP
- [ ] Rate limiting works (429 after many attempts)
- [ ] OTP expires after 10 minutes

## 🔍 Troubleshooting

### Migration fails
**Error:** Constraint already exists
**Solution:** The migration is idempotent - it's safe to run multiple times. The constraint is already updated.

### OTP not received
**Check:**
1. Is Twilio Verify configured correctly? (`TWILIO_VERIFY_SERVICE_SID`)
2. Is SendGrid integrated in Twilio Verify console?
3. Check spam/junk folder
4. Check Twilio Verify logs in dashboard

### "User not found" for signin
**Issue:** Trying to signin with email that doesn't exist
**Solution:** Use `/auth/send-email-otp` with `purpose: "signup"` first

### "Email already registered" for signup
**Issue:** Email already exists in database
**Solution:** Use `purpose: "signin"` instead, or use a different email

### Rate limit errors (429)
**Issue:** Too many OTP requests
**Solution:** Wait 1 hour, or manually clear `OTPVerifications` table for testing

## 📊 Monitoring

### Check logs for OTP activity:

**Azure App Service:**
- Go to Azure Portal → Your App Service → Log Stream
- Look for:
  - `Email OTP sent successfully`
  - `Email OTP verified successfully`
  - `Signup email verification complete`

**Local Development:**
```bash
# Server logs will show:
# [timestamp] 📥 POST /api/auth/send-email-otp
# Email OTP sent successfully: { email: 'use***', purpose: 'signup', ... }
```

### Check database:

```sql
-- View recent OTP attempts
SELECT TOP 50 
  UserID, 
  PhoneOrEmail, 
  Purpose, 
  Status, 
  CreatedAt
FROM dbo.OTPVerifications
ORDER BY CreatedAt DESC;

-- Count OTP attempts by purpose
SELECT Purpose, Status, COUNT(*) as Count
FROM dbo.OTPVerifications
GROUP BY Purpose, Status
ORDER BY Purpose, Status;
```

## 🎯 Next Steps

1. ✅ **Frontend Integration**
   - Update your frontend to use new email OTP endpoints
   - Add UI for email verification during signup
   - Add passwordless login option

2. ✅ **User Communication**
   - Inform users about new passwordless login option
   - Update help documentation
   - Update email templates in Twilio/SendGrid

3. ✅ **Monitoring**
   - Set up alerts for high OTP failure rates
   - Monitor rate limit hits
   - Track OTP verification success rates

## 📚 Documentation

- **Full Implementation Guide:** See `EMAIL_OTP_IMPLEMENTATION.md`
- **Plan Document:** See `.cursor/plans/backend_email_otp_integration_4d48d4e0.plan.md`
- **API Documentation:** See `EMAIL_OTP_IMPLEMENTATION.md` → API Endpoint Summary

## 🆘 Support

If you encounter issues:

1. Check `EMAIL_OTP_IMPLEMENTATION.md` for detailed documentation
2. Run test script: `node scripts/test-email-otp.js`
3. Check server logs for error messages
4. Verify Twilio Verify configuration
5. Check database constraint is updated correctly

## ✨ Summary

**What You Get:**
- ✅ Email verification during signup
- ✅ Passwordless login via email OTP
- ✅ MFA via email (already working)
- ✅ Enhanced password reset flow
- ✅ All with existing Twilio + SendGrid setup

**No Breaking Changes:**
- ✅ All existing endpoints still work
- ✅ Phone OTP still works
- ✅ Password login still works
- ✅ Existing security measures intact

**Time to Deploy:** < 5 minutes 🚀







