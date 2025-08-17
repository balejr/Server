// utils/token.js
const jwt = require('jsonwebtoken');

// 生成访问令牌 (短期，15分钟)
const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5m' });
};

// 生成刷新令牌 (长期，7天)
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, { expiresIn: '10m' });
};

// This function verifies the validity of an access token (JWT).
// It takes a token string as input and attempts to verify it using the secret key stored in the environment variable JWT_SECRET.
// If the token is valid and not expired, it returns the decoded payload.
// If the token is invalid or expired, it throws an error.
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    throw error;
  }
};

// 验证刷新令牌
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
  } catch (error) {
    throw error;
  }
};

module.exports = { 
  generateAccessToken, 
  generateRefreshToken, 
  verifyAccessToken, 
  verifyRefreshToken 
};
