/**
 * Database Migration Script Runner
 * Runs the SQL migration to add subscription columns to user_subscriptions table
 * 
 * Usage: node scripts/run-migration.js
 */

require('dotenv').config();
const mssql = require('mssql');
const fs = require('fs');
const path = require('path');

const config = {
  server: process.env.DB_HOST || process.env.AZURE_SQL_SERVER,
  database: process.env.DB_NAME || process.env.AZURE_SQL_DATABASE,
  authentication: {
    type: 'default',
    options: {
      userName: process.env.DB_USER || process.env.AZURE_SQL_USER,
      password: process.env.DB_PASSWORD || process.env.AZURE_SQL_PASSWORD,
    }
  },
  options: {
    encrypt: true,
    trustServerCertificate: false,
    enableArithAbort: true,
    requestTimeout: 30000,
  }
};

async function runMigration() {
  let pool;
  
  try {
    console.log('🔄 Connecting to Azure SQL Database...');
    console.log(`   Server: ${config.server}`);
    console.log(`   Database: ${config.database}`);
    
    pool = await mssql.connect(config);
    console.log('✅ Connected to database');
    
    // Read the migration script
    const migrationPath = path.join(__dirname, 'migrate-subscription-schema.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split by GO statements and execute each batch
    const batches = migrationSQL.split(/^\s*GO\s*$/gim).filter(batch => batch.trim().length > 0);
    
    console.log(`📝 Executing ${batches.length} SQL batches...`);
    console.log('');
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i].trim();
      if (batch.length === 0) continue;
      
      try {
        const result = await pool.request().query(batch);
        // Print any messages from PRINT statements
        if (result.recordset && result.recordset.length > 0) {
          result.recordset.forEach(row => {
            const message = Object.values(row)[0];
            if (message) console.log(`   ${message}`);
          });
        }
      } catch (err) {
        // Some errors are expected (like "column already exists")
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          console.log(`   ⚠️ ${err.message.split('\n')[0]}`);
        } else {
          throw err;
        }
      }
    }
    
    console.log('');
    console.log('✅ Migration complete!');
    console.log('');
    console.log('The user_subscriptions table now supports:');
    console.log('  - subscription_id: Stripe Subscription ID (sub_xxx)');
    console.log('  - customer_id: Stripe Customer ID (cus_xxx)');
    console.log('  - current_period_start: Start of current billing period');
    console.log('  - current_period_end: End of current billing period');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log('');
      console.log('🔌 Database connection closed');
    }
  }
}

// Run if called directly
if (require.main === module) {
  runMigration()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };






