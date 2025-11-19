/**
 * Verify Migration - Check if subscription columns exist
 */

require('dotenv').config();
const mssql = require('mssql');

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

async function verifyMigration() {
  let pool;
  
  try {
    pool = await mssql.connect(config);
    
    const result = await pool.request().query(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'user_subscriptions'
        AND COLUMN_NAME IN ('subscription_id', 'customer_id', 'current_period_start', 'current_period_end')
      ORDER BY COLUMN_NAME
    `);
    
    console.log('📋 Subscription columns in user_subscriptions table:');
    console.log('');
    
    if (result.recordset.length === 0) {
      console.log('❌ No subscription columns found!');
    } else {
      result.recordset.forEach(col => {
        const maxLength = col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '';
        console.log(`  ✅ ${col.COLUMN_NAME}: ${col.DATA_TYPE}${maxLength} (Nullable: ${col.IS_NULLABLE})`);
      });
    }
    
    // Check indexes
    const indexResult = await pool.request().query(`
      SELECT 
        i.name AS index_name,
        COL_NAME(ic.object_id, ic.column_id) AS column_name
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      WHERE i.object_id = OBJECT_ID('dbo.user_subscriptions')
        AND i.name LIKE 'IX_user_subscriptions_%'
      ORDER BY i.name, ic.key_ordinal
    `);
    
    if (indexResult.recordset.length > 0) {
      console.log('');
      console.log('📋 Indexes created:');
      indexResult.recordset.forEach(idx => {
        console.log(`  ✅ ${idx.index_name} on ${idx.column_name}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
  } finally {
    if (pool) await pool.close();
  }
}

verifyMigration();



