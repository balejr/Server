// config/db.js
const mssql = require('mssql');
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
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

let pool;

const connectToDatabase = async () => {
  try {
    pool = await mssql.connect(config);
    console.log('Connected to SQL Server');
  } catch (err) {
    console.error('Database connection failed:', err);
  }
};

const getPool = () => pool;

module.exports = { connectToDatabase, getPool };
