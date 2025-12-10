// run-migration.js
// Script to execute pre-assessment database migration

require('dotenv').config();
const sql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

async function runMigration() {
  let pool;
  
  try {
    console.log('🔗 Connecting to Azure SQL Database...');
    console.log(`   Server: ${config.server}`);
    console.log(`   Database: ${config.database}`);
    console.log(`   User: ${config.user}`);
    
    pool = await sql.connect(config);
    console.log('✅ Connected to database successfully\n');
    
    // Step 1: Check if columns already exist
    console.log('📋 Checking existing columns...');
    const checkQuery = `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'UserProfile'
        AND COLUMN_NAME IN ('DOB', 'Height', 'HeightUnit', 'Weight', 'WeightUnit', 'Goals')
    `;
    
    const existingColumns = await pool.request().query(checkQuery);
    const existingColumnNames = existingColumns.recordset.map(row => row.COLUMN_NAME);
    
    console.log(`   Found existing columns: ${existingColumnNames.join(', ') || 'none'}\n`);
    
    // Step 2: Add missing columns
    const columnsToAdd = [];
    const columnDefinitions = {
      'DOB': '[DOB] DATE NULL',
      'Height': '[Height] FLOAT NULL',
      'HeightUnit': '[HeightUnit] NVARCHAR(10) NULL',
      'Weight': '[Weight] FLOAT NULL',
      'WeightUnit': '[WeightUnit] NVARCHAR(10) NULL',
      'Goals': '[Goals] NVARCHAR(MAX) NULL'
    };
    
    for (const [colName, colDef] of Object.entries(columnDefinitions)) {
      if (!existingColumnNames.includes(colName)) {
        columnsToAdd.push(colDef);
      }
    }
    
    if (columnsToAdd.length === 0) {
      console.log('⚠️  All columns already exist. No migration needed.');
    } else {
      console.log(`🔧 Adding ${columnsToAdd.length} new columns...`);
      
      // Add columns one by one to handle errors gracefully
      for (const [colName, colDef] of Object.entries(columnDefinitions)) {
        if (!existingColumnNames.includes(colName)) {
          try {
            const alterQuery = `ALTER TABLE [dbo].[UserProfile] ADD ${colDef}`;
            await pool.request().query(alterQuery);
            console.log(`   ✅ Added column: ${colName}`);
          } catch (err) {
            if (err.message.includes('already exists')) {
              console.log(`   ⚠️  Column ${colName} already exists, skipping...`);
            } else {
              throw err;
            }
          }
        } else {
          console.log(`   ⏭️  Column ${colName} already exists, skipping...`);
        }
      }
    }
    
    // Step 3: Verify all columns are now present
    console.log('\n🔍 Verifying migration...');
    const verifyQuery = `
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'UserProfile'
        AND COLUMN_NAME IN ('DOB', 'Height', 'HeightUnit', 'Weight', 'WeightUnit', 'Goals')
      ORDER BY COLUMN_NAME
    `;
    
    const verifyResult = await pool.request().query(verifyQuery);
    
    console.log('\n📊 Current UserProfile Schema (Pre-Assessment Fields):');
    console.log('─────────────────────────────────────────────────────────');
    console.log('Column Name       | Data Type      | Nullable | Max Length');
    console.log('─────────────────────────────────────────────────────────');
    
    verifyResult.recordset.forEach(row => {
      const colName = row.COLUMN_NAME.padEnd(17);
      const dataType = row.DATA_TYPE.padEnd(14);
      const nullable = row.IS_NULLABLE.padEnd(8);
      const maxLength = row.CHARACTER_MAXIMUM_LENGTH || 'N/A';
      console.log(`${colName} | ${dataType} | ${nullable} | ${maxLength}`);
    });
    console.log('─────────────────────────────────────────────────────────');
    
    if (verifyResult.recordset.length === 6) {
      console.log('\n✅ Migration completed successfully!');
      console.log('   All 6 pre-assessment columns are present in UserProfile table.\n');
      return true;
    } else {
      console.log(`\n❌ Migration incomplete: Expected 6 columns, found ${verifyResult.recordset.length}`);
      return false;
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('   Details:', error);
    return false;
  } finally {
    if (pool) {
      await pool.close();
      console.log('🔒 Database connection closed.');
    }
  }
}

// Run migration
console.log('═══════════════════════════════════════════════════════════');
console.log('   PRE-ASSESSMENT DATABASE MIGRATION');
console.log('═══════════════════════════════════════════════════════════\n');

runMigration()
  .then(success => {
    if (success) {
      console.log('✨ Migration script completed successfully!');
      process.exit(0);
    } else {
      console.log('⚠️  Migration script completed with warnings.');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });

