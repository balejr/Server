/**
 * Database Cleanup Helper
 *
 * Provides direct database access for cleaning up test users.
 * Handles foreign key constraints by deleting from child tables first.
 */

const sql = require("mssql");

// Database configuration (from environment or defaults)
const DB_CONFIG = {
  user: process.env.DB_USER || "ApogeeDev_Haashim",
  password: process.env.DB_PASSWORD || "SecurePassword123",
  server: process.env.DB_SERVER || "apogeehnp.database.windows.net",
  database: process.env.DB_NAME || "ApogeeFit",
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

/**
 * Connect to the database
 * @returns {Promise<sql.ConnectionPool>} - Database connection pool
 */
const connectToDatabase = async () => {
  try {
    const pool = await sql.connect(DB_CONFIG);
    return pool;
  } catch (error) {
    console.error("Database connection failed:", error.message);
    throw error;
  }
};

/**
 * Close database connection
 */
const closeDatabase = async () => {
  try {
    await sql.close();
  } catch (error) {
    console.error("Error closing database connection:", error.message);
  }
};

/**
 * Delete a test user and all related data from the database
 *
 * @param {number} userId - User ID to delete
 * @returns {Promise<{success: boolean, rowsDeleted: number}>}
 */
const cleanupTestUser = async (userId) => {
  if (!userId) {
    console.log("No userId provided for cleanup");
    return { success: false, rowsDeleted: 0 };
  }

  let pool;
  let totalDeleted = 0;

  try {
    console.log(`\n🧹 Cleaning up test user ${userId}...`);
    pool = await connectToDatabase();

    // Get all tables with UserID columns
    const tablesResult = await pool.request().query(`
      SELECT TABLE_NAME, COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE COLUMN_NAME LIKE '%UserID%' 
         OR COLUMN_NAME LIKE '%UserId%' 
         OR COLUMN_NAME LIKE '%user_id%'
    `);

    const tables = tablesResult.recordset;
    console.log(`   Found ${tables.length} tables with UserID columns`);

    let remainingTables = [...tables];
    let pass = 1;

    // Multi-pass deletion to handle foreign key constraints
    while (remainingTables.length > 0 && pass <= 5) {
      const stillRemaining = [];

      for (const { TABLE_NAME, COLUMN_NAME } of remainingTables) {
        try {
          const request = new sql.Request(pool);
          const result = await request.query(
            `DELETE FROM dbo.[${TABLE_NAME}] WHERE [${COLUMN_NAME}] = ${userId}`
          );
          if (result.rowsAffected[0] > 0) {
            console.log(
              `   ✓ Deleted ${result.rowsAffected[0]} rows from ${TABLE_NAME}`
            );
            totalDeleted += result.rowsAffected[0];
          }
        } catch (err) {
          if (
            err.message.includes("REFERENCE constraint") ||
            err.message.includes("FOREIGN KEY")
          ) {
            stillRemaining.push({ TABLE_NAME, COLUMN_NAME });
          }
          // Ignore other errors (table might not have matching rows)
        }
      }

      remainingTables = stillRemaining;
      pass++;
    }

    console.log(`   Total rows deleted: ${totalDeleted}`);
    return { success: true, rowsDeleted: totalDeleted };
  } catch (error) {
    console.error("Database cleanup error:", error.message);
    return { success: false, rowsDeleted: totalDeleted };
  } finally {
    await closeDatabase();
  }
};

/**
 * Find user ID by email
 *
 * @param {string} email - User email
 * @returns {Promise<number|null>} - User ID or null if not found
 */
const findUserIdByEmail = async (email) => {
  let pool;
  try {
    pool = await connectToDatabase();
    const result = await pool
      .request()
      .input("email", email.toLowerCase())
      .query(`SELECT UserID FROM dbo.UserLogin WHERE LOWER(Email) = @email`);

    if (result.recordset.length > 0) {
      return result.recordset[0].UserID;
    }
    return null;
  } catch (error) {
    console.error("Error finding user:", error.message);
    return null;
  } finally {
    await closeDatabase();
  }
};

/**
 * Cleanup test user by email
 *
 * @param {string} email - User email to cleanup
 * @returns {Promise<{success: boolean, rowsDeleted: number}>}
 */
const cleanupTestUserByEmail = async (email) => {
  const userId = await findUserIdByEmail(email);
  if (!userId) {
    console.log(`No user found with email: ${email}`);
    return { success: false, rowsDeleted: 0 };
  }
  return cleanupTestUser(userId);
};

module.exports = {
  connectToDatabase,
  closeDatabase,
  cleanupTestUser,
  cleanupTestUserByEmail,
  findUserIdByEmail,
  DB_CONFIG,
};

