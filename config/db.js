// config/db.js
// const mssql = require('mssql');
// console.log("DB ENV:", {
//     user: process.env.DB_USER,
//     password: process.env.DB_PASSWORD ? '***' : undefined,
//     server: process.env.DB_HOST,
//     database: process.env.DB_NAME
//   });
// const config = {
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   server: process.env.DB_HOST,
//   database: process.env.DB_NAME,
//   options: {
//     encrypt: true,
//     trustServerCertificate: false,
//   },
// };

// let pool;

// const connectToDatabase = async () => {
//   try {
//     pool = await mssql.connect(config);
//     console.log('Connected to SQL Server');
//   } catch (err) {
//     console.error('Database connection failed:', err);
//   }
// };

// // const getPool = () => pool;

// const getPool = () => {
//   if (!pool) {
//     console.error('DB pool not initialized. Did you call connectToDatabase()?');
//   }
//   return pool;
// };

// module.exports = { connectToDatabase, getPool };

// Local Test
const sql = require('mssql');

const config = {
  server: 'localhost\\SQLEXPRESS',
  database: 'TestDB',
  user: 'testuser',
  password: 'yourpassword',
  options: {
    trustServerCertificate: true
  }
};

async function connectToDatabase() {
  try {
    await sql.connect(config);
    console.log('Connected to SQL Server Express');
  } catch (err) {
    console.error('Database connection failed:', err);
  }
}

module.exports = { connectToDatabase };
