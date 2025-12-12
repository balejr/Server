// services/ouraService.js
const axios = require("axios");
const qs = require("querystring");

async function exchangeCodeForToken(code) {
  const payload = {
    grant_type: "authorization_code",
    code: code,
    redirect_uri: process.env.OURA_REDIRECT_URI,
    client_id: process.env.OURA_CLIENT_ID,
    client_secret: process.env.OURA_CLIENT_SECRET
  };

  try {
    const response = await axios.post(
      "https://api.ouraring.com/oauth/token",
      qs.stringify(payload), // URL-encoded form data
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    console.log("[OuraToken] Access token received:", response.data);
    return response.data;

  } catch (error) {
    console.error("[OuraToken] Error exchanging code:", error.response?.data || error.message);
    throw error;
  }
},

const refreshOuraToken = async (userId, refreshToken) => {
  try {
    const response = await axios.post('https://api.ouraring.com/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.OURA_CLIENT_ID,
      client_secret: process.env.OURA_CLIENT_SECRET,
    });

    const { access_token, refresh_token } = response.data;

    const pool = getPool();
    await pool.request()
      .input('userId', userId)
      .input('accessToken', access_token)
      .input('refreshToken', refresh_token)
      .query(`
        UPDATE Users
        SET OuraAccessToken = 'accessToken',
            OuraRefreshToken = 'refreshToken'
        WHERE UserID = 'userId'
      `);

    return access_token;

  } catch (err) {
    console.error('Failed to refresh Oura token:', err);
    throw new Error('Could not refresh Oura token');
  }
}


module.exports = { exchangeCodeForToken };
