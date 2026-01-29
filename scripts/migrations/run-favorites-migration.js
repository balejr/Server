/**
 * Database Migration: Create Favorites Table
 * Creates dbo.Favorites for storing user exercise favorites.
 *
 * Usage: node scripts/migrations/run-favorites-migration.js
 */

require("dotenv").config();
const sql = require("mssql");
const fs = require("fs");
const path = require("path");

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  database: process.env.DB_NAME,
  options: { encrypt: true, trustServerCertificate: false },
  connectionTimeout: 30000,
  requestTimeout: 60000,
};

async function runMigration() {
  let pool;

  try {
    console.log("Connecting to Azure SQL Database...");
    console.log(`   Server: ${config.server}`);
    console.log(`   Database: ${config.database}`);

    pool = await sql.connect(config);
    console.log("Connected successfully!");

    const migrationPath = path.join(__dirname, "create-favorites-table.sql");
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    const migrationSQL = fs.readFileSync(migrationPath, "utf8");

    const batches = migrationSQL
      .split(/^GO$/gm)
      .filter((batch) => batch.trim());

    console.log(`Found ${batches.length} SQL batch(es)`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i].trim();
      if (!batch) continue;

      console.log(`Executing batch ${i + 1}/${batches.length}...`);
      try {
        const result = await pool.request().query(batch);
        if (result.recordset?.length > 0) {
          console.table(result.recordset);
        }
        console.log(`Batch ${i + 1} completed.`);
      } catch (batchError) {
        if (
          batchError.message.includes("already exists") ||
          batchError.message.includes("duplicate")
        ) {
          console.log("(Non-critical error, continuing...)");
        } else {
          throw batchError;
        }
      }
    }

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed!", error.message);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log("Database connection closed.");
    }
  }
}

runMigration();
