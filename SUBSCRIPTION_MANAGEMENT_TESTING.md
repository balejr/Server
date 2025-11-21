# Subscription Management Testing Guide

This guide covers testing the new in-app subscription management features.

## Overview

The new subscription management system allows users to manage their subscriptions directly within the app, replacing the Stripe Customer Portal redirect.

### Features to Test
1. **Plan Changes** (Upgrade/Downgrade)
2. **Subscription Pause** (1-3 months)
3. **Subscription Cancellation** (End of period)
4. **Subscription Resume**
5. **Transaction History**
6. **Proration Preview**

---

## Prerequisites

### Backend Setup
1. Server running with database connection
2. Stripe test API keys configured in `.env`
3. Test user with active subscription

### Frontend Setup
1. React Native app running (iOS/Android)
2. Test user logged in
3. Active Premium subscription

### Environment Variables
```bash
# .env (Server)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID_MONTHLY=price_...
STRIPE_PRICE_ID_SEMI_ANNUAL=price_...
STRIPE_PRICE_ID_ANNUAL=price_...
```

---

## Testing Scenarios

### 1. Get Subscription Status

**Endpoint:** `GET /api/data/users/subscription/status`

**Test Steps:**
1. Authenticate user
2. Call endpoint with Bearer token
3. Verify response contains:
   - `plan`
   - `status`
   - `billing_interval`
   - `current_period_end`
   - `cancel_at_period_end`

**Expected Result:**
```json
{
  "plan": "Premium Monthly",
  "status": "active",
  "billing_interval": "monthly",
  "current_period_end": "2024-12-31T00:00:00Z",
  "cancel_at_period_end": false
}
```

---

### 2. Preview Plan Change

**Endpoint:** `POST /api/data/subscriptions/preview-change`

**Test Steps:**
1. Call with different `newBillingInterval` (monthly, semi_annual, annual)
2. Verify proration calculation
3. Check that preview doesn't modify subscription

**Request:**
```json
{
  "newBillingInterval": "annual"
}
```

**Expected Result:**
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

### 3. Change Plan (Upgrade)

**Endpoint:** `POST /api/data/subscriptions/change-plan`

**Test Steps:**
1. Preview change first
2. Confirm change
3. Verify in Stripe Dashboard
4. Check database updates:
   - `user_subscriptions.billing_interval`
   - `user_subscriptions.transaction_type` = 'upgrade'
   - New record in `subscription_transactions`

**Request:**
```json
{
  "newBillingInterval": "annual"
}
```

**Expected Result:**
```json
{
  "success": true,
  "subscriptionId": "sub_...",
  "newPlan": "Premium Annual",
  "newBillingInterval": "annual",
  "prorationAmount": 5.50,
  "transactionId": 123,
  "nextBillingDate": "2025-11-21T00:00:00Z"
}
```

**Database Verification:**
```sql
-- Check user_subscriptions
SELECT billing_interval, transaction_type, transaction_date
FROM user_subscriptions
WHERE UserId = @userId;

-- Check subscription_transactions
SELECT transaction_type, from_plan, to_plan, amount, proration_amount
FROM subscription_transactions
WHERE UserId = @userId
ORDER BY transaction_date DESC;
```

---

### 4. Pause Subscription

**Endpoint:** `POST /api/data/subscriptions/pause`

**Test Steps:**
1. Pause for 1-3 months
2. Verify Stripe Subscription Schedule created
3. Check database status = 'paused'
4. Verify auto-resume date

**Request:**
```json
{
  "pauseDuration": 2
}
```

**Expected Result:**
```json
{
  "success": true,
  "status": "paused",
  "pauseDuration": 2,
  "resumeDate": "2026-01-21T00:00:00Z"
}
```

**Stripe Verification:**
- Check Subscription Schedules in Dashboard
- Verify phases: pause phase + resume phase

---

### 5. Cancel Subscription

**Endpoint:** `POST /api/data/subscriptions/cancel`

**Test Steps:**
1. Cancel with reason and feedback
2. Verify `cancel_at_period_end` = true
3. Check subscription remains active until period end
4. Verify transaction recorded

**Request:**
```json
{
  "cancellationReason": "too_expensive",
  "feedback": "Great app but too pricey for me"
}
```

**Expected Result:**
```json
{
  "success": true,
  "status": "canceling",
  "activeUntil": "2024-12-31T00:00:00Z",
  "message": "Subscription will cancel at end of billing period"
}
```

**Important:** User should retain Premium access until `activeUntil` date.

---

### 6. Resume Subscription

**Endpoint:** `POST /api/data/subscriptions/resume`

**Test Steps:**
1. First cancel or pause subscription
2. Call resume endpoint
3. Verify `cancel_at_period_end` = false
4. Check status = 'active'

**Expected Result:**
```json
{
  "success": true,
  "status": "active",
  "message": "Subscription resumed successfully"
}
```

---

### 7. Get Transaction History

**Endpoint:** `GET /api/data/subscriptions/history?months=12`

**Test Steps:**
1. Perform several actions (change plan, pause, etc.)
2. Fetch history
3. Verify all transactions recorded
4. Check chronological order

**Expected Result:**
```json
{
  "success": true,
  "count": 5,
  "transactions": [
    {
      "transaction_id": 123,
      "transaction_type": "upgrade",
      "transaction_date": "2024-11-21T10:30:00Z",
      "from_plan": "Premium Monthly",
      "to_plan": "Premium Annual",
      "amount": 89.99,
      "proration_amount": 5.50
    },
    // ... more transactions
  ]
}
```

