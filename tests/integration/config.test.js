/**
 * Config API Integration Tests
 *
 * Tests mobile configuration endpoint for feature flags and public keys.
 */

const { api } = require("../helpers");

describe("Config API", () => {
  describe("GET /config/mobile", () => {
    test("returns feature flags and public config", async () => {
      const { response, duration } = await api.get("/config/mobile");

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.data).toBeDefined();

      const { features, public: publicConfig } = response.data.data;

      expect(features).toBeDefined();
      expect(typeof features.rapidApiEnabled).toBe("boolean");
      expect(typeof features.nutritionixEnabled).toBe("boolean");
      expect(typeof features.stripeEnabled).toBe("boolean");

      expect(publicConfig).toBeDefined();
      expect(
        publicConfig.nutritionixAppId === null ||
          typeof publicConfig.nutritionixAppId === "string"
      ).toBe(true);
      expect(
        publicConfig.stripePublishableKey === null ||
          typeof publicConfig.stripePublishableKey === "string"
      ).toBe(true);
      expect(
        publicConfig.appleMerchantId === null ||
          typeof publicConfig.appleMerchantId === "string"
      ).toBe(true);

      console.log(`     Config retrieved (${duration}ms)`);
    });
  });
});
