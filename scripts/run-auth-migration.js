// scripts/run-auth-migration.js
// Script to run the authentication enhancements migration

require('dotenv').config();
const mssql = require('mssql');
const fs = require('fs');
const path = require('path');

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

async function runMigration() {
  let pool;
  
  try {
    console.log('Connecting to database...');
    console.log(`Server: ${config.server}`);
    console.log(`Database: ${config.database}`);
    
    pool = await mssql.connect(config);
    console.log('Connected successfully!\n');

    console.log('Running authentication enhancements migration...\n');

    // Step 1: Add phone fields to UserProfile
    console.log('Step 1: Adding phone fields to UserProfile...');
    try {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserProfile') AND name = 'PhoneNumber')
        BEGIN
            ALTER TABLE [dbo].[UserProfile] ADD PhoneNumber NVARCHAR(20) NULL;
        END
      `);
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserProfile') AND name = 'PhoneVerified')
        BEGIN
            ALTER TABLE [dbo].[UserProfile] ADD PhoneVerified BIT DEFAULT 0;
        END
      `);
      console.log('  ✓ Phone fields added to UserProfile\n');
    } catch (err) {
      console.log('  ⚠ Phone fields may already exist:', err.message, '\n');
    }

    // Step 2: Add authentication preferences to UserLogin
    console.log('Step 2: Adding authentication preferences to UserLogin...');
    const loginColumns = [
      { name: 'PreferredLoginMethod', type: 'NVARCHAR(20)', default: "'email'" },
      { name: 'MFAEnabled', type: 'BIT', default: '0' },
      { name: 'MFAMethod', type: 'NVARCHAR(20)', default: 'NULL' },
      { name: 'BiometricEnabled', type: 'BIT', default: '0' },
      { name: 'BiometricToken', type: 'NVARCHAR(500)', default: 'NULL' },
      { name: 'RefreshToken', type: 'NVARCHAR(500)', default: 'NULL' },
      { name: 'RefreshTokenExpires', type: 'DATETIMEOFFSET', default: 'NULL' }
    ];

    for (const col of loginColumns) {
      try {
        await pool.request().query(`
          IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserLogin') AND name = '${col.name}')
          BEGIN
              ALTER TABLE [dbo].[UserLogin] ADD ${col.name} ${col.type} ${col.default !== 'NULL' ? 'DEFAULT ' + col.default : 'NULL'};
          END
        `);
        console.log(`  ✓ ${col.name} column added`);
      } catch (err) {
        console.log(`  ⚠ ${col.name} may already exist:`, err.message);
      }
    }
    console.log('');

    // Step 3: Add constraints
    console.log('Step 3: Adding constraints...');
    
    // PreferredLoginMethod constraint
    try {
      await pool.request().query(`
        IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_PreferredLoginMethod')
        BEGIN
            ALTER TABLE [dbo].[UserLogin] DROP CONSTRAINT CK_PreferredLoginMethod;
        END
      `);
      await pool.request().query(`
        ALTER TABLE [dbo].[UserLogin]
        ADD CONSTRAINT CK_PreferredLoginMethod 
            CHECK (PreferredLoginMethod IN ('email', 'phone', 'biometric'));
      `);
      console.log('  ✓ CK_PreferredLoginMethod constraint added');
    } catch (err) {
      console.log('  ⚠ PreferredLoginMethod constraint:', err.message);
    }

    // MFAMethod constraint
    try {
      await pool.request().query(`
        IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_MFAMethod')
        BEGIN
            ALTER TABLE [dbo].[UserLogin] DROP CONSTRAINT CK_MFAMethod;
        END
      `);
      await pool.request().query(`
        ALTER TABLE [dbo].[UserLogin]
        ADD CONSTRAINT CK_MFAMethod 
            CHECK (MFAMethod IS NULL OR MFAMethod IN ('sms', 'email'));
      `);
      console.log('  ✓ CK_MFAMethod constraint added\n');
    } catch (err) {
      console.log('  ⚠ MFAMethod constraint:', err.message, '\n');
    }

    // Step 4: Create OTPVerifications table
    console.log('Step 4: Creating OTPVerifications table...');
    try {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OTPVerifications')
        BEGIN
            CREATE TABLE [dbo].[OTPVerifications] (
                VerificationID INT IDENTITY(1,1) PRIMARY KEY,
                UserID INT NOT NULL,
                PhoneOrEmail NVARCHAR(255) NOT NULL,
                VerificationSID NVARCHAR(100),
                Purpose NVARCHAR(50) NOT NULL,
                Status NVARCHAR(20) DEFAULT 'pending',
                CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
                ExpiresAt DATETIMEOFFSET,
                AttemptCount INT DEFAULT 0,
                CONSTRAINT FK_OTPVerifications_UserProfile
                    FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID) ON DELETE CASCADE,
                CONSTRAINT CK_OTP_Purpose
                    CHECK (Purpose IN ('login', 'mfa', 'password_reset', 'phone_verify')),
                CONSTRAINT CK_OTP_Status
                    CHECK (Status IN ('pending', 'approved', 'expired', 'failed'))
            );
        END
      `);
      console.log('  ✓ OTPVerifications table created\n');
    } catch (err) {
      console.log('  ⚠ OTPVerifications table:', err.message, '\n');
    }

    // Step 5: Add indexes
    console.log('Step 5: Adding indexes...');
    const indexes = [
      { name: 'IX_OTPVerifications_UserID_Purpose', columns: 'UserID, Purpose' },
      { name: 'IX_OTPVerifications_VerificationSID', columns: 'VerificationSID' },
      { name: 'IX_OTPVerifications_CreatedAt', columns: 'CreatedAt' }
    ];

    for (const idx of indexes) {
      try {
        await pool.request().query(`
          IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = '${idx.name}')
          BEGIN
              CREATE INDEX ${idx.name} ON [dbo].[OTPVerifications](${idx.columns});
          END
        `);
        console.log(`  ✓ ${idx.name} index added`);
      } catch (err) {
        console.log(`  ⚠ ${idx.name} index:`, err.message);
      }
    }
    console.log('');

    // Step 6: Set default values for existing users
    console.log('Step 6: Setting default values for existing users...');
    try {
      const result = await pool.request().query(`
        UPDATE [dbo].[UserLogin]
        SET PreferredLoginMethod = 'email',
            MFAEnabled = 0,
            BiometricEnabled = 0
        WHERE PreferredLoginMethod IS NULL;
      `);
      console.log(`  ✓ Updated ${result.rowsAffected[0]} existing users\n`);
    } catch (err) {
      console.log('  ⚠ Setting defaults:', err.message, '\n');
    }

    // Step 7: Verify migration
    console.log('Step 7: Verifying migration...');
    
    const userProfileCols = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserProfile'
        AND COLUMN_NAME IN ('PhoneNumber', 'PhoneVerified')
    `);
    console.log('  UserProfile new columns:', userProfileCols.recordset.map(r => r.COLUMN_NAME).join(', '));

    const userLoginCols = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserLogin'
        AND COLUMN_NAME IN ('PreferredLoginMethod', 'MFAEnabled', 'MFAMethod', 'BiometricEnabled', 'BiometricToken', 'RefreshToken', 'RefreshTokenExpires')
    `);
    console.log('  UserLogin new columns:', userLoginCols.recordset.map(r => r.COLUMN_NAME).join(', '));

    const otpTableExists = await pool.request().query(`
      SELECT COUNT(*) as count FROM sys.tables WHERE name = 'OTPVerifications'
    `);
    console.log('  OTPVerifications table exists:', otpTableExists.recordset[0].count > 0 ? 'Yes' : 'No');

    console.log('\n========================================');
    console.log('Migration completed successfully!');
    console.log('========================================\n');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

runMigration();

