# Database Schema Alignment Implementation Plan

## Overview
This plan addresses critical mismatches between the codebase and the migrated database schema. The migration has been executed and includes:
- `plans` table with foreign key constraints
- `SubscriptionRecordId` as new PK for `user_subscriptions` (UserId is now UNIQUE)
- CHECK constraints on plan, status, and billing_interval columns
- Foreign keys from `user_subscriptions.plan` and `payments.plan` to `plans.plan_code`

## Critical Issues

### Issue 1: billing_interval Value Mismatch (CRITICAL - CAUSING CURRENT ERROR)
**Problem**: 
- Database CHECK constraint expects: `('month', '6_months', 'year')`
- Code uses: `('monthly', 'semi_annual', 'annual')`
- **This is causing the CHECK constraint violation error shown in the image**

**Impact**: All INSERT/UPDATE operations on `user_subscriptions.billing_interval` will fail

**Solution**: Create mapping function to convert API format to database format

### Issue 2: Subscription Status Mapping
**Problem**: 
- Database CHECK expects: `('active', 'canceled', 'expired', 'incomplete', 'past_due')`
- Code uses Stripe statuses directly: `'trialing'`, `'unpaid'`, etc.

**Impact**: Database INSERT/UPDATE will fail for invalid status values

**Solution**: Create mapping function to convert Stripe statuses to database values

### Issue 3: Primary Key Change (No Code Changes Needed)
**Status**: `SubscriptionRecordId` is now PK, `UserId` is UNIQUE
**Impact**: Queries using `WHERE UserId = @userId` continue to work
**Action**: Document awareness, no code changes required

### Issue 4: Foreign Key Validation
**Status**: Foreign keys exist to `plans.plan_code`
**Impact**: Code must ensure plan values match `plans` table
**Action**: Verify `mapPlanToDatabaseCode()` returns valid values

## Implementation Steps

### Step 1: Add Mapping Helper Functions
**File**: `routes/dataRoutes.js`
**Location**: After `mapPaymentStatusToDatabase()` function (around line 1157)

Add two new functions:

```javascript
// Helper function to map billing interval from API format to database format
// API uses: 'monthly', 'semi_annual', 'annual'
// Database expects: 'month', '6_months', 'year'
function mapBillingIntervalToDatabase(billingInterval) {
  if (!billingInterval) return null;
  
  const mapping = {
    'monthly': 'month',
    'semi_annual': '6_months',
    'annual': 'year'
  };
  
  // If already in database format, return as-is
  if (mapping[billingInterval]) {
    return mapping[billingInterval];
  }
  
  // If already correct format, return as-is
  if (['month', '6_months', 'year'].includes(billingInterval)) {
    return billingInterval;
  }
  
  // Default: return null (will be NULL in database)
  console.warn(`⚠️ Unknown billingInterval format: ${billingInterval}, returning null`);
  return null;
}

// Helper function to map subscription status from Stripe format to database format
// Database CHECK constraint expects: 'active', 'canceled', 'expired', 'incomplete', 'past_due'
function mapSubscriptionStatusToDatabase(status) {
  if (!status) return 'incomplete';
  
  const mapping = {
    'active': 'active',
    'trialing': 'active', // Treat trialing as active for database
    'canceled': 'canceled',
    'cancelled': 'canceled', // Handle both spellings
    'past_due': 'past_due',
    'unpaid': 'past_due', // Map unpaid to past_due
    'incomplete': 'incomplete',
    'expired': 'expired'
  };
  
  return mapping[status] || 'incomplete'; // Default to incomplete for unknown statuses
}
```

### Step 2: Update billing_interval Usage in UPDATE Query
**File**: `routes/dataRoutes.js`
**Location**: Line ~2912-2914 in `updateSubscriptionInDatabase()` function

**Current Code**:
```javascript
if (billingInterval) {
  updateFields.push('billing_interval = @billingInterval');
  console.log(`   ✅ Will update billing_interval to: ${billingInterval}`);
}
```

