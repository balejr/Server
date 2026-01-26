/**
 * Run FitPoints Migration
 *
 * Executes the rewards-fitpoints-migration.sql against the Azure SQL database.
 *
 * Usage: node run-fitpoints-migration.js
 */

const sql = require("mssql");
const fs = require("fs");
const path = require("path");

// Database configuration from environment or defaults
const config = {
  user: process.env.DB_USER || "ApogeeDev_Haashim",
  password: process.env.DB_PASSWORD || "SecurePassword123",
  server: process.env.DB_HOST || "apogeehnp.database.windows.net",
  database: process.env.DB_NAME || "ApogeeFit",
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  connectionTimeout: 30000,
  requestTimeout: 60000,
};

async function runMigration() {
  console.log("===========================================");
  console.log("FitPoints Migration Runner");
  console.log("===========================================\n");
  console.log(`Connecting to: ${config.server}/${config.database}`);
  console.log(`User: ${config.user}\n`);

  let pool;

  try {
    // Connect to database
    console.log("Connecting to database...");
    pool = await sql.connect(config);
    console.log("Connected successfully!\n");

    // Read migration SQL file
    const migrationPath = path.join(__dirname, "rewards-fitpoints-migration.sql");
    console.log(`Reading migration file: ${migrationPath}`);

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    const migrationSQL = fs.readFileSync(migrationPath, "utf8");
    console.log(`Migration file loaded (${migrationSQL.length} characters)\n`);

    // Split by GO statements and execute each batch
    const batches = migrationSQL.split(/^GO$/gm).filter(batch => batch.trim());
    console.log(`Found ${batches.length} SQL batches to execute\n`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i].trim();
      if (!batch) continue;

      console.log(`Executing batch ${i + 1}/${batches.length}...`);

      try {
        const result = await pool.request().query(batch);

        // Log any result sets (like verification queries)
        if (result.recordset && result.recordset.length > 0) {
          console.log("Result:");
          console.table(result.recordset);
        }

        console.log(`Batch ${i + 1} completed.\n`);
      } catch (batchError) {
        console.error(`Error in batch ${i + 1}:`, batchError.message);
        // Continue with other batches unless it's a critical error
        if (batchError.message.includes("Invalid column name") ||
            batchError.message.includes("already exists")) {
          console.log("(Non-critical error, continuing...)\n");
        } else {
          throw batchError;
        }
      }
    }

    console.log("===========================================");
    console.log("Migration completed successfully!");
    console.log("===========================================\n");

    // Verify the changes
    console.log("Verifying migration...\n");

    // Check if TotalFitPoints column exists
    const columnCheck = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'UserRewards'
      AND COLUMN_NAME IN ('TotalXP', 'TotalFitPoints')
    `);
    console.log("UserRewards columns:");
    console.table(columnCheck.recordset);

    // Check if new tables exist
    const tableCheck = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME IN ('ChallengeFeedback', 'GeneratedChallenges')
    `);
    console.log("New tables:");
    console.table(tableCheck.recordset);

  } catch (error) {
    console.error("\n===========================================");
    console.error("Migration failed!");
    console.error("===========================================");
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log("\nDatabase connection closed.");
    }
  }
}

// Run the migration
runMigration();
