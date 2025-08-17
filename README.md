# ApogeeHnP 后端服务器

## 环境变量配置

在项目根目录创建 `.env` 文件，包含以下配置：

```bash
# 数据库配置
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_HOST=your_db_host
DB_NAME=your_db_name

# JWT 配置
JWT_SECRET=your_jwt_secret_key_here_make_it_long_and_random
JWT_REFRESH_SECRET=your_jwt_refresh_secret_key_here_make_it_different_and_random

# Azure Blob Storage 配置
AZURE_STORAGE_CONNECTION_STRING=your_azure_storage_connection_string
AZURE_STORAGE_CONTAINER_NAME=your_container_name

# 服务器配置
PORT=3000
NODE_ENV=development
```

## 刷新令牌功能

### 功能说明
- **访问令牌 (Access Token)**: 短期有效，15分钟过期，用于API请求认证
- **刷新令牌 (Refresh Token)**: 长期有效，7天过期，用于获取新的访问令牌

### API 端点

#### 登录
```
POST /api/auth/signin
```
返回：
```json
{
  "message": "登录成功！",
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 123,
    "email": "user@example.com"
  }
}
```

#### 注册
```
POST /api/auth/signup
```
返回：
```json
{
  "message": "用户创建成功！",
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "userId": 123
}
```

#### 刷新令牌
```
POST /api/auth/refresh
Body: { "refreshToken": "your_refresh_token" }
```
返回：
```json
{
  "message": "令牌刷新成功",
  "accessToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### 登出
```
POST /api/auth/logout
```

### 使用方法

1. 用户登录后获得访问令牌和刷新令牌
2. 使用访问令牌进行API请求
3. 当访问令牌过期时，使用刷新令牌获取新的访问令牌
4. 如果刷新令牌也过期，用户需要重新登录

### 安全特性
- 访问令牌短期有效，减少安全风险
- 刷新令牌长期有效，提供良好的用户体验
- 自动令牌刷新，用户无需手动操作
- 令牌过期时自动重试请求

## 安装和运行

```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev

# 生产模式运行
npm start
```

## 依赖包

- express: Web框架
- jsonwebtoken: JWT令牌处理
- bcrypt: 密码加密
- mssql: SQL Server数据库连接
- multer: 文件上传处理
- cors: 跨域资源共享
- dotenv: 环境变量管理