**Change To**:
```javascript
if (billingInterval) {
  const dbBillingInterval = mapBillingIntervalToDatabase(billingInterval);
  if (dbBillingInterval) {
    updateFields.push('billing_interval = @billingInterval');
    updateRequest.input('billingInterval', mssql.NVarChar(32), dbBillingInterval);
    console.log(`   ✅ Will update billing_interval to: ${dbBillingInterval} (mapped from ${billingInterval})`);
  } else {
    console.warn(`   ⚠️ Skipping billing_interval update - invalid format: ${billingInterval}`);
  }
}
```

**Also Update**: Line ~2933 where input is set (remove the old input line):
```javascript
// Remove: if (billingInterval) updateRequest.input('billingInterval', mssql.NVarChar(32), billingInterval);
// (Already handled above with mapping)
```

### Step 3: Update billing_interval Usage in INSERT Query
**File**: `routes/dataRoutes.js`
**Location**: Line ~2975-2979 in `updateSubscriptionInDatabase()` function

**Current Code**:
```javascript
if (billingInterval) {
  insertFields.push('billing_interval');
  insertValues.push('@billingInterval');
  console.log(`   ✅ Including billing_interval: ${billingInterval}`);
}
```

**Change To**:
```javascript
if (billingInterval) {
  const dbBillingInterval = mapBillingIntervalToDatabase(billingInterval);
  if (dbBillingInterval) {
    insertFields.push('billing_interval');
    insertValues.push('@billingInterval');
    insertRequest.input('billingInterval', mssql.NVarChar(32), dbBillingInterval);
    console.log(`   ✅ Including billing_interval: ${dbBillingInterval} (mapped from ${billingInterval})`);
  } else {
    console.warn(`   ⚠️ Skipping billing_interval insert - invalid format: ${billingInterval}`);
  }
}
```

**Also Update**: Line ~2998 where input is set (remove the old input line):
```javascript
// Remove: if (billingInterval) insertRequest.input('billingInterval', mssql.NVarChar(32), billingInterval);
// (Already handled above with mapping)
```

### Step 4: Update billing_interval Usage in Status Endpoint
**File**: `routes/dataRoutes.js`
**Location**: Line ~3481-3485 in `/users/subscription/status` endpoint

**Current Code**:
```javascript
if (needsBillingIntervalUpdate && billingInterval) {
  updateRequest.input('billingInterval', mssql.NVarChar(32), billingInterval);
  updateFields.push('billing_interval = @billingInterval');
  console.log(`✅ Will update billing_interval to: ${billingInterval}`);
}
```

**Change To**:
```javascript
if (needsBillingIntervalUpdate && billingInterval) {
  const dbBillingInterval = mapBillingIntervalToDatabase(billingInterval);
  if (dbBillingInterval) {
    updateRequest.input('billingInterval', mssql.NVarChar(32), dbBillingInterval);
    updateFields.push('billing_interval = @billingInterval');
    console.log(`✅ Will update billing_interval to: ${dbBillingInterval} (mapped from ${billingInterval})`);
  } else {
    console.warn(`⚠️ Skipping billing_interval update - invalid format: ${billingInterval}`);
  }
}
```

### Step 5: Update Subscription Status Usage
**File**: `routes/dataRoutes.js`
**Location**: Line ~2321 in `updateSubscriptionInDatabase()` function signature and throughout function

**Change**: Map subscriptionStatus at the start of the function:

**After line ~2337** (after `let paymentStatus = 'processing';`):
```javascript
// Map subscription status to database CHECK constraint values
const databaseSubscriptionStatus = mapSubscriptionStatusToDatabase(subscriptionStatus);
console.log(`📝 Mapped subscription status: ${subscriptionStatus} → ${databaseSubscriptionStatus}`);
```

**Then replace all uses of `subscriptionStatus` with `databaseSubscriptionStatus` in the function**:
- Line ~2791: `const isActive = subscriptionStatus === 'active' || subscriptionStatus === 'trialing';`
  - Change to: `const isActive = databaseSubscriptionStatus === 'active' || subscriptionStatus === 'trialing';` (keep Stripe check for trialing)
- Line ~2820: `const shouldDowngrade = (subscriptionStatus === 'canceled' || subscriptionStatus === 'past_due') ||`
  - Change to: `const shouldDowngrade = (databaseSubscriptionStatus === 'canceled' || databaseSubscriptionStatus === 'past_due') ||`
