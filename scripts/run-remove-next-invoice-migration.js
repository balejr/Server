/**
 * Database Migration Script Runner
 * Removes the next_invoice column from user_subscriptions table
 * 
 * Usage: node scripts/run-remove-next-invoice-migration.js
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
    
    if (!config.server || !config.database) {
      throw new Error('Database configuration missing. Please set DB_HOST/DB_NAME or AZURE_SQL_SERVER/AZURE_SQL_DATABASE environment variables.');
    }
    
    pool = await mssql.connect(config);
    console.log('✅ Connected to database');
    console.log('');
    
    // Read the migration script
    const migrationPath = path.join(__dirname, 'remove_next_invoice_column.sql');
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split by GO statements and execute each batch
    const batches = migrationSQL.split(/^\s*GO\s*$/gim).filter(batch => batch.trim().length > 0);
    
    console.log(`📝 Executing ${batches.length} SQL batch(es)...`);
    console.log('');
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i].trim();
      if (batch.length === 0) continue;
      
      try {
        const request = pool.request();
        const result = await request.query(batch);
        
        // Print any messages from PRINT statements (if available)
        if (result.recordset && result.recordset.length > 0) {
          result.recordset.forEach(row => {
            const message = Object.values(row)[0];
            if (message) console.log(`   ${message}`);
          });
        }
      } catch (err) {
        // Some errors are expected (like "column does not exist")
        if (err.message.includes('does not exist') || err.message.includes('Cannot drop')) {
          console.log(`   ℹ️ ${err.message.split('\n')[0]}`);
        } else {
          throw err;
        }
      }
    }
    
    console.log('');
    console.log('✅ Migration complete!');
    console.log('');
    console.log('The next_invoice column has been removed from user_subscriptions table.');
    console.log('Next billing date is now derived from current_period_end column.');
    
  } catch (error) {
    console.error('');
    console.error('❌ Migration failed:', error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    if (error.stack) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
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






