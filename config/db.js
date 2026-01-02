// config/db.js
const mssql = require('mssql');

// Validate required environment variables before attempting connection
const validateDbConfig = () => {
  const required = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_NAME'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required database environment variables: ${missing.join(', ')}`);
  }
};

console.log("DB ENV:", {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD ? '***' : undefined,
    server: process.env.DB_HOST,
    database: process.env.DB_NAME
  });

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  database: process.env.DB_NAME,
  connectionTimeout: 30000,  // 30 seconds - fail fast if DB unreachable
  requestTimeout: 30000,     // 30 seconds for queries
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

let pool;

const connectToDatabase = async () => {
  // Validate env vars first - fail fast with clear error
  validateDbConfig();
  
  pool = await mssql.connect(config);
  console.log('Connected to SQL Server');
  // Errors propagate up - caller must handle them
};

// const getPool = () => pool;

const getPool = () => {
  if (!pool) {
    console.error('DB pool not initialized. Did you call connectToDatabase()?');
  }
  return pool;
};

module.exports = { connectToDatabase, getPool };
