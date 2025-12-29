require('dotenv').config();
const { connectToDatabase, getPool } = require('../config/db');
const mssql = require('mssql');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  console.log('🔄 Starting billing_interval migration...\n');
  
  try {
    // Connect to database
    await connectToDatabase();
    const pool = getPool();
    
    if (!pool) {
      console.error('❌ Database connection failed. Please check environment variables:');
      console.error('   - DB_HOST');
      console.error('   - DB_NAME');
      console.error('   - DB_USER');
      console.error('   - DB_PASSWORD');
      process.exit(1);
    }

    console.log('✅ Connected to database\n');

    // Read the migration SQL file from ApogeeHnP/server
    const migrationPath = path.join(__dirname, '../../ApogeeHnP/server/MIGRATION_ADD_BILLING_INTERVAL.sql');
    
    // If file doesn't exist in that location, use inline SQL
    let migrationSQL;
    if (fs.existsSync(migrationPath)) {
      migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    } else {
      // Inline migration SQL
      migrationSQL = `
-- Migration: Add billing_interval column to user_subscriptions table
-- Date: 2024
-- Description: Adds support for tracking subscription billing intervals (monthly, semi_annual, annual)

-- Check if billing_interval column already exists before adding
IF NOT EXISTS (
    SELECT * 
    FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[user_subscriptions]') 
    AND name = 'billing_interval'
)
BEGIN
    -- Add billing_interval column
    ALTER TABLE [dbo].[user_subscriptions]
    ADD [billing_interval] NVARCHAR(32) NULL;
    
    PRINT '✅ Added billing_interval column to user_subscriptions table';
END
ELSE
BEGIN
    PRINT '⚠️ billing_interval column already exists, skipping...';
END

-- Create index for querying by billing interval (if it doesn't exist)
IF NOT EXISTS (
    SELECT * 
    FROM sys.indexes 
    WHERE name = 'idx_billing_interval' 
    AND object_id = OBJECT_ID(N'[dbo].[user_subscriptions]')
)
BEGIN
    CREATE NONCLUSTERED INDEX [idx_billing_interval] 
    ON [dbo].[user_subscriptions] ([billing_interval]);
    
    PRINT '✅ Created index idx_billing_interval';
END
ELSE
BEGIN
    PRINT '⚠️ Index idx_billing_interval already exists, skipping...';
END

-- Verify the migration
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'user_subscriptions'
  AND COLUMN_NAME = 'billing_interval';

PRINT '✅ Migration completed successfully!';
PRINT '   billing_interval column is ready to store: monthly, semi_annual, or annual';
      `;
    }

    // Split SQL script by GO statements and execute each batch
    // Remove comments and split by GO
    const cleanedSQL = migrationSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('--') || line.trim().startsWith('PRINT'))
      .join('\n');
    
    const batches = cleanedSQL
      .split(/^\s*GO\s*$/gim)
      .map(batch => batch.trim())
      .filter(batch => batch.length > 0);

    console.log(`📝 Found ${batches.length} SQL batch(es) to execute\n`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      // Skip PRINT statements (they don't work with mssql)
      if (batch.trim().toUpperCase().startsWith('PRINT')) {
        console.log(batch.replace('PRINT', '').replace(/'/g, '').trim());
        continue;
      }

      try {
        console.log(`Executing batch ${i + 1}/${batches.length}...`);
        
        const request = pool.request();
        const result = await request.query(batch);
        
        // Handle SELECT queries (verification query)
        if (batch.trim().toUpperCase().startsWith('SELECT')) {
          if (result.recordset && result.recordset.length > 0) {
            console.log('✅ Verification query results:');
            console.table(result.recordset);
          } else {
            console.log('⚠️  Column not found (this is expected if migration hasn\'t run yet)');
          }
        } else {
          console.log('✅ Batch executed successfully\n');
        }
      } catch (batchError) {
        // Check if error is because column/index already exists
        if (batchError.message.includes('already exists') || 
            batchError.message.includes('duplicate key') ||
            batchError.message.includes('There is already an object') ||
            batchError.message.includes('Cannot create duplicate key')) {
          console.log(`⚠️  ${batchError.message.split('\n')[0]}`);
          console.log('   (This is okay - column/index may already exist)\n');
        } else {
          throw batchError;
        }
      }
    }

    // Run verification query separately
    console.log('\n🔍 Verifying migration...');
    const verifyRequest = pool.request();
    const verifyResult = await verifyRequest.query(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'user_subscriptions'
        AND COLUMN_NAME = 'billing_interval';
    `);

    if (verifyResult.recordset && verifyResult.recordset.length > 0) {
      console.log('✅ Migration verified successfully!');
      console.table(verifyResult.recordset);
      console.log('\n✅ billing_interval column is ready to store: monthly, semi_annual, or annual');
    } else {
      console.log('⚠️  Verification: billing_interval column not found');
      console.log('   This may mean the migration needs to be run again.');
    }

    // Check for index
    const indexRequest = pool.request();
    const indexResult = await indexRequest.query(`
      SELECT 
        i.name AS index_name,
        i.type_desc AS index_type
      FROM sys.indexes i
      INNER JOIN sys.tables t ON i.object_id = t.object_id
      WHERE t.name = 'user_subscriptions'
        AND i.name = 'idx_billing_interval';
    `);

    if (indexResult.recordset && indexResult.recordset.length > 0) {
      console.log('\n✅ Index idx_billing_interval verified');
      console.table(indexResult.recordset);
    } else {
      console.log('\n⚠️  Index idx_billing_interval not found');
    }

    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    // Close connection
    if (getPool()) {
      await getPool().close();
      console.log('\n✅ Database connection closed');
    }
  }
}

// Run the migration
runMigration()
  .then(() => {
    console.log('\n✅ Migration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration script failed:', error);
    process.exit(1);
  });

