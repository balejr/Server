// Script to add email verification purposes to OTPVerifications table
require("dotenv").config();
const { connectToDatabase, getPool } = require("../config/db");

async function runMigration() {
  console.log("🔄 Running email verification purposes migration...\n");

  try {
    await connectToDatabase();
    const pool = getPool();

    if (!pool) {
      console.error("❌ Database connection failed");
      process.exit(1);
    }

    console.log("✅ Connected to database\n");

    // Check if constraint exists
    console.log("Step 1: Checking existing constraint...");
    const checkConstraint = await pool.request().query(`
      SELECT cc.name, cc.definition
      FROM sys.check_constraints cc
      WHERE cc.parent_object_id = OBJECT_ID('dbo.OTPVerifications')
        AND cc.name = 'CK_OTP_Purpose'
    `);

    if (checkConstraint.recordset.length > 0) {
      console.log("  Current constraint:", checkConstraint.recordset[0].definition);
      
      // Drop existing constraint
      console.log("\nStep 2: Dropping existing constraint...");
      await pool.request().query(`
        ALTER TABLE [dbo].[OTPVerifications] DROP CONSTRAINT CK_OTP_Purpose
      `);
      console.log("  ✅ Dropped existing constraint");
    } else {
      console.log("  ℹ️ No existing constraint found");
    }

    // Add updated constraint
    console.log("\nStep 3: Adding updated constraint with 'verification' support...");
    await pool.request().query(`
      ALTER TABLE [dbo].[OTPVerifications]
      ADD CONSTRAINT CK_OTP_Purpose
        CHECK (Purpose IN ('login', 'signin', 'signup', 'mfa', 'password_reset', 'phone_verify', 'verification'))
    `);
    console.log("  ✅ Added updated constraint");

    // Verify the change
    console.log("\nStep 4: Verifying changes...");
    const verifyConstraint = await pool.request().query(`
      SELECT cc.name, cc.definition
      FROM sys.check_constraints cc
      WHERE cc.parent_object_id = OBJECT_ID('dbo.OTPVerifications')
        AND cc.name = 'CK_OTP_Purpose'
    `);

    if (verifyConstraint.recordset.length > 0) {
      console.log("  ✅ Constraint verified:");
      console.log("  ", verifyConstraint.recordset[0].definition);
    }

    console.log("\n✅ Migration completed successfully!");
    console.log("Allowed purposes: login, signin, signup, mfa, password_reset, phone_verify, verification\n");

  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (getPool()) {
      await getPool().close();
      console.log("✅ Database connection closed");
    }
  }
}

runMigration();







