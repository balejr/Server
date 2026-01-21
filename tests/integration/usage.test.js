/**
 * Usage API Integration Tests
 *
 * Verifies usage endpoints require authentication.
 */

const { api } = require("../helpers");

describe("Usage API", () => {
  describe("GET /usage", () => {
    test("requires authentication", async () => {
      const { response } = await api.get("/usage/usage");
      expect([401, 403]).toContain(response.status);
    });
  });

  describe("GET /usage/history", () => {
    test("requires authentication", async () => {
      const { response } = await api.get("/usage/usage/history");
      expect([401, 403]).toContain(response.status);
    });
  });

  describe("POST /usage/reset", () => {
    test("requires authentication", async () => {
      const { response } = await api.post("/usage/usage/reset", {});
      expect([401, 403]).toContain(response.status);
    });
  });
});
