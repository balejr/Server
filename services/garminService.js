// services/garminService.js
const axios = require("axios");
const qs = require("querystring");
const crypto = require("crypto");

async function generateCodeVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}

async function generateCodeChallenge(verifier) {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return Buffer.from(hash).toString("base64url");
}


async function exchangeGarminCodeForToken(code, codeVerifier) {
  const payload = {
    grant_type: "authorization_code",
    client_id: process.env.GARMIN_CLIENT_ID,
    client_secret: process.env.GARMIN_CLIENT_SECRET,
    code: code,
    redirect_uri: process.env.GARMIN_REDIRECT_URI
  };

  try {
    const response = await axios.post(
      "https://diauth.garmin.com/di-oauth2-service/oauth/token",
      qs.stringify(payload), // URL-encoded form data
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    console.log("[GarminToken] Access token received:", response.data);
    return response.data;

  } catch (error) {
    console.error("[GarminToken] Error exchanging code:", error.response?.data || error.message);
    throw error;
  }
};