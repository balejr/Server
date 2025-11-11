# Step 3: Configure Stripe Webhook - Instructions

## Webhook Configuration Details

**Webhook Endpoint URL:**
```
https://apogeehnp.azurewebsites.net/api/data/webhooks/stripe
```

**Events to Listen For:**
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

## Step-by-Step Instructions

### Option 1: Stripe Dashboard (Recommended for Production)

1. **Go to Stripe Dashboard**
   - Open: https://dashboard.stripe.com/test/webhooks
   - Make sure you're in **Test mode** (toggle in top right)

2. **Click "Add endpoint"**

3. **Enter Endpoint URL:**
   ```
   https://apogeehnp.azurewebsites.net/api/data/webhooks/stripe
   ```

4. **Select Events to Listen To:**
   - Click "Select events"
   - Choose:
     - ✅ `customer.subscription.created`
     - ✅ `customer.subscription.updated`
     - ✅ `customer.subscription.deleted`
     - ✅ `invoice.payment_succeeded`
     - ✅ `invoice.payment_failed`
   - Click "Add events"

5. **Click "Add endpoint"**

6. **Copy the Signing Secret:**
   - After creating, click on the webhook endpoint
   - Click "Reveal" next to "Signing secret"
   - Copy the secret (starts with `whsec_...`)
   - **Save this for Step 4!**

### Option 2: Using Stripe API (Alternative)

You can also create it programmatically, but Dashboard is easier.

## After Creating the Webhook

1. **Test the Webhook:**
   - In Stripe Dashboard, click on your webhook endpoint
   - Click "Send test webhook"
   - Select an event type (e.g., `customer.subscription.created`)
   - Check your Azure logs to verify it's received

2. **Save the Webhook Secret:**
   - The signing secret will be needed in Step 4
   - Format: `whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

## Quick Links

- **Webhooks Dashboard**: https://dashboard.stripe.com/test/webhooks
- **Test Webhook**: https://dashboard.stripe.com/test/webhooks (after creation)

## Notes

- Make sure your Azure App Service is running and accessible
- The webhook endpoint does NOT require authentication (Stripe signs requests)
- Test mode webhooks are separate from Live mode webhooks
- When going live, create a new webhook with your live secret key

