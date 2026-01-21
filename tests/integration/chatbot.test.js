/**
 * Chatbot API Integration Tests
 *
 * Verifies chatbot endpoints require authentication.
 */

const { api } = require("../helpers");

describe("Chatbot API", () => {
  describe("POST /chatbot/chat", () => {
    test("requires authentication", async () => {
      const { response } = await api.post("/chatbot/chat", {
        message: "Hello",
        sessionType: "inquiry",
      });

      expect([401, 403]).toContain(response.status);
    });
  });

  describe("GET /chatbot/chat/history", () => {
    test("requires authentication", async () => {
      const { response } = await api.get("/chatbot/chat/history");
      expect([401, 403]).toContain(response.status);
    });
  });

  describe("DELETE /chatbot/chat/history", () => {
    test("requires authentication", async () => {
      const { response } = await api.delete("/chatbot/chat/history");
      expect([401, 403]).toContain(response.status);
    });
  });
});
