// config/db.js
const mssql = require('mssql');

// Database configuration
const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  // Connection pool settings
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

let pool = null;
let isConnecting = false;

/**
 * Calculate delay for exponential backoff
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} - Delay in milliseconds
 */
const getRetryDelay = (attempt) => {
  const delay = Math.min(
    RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
    RETRY_CONFIG.maxDelayMs
  );
  // Add jitter (±25%)
  const jitter = delay * (0.75 + Math.random() * 0.5);
  return Math.round(jitter);
};

/**
 * Connect to the database with retry logic
 * @param {number} attempt - Current attempt number
 * @returns {Promise<void>}
 */
const connectToDatabase = async (attempt = 0) => {
  // Prevent multiple simultaneous connection attempts
  if (isConnecting) {
    return;
  }
  
  isConnecting = true;
  
  try {
    pool = await mssql.connect(config);
    console.log('✅ Connected to SQL Server');
    
    // Handle unexpected disconnection
    pool.on('error', async (err) => {
      console.error('❌ SQL Server connection error:', err.message);
      pool = null;
      // Attempt to reconnect
      setTimeout(() => connectToDatabase(0), 5000);
    });
    
  } catch (err) {
    console.error(`❌ Database connection failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries}):`, err.message);
    
    if (attempt < RETRY_CONFIG.maxRetries - 1) {
      const delay = getRetryDelay(attempt);
      console.log(`⏳ Retrying in ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      isConnecting = false;
      return connectToDatabase(attempt + 1);
    } else {
      console.error('❌ Max retries reached. Database connection failed.');
      // In production, you might want to exit or alert
      if (process.env.NODE_ENV === 'production') {
        console.error('🚨 Critical: Unable to connect to database after multiple attempts');
      }
    }
  } finally {
    isConnecting = false;
  }
};

/**
 * Get the database connection pool
 * @returns {mssql.ConnectionPool|null} - The connection pool or null if not connected
 */
const getPool = () => {
  if (!pool) {
    console.error('⚠️ DB pool not initialized. Attempting to reconnect...');
    // Trigger reconnection in background
    connectToDatabase(0);
    return null;
  }
  return pool;
};

/**
 * Close the database connection
 * @returns {Promise<void>}
 */
const closeConnection = async () => {
  if (pool) {
    try {
      await pool.close();
      pool = null;
      console.log('Database connection closed');
    } catch (err) {
      console.error('Error closing database connection:', err);
    }
  }
};

/**
 * Check if database is connected
 * @returns {boolean}
 */
const isConnected = () => {
  return pool !== null && pool.connected;
};

module.exports = { 
  connectToDatabase, 
  getPool, 
  closeConnection, 
  isConnected 
};
