// Script to add MFA session columns to UserLogin table
const sql = require("mssql");

const config = {
  server: "apogeehnp.database.windows.net",
  database: "ApogeeFit",
  user: "ApogeeDev_Haashim",
  password: "SecurePassword123",
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

async function runMigration() {
  let pool;
  try {
    console.log("Connecting to database...");
    pool = await sql.connect(config);
    console.log("Connected successfully!\n");

    // Step 1: Add MFASessionToken column
    console.log("Step 1: Adding MFASessionToken column...");
    const checkToken = await pool.request().query(`
      SELECT COUNT(*) as exists_count 
      FROM sys.columns 
      WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'MFASessionToken'
    `);

    if (checkToken.recordset[0].exists_count === 0) {
      await pool.request().query(`
        ALTER TABLE [dbo].[UserLogin]
        ADD MFASessionToken NVARCHAR(100) NULL
      `);
      console.log("  ✓ Added MFASessionToken column");
    } else {
      console.log("  - MFASessionToken column already exists");
    }

    // Step 2: Add MFASessionExpires column
    console.log("Step 2: Adding MFASessionExpires column...");
    const checkExpires = await pool.request().query(`
      SELECT COUNT(*) as exists_count 
      FROM sys.columns 
      WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'MFASessionExpires'
    `);

    if (checkExpires.recordset[0].exists_count === 0) {
      await pool.request().query(`
        ALTER TABLE [dbo].[UserLogin]
        ADD MFASessionExpires DATETIMEOFFSET NULL
      `);
      console.log("  ✓ Added MFASessionExpires column");
    } else {
      console.log("  - MFASessionExpires column already exists");
    }

    // Step 3: Create index
    console.log("Step 3: Creating index for MFASessionToken...");
    const checkIndex = await pool.request().query(`
      SELECT COUNT(*) as exists_count 
      FROM sys.indexes 
      WHERE name = 'IX_UserLogin_MFASessionToken'
    `);

    if (checkIndex.recordset[0].exists_count === 0) {
      await pool.request().query(`
        CREATE INDEX IX_UserLogin_MFASessionToken
        ON [dbo].[UserLogin](MFASessionToken)
        WHERE MFASessionToken IS NOT NULL
      `);
      console.log("  ✓ Created index IX_UserLogin_MFASessionToken");
    } else {
      console.log("  - Index already exists");
    }

    // Verify
    console.log("\nVerifying changes...");
    const verify = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'UserLogin'
        AND COLUMN_NAME IN ('MFASessionToken', 'MFASessionExpires')
      ORDER BY COLUMN_NAME
    `);

    console.log("\nNew columns in UserLogin table:");
    verify.recordset.forEach((col) => {
      console.log(
        `  - ${col.COLUMN_NAME}: ${col.DATA_TYPE} (nullable: ${col.IS_NULLABLE})`
      );
    });

    console.log("\n✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

runMigration();

