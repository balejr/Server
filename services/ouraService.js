const axios = require("axios");

module.exports = {
  exchangeCodeForToken: async (code) => {
    const res = await axios.post("https://api.ouraring.com/oauth/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.OURA_REDIRECT_URI,
      client_id: process.env.OURA_CLIENT_ID,
      client_secret: process.env.OURA_CLIENT_SECRET,
    });
    return res.data;
  },

  getUserInfo: async (accessToken) => {
    return axios.get("https://api.ouraring.com/v2/usercollection/personal_info", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },
};