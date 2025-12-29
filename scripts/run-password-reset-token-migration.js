// Script to add password reset token columns to UserLogin table
// Purpose: Support email-based password reset flow with Twilio Verify
const sql = require("mssql");

const config = {
  server: process.env.DB_SERVER || "apogeehnp.database.windows.net",
  database: process.env.DB_NAME || "ApogeeFit",
  user: process.env.DB_USER || "ApogeeDev_Haashim",
  password: process.env.DB_PASSWORD || "SecurePassword123",
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

    // Step 1: Add PasswordResetToken column
    console.log("Step 1: Adding PasswordResetToken column...");
    const checkToken = await pool.request().query(`
      SELECT COUNT(*) as exists_count 
      FROM sys.columns 
      WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'PasswordResetToken'
    `);

    if (checkToken.recordset[0].exists_count === 0) {
      await pool.request().query(`
        ALTER TABLE [dbo].[UserLogin]
        ADD PasswordResetToken NVARCHAR(100) NULL
      `);
      console.log("  ✓ Added PasswordResetToken column");
    } else {
      console.log("  - PasswordResetToken column already exists");
    }

    // Step 2: Add PasswordResetExpires column
    console.log("Step 2: Adding PasswordResetExpires column...");
    const checkExpires = await pool.request().query(`
      SELECT COUNT(*) as exists_count 
      FROM sys.columns 
      WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = 'PasswordResetExpires'
    `);

    if (checkExpires.recordset[0].exists_count === 0) {
      await pool.request().query(`
        ALTER TABLE [dbo].[UserLogin]
        ADD PasswordResetExpires DATETIMEOFFSET NULL
      `);
      console.log("  ✓ Added PasswordResetExpires column");
    } else {
      console.log("  - PasswordResetExpires column already exists");
    }

    // Step 3: Create index for PasswordResetToken
    console.log("Step 3: Creating index for PasswordResetToken...");
    const checkIndex = await pool.request().query(`
      SELECT COUNT(*) as exists_count 
      FROM sys.indexes 
      WHERE name = 'IX_UserLogin_PasswordResetToken'
    `);

    if (checkIndex.recordset[0].exists_count === 0) {
      await pool.request().query(`
        CREATE INDEX IX_UserLogin_PasswordResetToken
        ON [dbo].[UserLogin](PasswordResetToken)
        WHERE PasswordResetToken IS NOT NULL
      `);
      console.log("  ✓ Created index IX_UserLogin_PasswordResetToken");
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
        AND COLUMN_NAME IN ('PasswordResetToken', 'PasswordResetExpires')
      ORDER BY COLUMN_NAME
    `);

    console.log("\nPassword Reset columns in UserLogin table:");
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