---

## Frontend Testing

### Subscription Management Modal

**Test Steps:**
1. Navigate to Settings → Subscription Settings
2. Tap "Manage Subscription"
3. Verify modal opens with current plan
4. Test each action button

**Test Cases:**

#### A. Change Plan Flow
1. Tap "Change Plan"
2. Select new billing interval
3. Review proration preview
4. Confirm change
5. Verify success message
6. Check plan updated in UI

#### B. Pause Flow
1. Tap "Pause Subscription"
2. Select duration (1-3 months)
3. Confirm pause
4. Verify resume date shown
5. Check "Resume" button appears

#### C. Cancel Flow
1. Tap "Cancel Subscription"
2. Provide reason (optional)
3. Add feedback (optional)
4. Confirm cancellation
5. Verify "active until" date shown
6. Check "Resume" button appears

#### D. Resume Flow
1. With paused/canceling subscription
2. Tap "Resume Subscription"
3. Confirm resume
4. Verify status changes to "active"

#### E. Transaction History
1. Tap "Transaction History"
2. Verify all past transactions shown
3. Check transaction details (type, date, amounts)
4. Verify chronological order

---

## Error Handling Tests

### 1. Invalid Plan Change
**Test:** Change to same plan
**Expected:** Error message "Already on this plan"

### 2. Invalid Pause Duration
**Test:** Pause for 0 or 4+ months
**Expected:** Error "Pause duration must be between 1 and 3 months"

### 3. Unauthorized Access
**Test:** Call endpoints without token
**Expected:** 401 Unauthorized

### 4. No Active Subscription
**Test:** Manage subscription as Free user
**Expected:** Error "No subscription found"

### 5. Network Errors
**Test:** Simulate network failure
**Expected:** Graceful error message, retry option

---

## Stripe Webhook Testing

After performing actions, verify webhooks fire correctly:

### Events to Monitor
1. `customer.subscription.updated` - Plan changes
2. `invoice.payment_succeeded` - Proration charges
3. `customer.subscription.deleted` - Cancellation completion

**Test Steps:**
1. Use Stripe CLI: `stripe listen --forward-to localhost:3000/api/data/webhook`
2. Perform action in app
3. Verify webhook received
4. Check database updated correctly

---

## Database Verification Queries

### Check User Subscription
```sql
SELECT 
  UserId,
  [plan],
  status,
  billing_interval,
  transaction_type,
  transaction_date,
  cancel_at_period_end,
  current_period_end
FROM user_subscriptions
WHERE UserId = @userId;
```

### Check Transaction History
```sql
SELECT 
  transaction_id,
  transaction_type,
  transaction_date,
  from_plan,
  to_plan,
  amount,
  proration_amount,
  payment_gateway
FROM subscription_transactions
WHERE UserId = @userId
ORDER BY transaction_date DESC;
```

### Check UserProfile Status
```sql
SELECT UserID, UserType
FROM UserProfile
WHERE UserID = @userId;
```

---

## Automated Testing

### Run Backend Tests
```bash
cd Server
npm test tests/subscription-management.test.js
```

### Environment Setup for Tests
```bash
# .env.test
TEST_API_URL=http://localhost:3000/api
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=TestPassword123
```

---

## Known Issues & Limitations

1. **Apple Pay Integration:** Not yet implemented (returns 501)
2. **Google Pay:** Not yet implemented
3. **Immediate Cancellation:** Not supported (only end-of-period)
4. **Proration:** Only available for Stripe, not Apple/Google

---

## Rollback Procedures

If issues occur in production:

### 1. Disable New Endpoints
Comment out routes in `dataRoutes.js`:
```javascript
// router.post('/subscriptions/change-plan', ...);
// router.post('/subscriptions/pause', ...);
// etc.
```

### 2. Revert to Customer Portal
Update `subscriptionssettings.jsx` to use old redirect:
```javascript
Linking.openURL('https://billing.stripe.com/...');
```

### 3. Database Rollback
```sql
-- Remove new columns (if needed)
ALTER TABLE user_subscriptions DROP COLUMN transaction_type;
ALTER TABLE user_subscriptions DROP COLUMN transaction_date;

-- Drop new table (if needed)
DROP TABLE subscription_transactions;
```

---

## Success Criteria

✅ All API endpoints return expected responses  
✅ Database records created correctly  
✅ Stripe Dashboard shows correct changes  
✅ Frontend modal displays all features  
✅ Error handling works gracefully  
✅ Transaction history accurate  
✅ No data loss or corruption  
✅ Webhooks process correctly  

---

## Support & Troubleshooting

### Common Issues

**Issue:** "Subscription not found"  
**Solution:** Verify user has active subscription in database

**Issue:** Proration calculation incorrect  
**Solution:** Check Stripe Price IDs in environment variables

**Issue:** Modal doesn't open  
**Solution:** Check console for errors, verify token exists

**Issue:** Database transaction failed  
**Solution:** Check database connection, verify schema matches

---

## Contact

For issues or questions:
- Check logs: `Server/logs/`
- Stripe Dashboard: https://dashboard.stripe.com/test/logs
- Database: Use Azure Portal or SQL Server Management Studio

