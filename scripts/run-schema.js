/**
 * Database Schema Runner
 * ======================
 * Executes master-schema.sql to set up a fresh database
 *
 * Usage: node scripts/run-schema.js
 *
 * Prerequisites:
 *   - .env file with database credentials
 *   - Azure SQL Database accessible
 *
 * Environment Variables:
 *   - DB_HOST or AZURE_SQL_SERVER
 *   - DB_NAME or AZURE_SQL_DATABASE
 *   - DB_USER or AZURE_SQL_USER
 *   - DB_PASSWORD or AZURE_SQL_PASSWORD
 */

require("dotenv").config();
const mssql = require("mssql");
const fs = require("fs");
const path = require("path");

const config = {
  server: process.env.DB_HOST || process.env.AZURE_SQL_SERVER,
  database: process.env.DB_NAME || process.env.AZURE_SQL_DATABASE,
  authentication: {
    type: "default",
    options: {
      userName: process.env.DB_USER || process.env.AZURE_SQL_USER,
      password: process.env.DB_PASSWORD || process.env.AZURE_SQL_PASSWORD,
    },
  },
  options: {
    encrypt: true,
    trustServerCertificate: false,
    enableArithAbort: true,
    requestTimeout: 60000, // 60 second timeout for schema operations
  },
};

async function runSchema() {
  let pool;

  try {
    // Validate configuration
    if (!config.server || !config.database) {
      console.error("❌ Missing database configuration");
      console.error("   Please ensure .env contains:");
      console.error("   - DB_HOST or AZURE_SQL_SERVER");
      console.error("   - DB_NAME or AZURE_SQL_DATABASE");
      console.error("   - DB_USER or AZURE_SQL_USER");
      console.error("   - DB_PASSWORD or AZURE_SQL_PASSWORD");
      process.exit(1);
    }

    console.log("");
    console.log("===========================================");
    console.log("ApogeeHnP Database Schema Setup");
    console.log("===========================================");
    console.log("");
    console.log("🔄 Connecting to Azure SQL Database...");
    console.log(`   Server: ${config.server}`);
    console.log(`   Database: ${config.database}`);
    console.log("");

    pool = await mssql.connect(config);
    console.log("✅ Connected to database");
    console.log("");

    // Read the master schema file
    const schemaPath = path.join(__dirname, "master-schema.sql");

    if (!fs.existsSync(schemaPath)) {
      console.error("❌ master-schema.sql not found");
      console.error(`   Expected at: ${schemaPath}`);
      process.exit(1);
    }

    const schemaSQL = fs.readFileSync(schemaPath, "utf8");

    // Split by GO statements and execute each batch
    // GO is not a T-SQL command, it's a batch separator for tools like SSMS
    const batches = schemaSQL
      .split(/^\s*GO\s*$/gim)
      .filter((batch) => batch.trim().length > 0);

    console.log(`📝 Executing ${batches.length} SQL batches...`);
    console.log("");

    let successCount = 0;
    let skipCount = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i].trim();
      if (batch.length === 0) continue;

      try {
        const result = await pool.request().query(batch);
        successCount++;

        // Print any messages from PRINT statements
        if (result.recordset && result.recordset.length > 0) {
          result.recordset.forEach((row) => {
            const message = Object.values(row)[0];
            if (message) console.log(`   ${message}`);
          });
        }
      } catch (err) {
        // Handle expected "already exists" errors gracefully
        if (
          err.message.includes("already exists") ||
          err.message.includes("duplicate") ||
          err.message.includes("There is already")
        ) {
          skipCount++;
          // Silently skip - this is expected for idempotent scripts
        } else {
          console.error(`   ❌ Error in batch ${i + 1}:`);
          console.error(`      ${err.message.split("\n")[0]}`);
        }
      }
    }

    console.log("");
    console.log("===========================================");
    console.log("Schema Setup Complete!");
    console.log("===========================================");
    console.log("");
    console.log(`   Batches executed: ${successCount}`);
    if (skipCount > 0) {
      console.log(`   Already existed (skipped): ${skipCount}`);
    }
    console.log("");
    console.log("Next steps:");
    console.log("   1. Test your connection: npm run test");
    console.log("   2. Start the server: npm start");
    console.log("");
  } catch (error) {
    console.error("");
    console.error("❌ Schema setup failed:", error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    console.error("");
    console.error("Troubleshooting:");
    console.error("   1. Verify .env credentials are correct");
    console.error("   2. Check if Azure SQL firewall allows your IP");
    console.error("   3. Ensure database exists");
    console.error("");
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log("🔌 Database connection closed");
    }
  }
}

// Run if called directly
if (require.main === module) {
  runSchema()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Unexpected error:", error);
      process.exit(1);
    });
}

module.exports = { runSchema };
