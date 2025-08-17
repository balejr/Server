// middleware/authMiddleware.js
const { verifyAccessToken, verifyRefreshToken } = require('../utils/token');

// 验证访问令牌的中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: '缺少访问令牌' });
  }

  try {
    const user = verifyAccessToken(token);
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        message: '访问令牌已过期',
        code: 'TOKEN_EXPIRED'
      });
    }
    return res.status(403).json({ message: '无效的访问令牌' });
  }
};

// 验证刷新令牌的中间件
const authenticateRefreshToken = (req, res, next) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(401).json({ message: '缺少刷新令牌' });
  }

  try {
    const user = verifyRefreshToken(refreshToken);
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: '刷新令牌已过期，请重新登录' });
    }
    return res.status(403).json({ message: '无效的刷新令牌' });
  }
};

module.exports = { authenticateToken, authenticateRefreshToken };
