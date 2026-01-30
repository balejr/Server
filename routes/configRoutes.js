// routes/configRoutes.js
const express = require("express");
 
const router = express.Router();
 
/**
 * @swagger
 * /config/mobile:
 *   get:
 *     tags:
 *       - Config
 *     summary: Mobile app runtime configuration
 *     description: |
 *       Returns non-sensitive configuration derived from server environment variables.
 *       This helps mobile clients avoid embedding third-party keys/URLs.
 *
 *       Note: Secrets are NOT returned to the client. Instead, the server should proxy
 *       any third-party requests that require secrets (e.g., RapidAPI, Nutritionix).
 *     responses:
 *       200:
 *         description: Mobile configuration payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     features:
 *                       type: object
 *                       properties:
 *                         rapidApiEnabled:
 *                           type: boolean
 *                         nutritionixEnabled:
 *                           type: boolean
 *                         stripeEnabled:
 *                           type: boolean
 *                     public:
 *                       type: object
 *                       properties:
 *                         nutritionixAppId:
 *                           type: string
 *                           nullable: true
 *                         stripePublishableKey:
 *                           type: string
 *                           nullable: true
 *                         appleMerchantId:
 *                           type: string
 *                           nullable: true
 *       500:
 *         description: Internal server error
 */
router.get("/mobile", (req, res) => {
  try {
    const rapidApiEnabled = Boolean(process.env.RAPID_API_KEY);
    const nutritionixEnabled = Boolean(process.env.NUTRITIONIX_API_KEY);
    const stripeEnabled = Boolean(
      process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
        process.env.STRIPE_PUBLISHABLE_KEY
    );
 
    // App IDs are typically not secret; API keys are.
    const nutritionixAppId = process.env.NUTRITIONIX_APP_ID || null;
    const stripePublishableKey =
      process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
      process.env.STRIPE_PUBLISHABLE_KEY ||
      null;
    const appleMerchantId =
      process.env.EXPO_PUBLIC_APPLE_MERCHANT_ID ||
      process.env.APPLE_MERCHANT_ID ||
      null;
 
    return res.json({
      success: true,
      data: {
        features: {
          rapidApiEnabled,
          nutritionixEnabled,
          stripeEnabled,
        },
        public: {
          nutritionixAppId,
          stripePublishableKey,
          appleMerchantId,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load mobile config",
    });
  }
});
 
module.exports = router;