- Line ~2926: `updateRequest.input('status', mssql.NVarChar(32), subscriptionStatus);`
  - Change to: `updateRequest.input('status', mssql.NVarChar(32), databaseSubscriptionStatus);`
- Line ~2991: `insertRequest.input('status', mssql.NVarChar(32), subscriptionStatus);`
  - Change to: `insertRequest.input('status', mssql.NVarChar(32), databaseSubscriptionStatus);`

**Also update return value** (line ~3038):
```javascript
return { 
  ok: true, 
  userId: userIdInt, 
  subscriptionStatus: databaseSubscriptionStatus, // Use mapped status
  plan: databasePlanCode, 
  paymentIntentId: paymentIntentId || null,
  subscriptionId: subscriptionId || null,
  customerId: customerId || null
};
```

### Step 6: Update Webhook Handlers
**File**: `routes/dataRoutes.js`
**Location**: Webhook handlers (lines ~3666-3865)

**Update all webhook calls to `updateSubscriptionInDatabase()`** to map status first:

**Line ~3702** (customer.subscription.created/updated):
```javascript
await updateSubscriptionInDatabase(
  userId,
  mapSubscriptionStatusToDatabase(subscription.status), // Map status
  mappedPlan,
  subscription.latest_invoice?.payment_intent?.id || null,
  mapPaymentMethodToDatabase(subscription.metadata?.paymentMethod || 'card'),
  subscription.id,
  subscription.customer,
  subscription.current_period_start && typeof subscription.current_period_start === 'number' 
    ? new Date(subscription.current_period_start * 1000).toISOString() 
    : null,
  subscription.current_period_end && typeof subscription.current_period_end === 'number'
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null,
  subscription.metadata?.billingInterval || null,
  cancellationScheduled
);
```

**Similar updates needed for**:
- Line ~3742: customer.subscription.deleted
- Line ~3794: invoice.payment_succeeded  
- Line ~3846: invoice.payment_failed

### Step 7: Update mapPlanToDatabaseCode Function
**File**: `routes/dataRoutes.js`
**Location**: Line ~1093

**Verify** the function only returns valid plan codes that exist in `plans` table:
- `'monthly'` ✓
- `'semi_annual'` ✓
- `'annual'` ✓

**No changes needed** - function already returns correct values.

### Step 8: Verify Database Schema
**File**: `scripts/inspect-database-schema.js` (already created)

**Action**: Run this script to verify:
- Actual column names and types match expectations
- CHECK constraints are correctly defined
- Foreign keys exist
- `SubscriptionRecordId` is PK, `UserId` is UNIQUE

## Testing Checklist

After implementation:

- [ ] Run database schema inspection script
- [ ] Test payment initialization with `billingInterval: 'monthly'`
- [ ] Test payment initialization with `billingInterval: 'semi_annual'`
- [ ] Test payment initialization with `billingInterval: 'annual'`
- [ ] Verify billing_interval saved as `'month'`, `'6_months'`, `'year'` in database
- [ ] Test subscription status update with `'trialing'` status
- [ ] Verify status saved as `'active'` in database
- [ ] Test subscription status update with `'unpaid'` status
- [ ] Verify status saved as `'past_due'` in database
- [ ] Test webhook handlers with various Stripe statuses
- [ ] Verify no CHECK constraint violations in logs
- [ ] Test end-to-end payment flow
- [ ] Test subscription status endpoint

## Files Modified

1. `/Users/mjjr/Library/CloudStorage/OneDrive-Personal/Apogee_FitNext/Apogee_server/Server/routes/dataRoutes.js`
   - Add 2 mapping functions (~40 lines)
   - Update billing_interval usage (3 locations)
   - Update subscription status usage (~10 locations)
   - Update webhook handlers (4 locations)

## Notes

- Frontend code continues using `'monthly'`, `'semi_annual'`, `'annual'` - backend handles mapping
- `UserId` queries continue to work (UserId is UNIQUE, not PK anymore)
- No need to change queries to use `SubscriptionRecordId` unless specifically needed
- The error in the image (`CK_user_subscriptions_billing_interval`) will be fixed by mapping `'semi_annual'` → `'6_months'`

