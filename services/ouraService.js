const axios = require("axios");

module.exports = {
  exchangeCodeForToken: async (code) => {
    console.log("[OuraToken] Exchanging code for token:", code);
    console.log("[OuraToken] Using redirect URI:", process.env.OURA_REDIRECT_URI);

    try {
      const res = await axios.post("https://api.ouraring.com/oauth/token", {
        grant_type: "authorization_code",
        code: code,
        redirect_uri: process.env.OURA_REDIRECT_URI,
        client_id: process.env.OURA_CLIENT_ID,
        client_secret: process.env.OURA_CLIENT_SECRET,
      });

      console.log("[OuraToken] Token response received:", res.data);
      return res.data;
    } catch (err) {
      if (err.response) {
        console.error("[OuraToken] Error response from Oura:", err.response.data);
      } else {
        console.error("[OuraToken] Axios error:", err.message);
      }
      throw err;
    }
  }

};