# Step 4: Add Webhook Secret to Azure App Service Configuration

## Webhook Secret
```
STRIPE_WEBHOOK_SECRET=whsec_oJkXTjlW802qYmetBB58I8mC60LhHivb
```

## Instructions to Add to Azure App Service

### Option 1: Azure Portal (Recommended)

1. **Go to Azure Portal**
   - Navigate to: https://portal.azure.com
   - Find your App Service: `apogeehnp` (or your app service name)

2. **Open Configuration**
   - In the left sidebar, click on **"Configuration"** (under Settings)
   - Or go to: Settings → Configuration

3. **Add New Application Setting**
   - Click **"+ New application setting"** or **"+ Add"**
   - **Name**: `STRIPE_WEBHOOK_SECRET`
   - **Value**: `whsec_oJkXTjlW802qYmetBB58I8mC60LhHivb`
   - Click **"OK"**

4. **Save Configuration**
   - Click **"Save"** at the top
   - Azure will restart your app service (this is normal)

5. **Verify**
   - After restart, check that the setting appears in the list
   - The app will now be able to verify webhook signatures from Stripe

### Option 2: Azure CLI (If you have it installed)

```bash
az webapp config appsettings set \
  --resource-group <your-resource-group> \
  --name apogeehnp \
  --settings STRIPE_WEBHOOK_SECRET=whsec_oJkXTjlW802qYmetBB58I8mC60LhHivb
```

### Option 3: Azure REST API

You can also use the Azure REST API if you prefer programmatic access.

## Complete Environment Variables Checklist

Make sure these are all set in Azure App Service Configuration:

✅ **STRIPE_SECRET_KEY** (should already exist)
✅ **STRIPE_PRICE_ID** (from Step 1: `price_1SS51cAirABIHL4jfgtiXAzP`)
✅ **STRIPE_WEBHOOK_SECRET** (from Step 3: `whsec_oJkXTjlW802qYmetBB58I8mC60LhHivb`)

## Testing the Webhook

After adding the secret:

1. **Test via Stripe Dashboard**
   - Go to your webhook endpoint page
   - Click "Send test webhook"
   - Select an event (e.g., `customer.subscription.created`)
   - Check Azure Log Stream for webhook receipt

2. **Check Azure Logs**
   - Azure Portal → Your App Service → Log Stream
   - Look for: `📥 Webhook received: customer.subscription.created`
   - Should see: `✅ Subscription ... processed successfully`

## Notes

- The webhook secret is used to verify that webhooks actually come from Stripe
- Never commit the webhook secret to version control
- Test mode and Live mode have different webhook secrets
- When going live, create a new webhook and use its secret

