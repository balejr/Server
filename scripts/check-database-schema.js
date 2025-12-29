require('dotenv').config();
const { connectToDatabase, getPool } = require('../config/db');
const mssql = require('mssql');

async function checkDatabaseSchema() {
  console.log('🔍 Checking database schema...\n');
  
  try {
    await connectToDatabase();
    const pool = getPool();
    
    if (!pool) {
      console.error('❌ Database connection failed');
      process.exit(1);
    }

    console.log('✅ Connected to database\n');

    // Check user_subscriptions table schema
    console.log('📋 Checking user_subscriptions table schema...\n');
    
    const schemaRequest = pool.request();
    const schemaResult = await schemaRequest.query(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH,
        COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'user_subscriptions'
      ORDER BY ORDINAL_POSITION;
    `);

    console.log('Current columns in user_subscriptions:');
    console.table(schemaResult.recordset);

    // Expected columns based on code
    const expectedColumns = [
      { name: 'UserId', type: 'int', nullable: 'NO' },
      { name: 'plan', type: 'nvarchar', nullable: 'NO', length: 32 },
      { name: 'status', type: 'nvarchar', nullable: 'NO', length: 32 },
      { name: 'subscription_id', type: 'nvarchar', nullable: 'YES', length: 128 },
      { name: 'customer_id', type: 'nvarchar', nullable: 'YES', length: 128 },
      { name: 'current_period_start', type: 'datetimeoffset', nullable: 'YES' },
      { name: 'current_period_end', type: 'datetimeoffset', nullable: 'YES' },
      { name: 'payment_intent_id', type: 'nvarchar', nullable: 'YES', length: 128 },
      { name: 'billing_interval', type: 'nvarchar', nullable: 'YES', length: 32 },
      { name: 'started_at', type: 'datetimeoffset', nullable: 'YES' },
      { name: 'updated_at', type: 'datetimeoffset', nullable: 'YES' },
    ];

    console.log('\n📋 Expected columns:');
    expectedColumns.forEach(col => {
      console.log(`  - ${col.name}: ${col.type}${col.length ? `(${col.length})` : ''} ${col.nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });

    // Find missing columns
    const currentColumnNames = schemaResult.recordset.map(col => col.COLUMN_NAME.toLowerCase());
    const missingColumns = expectedColumns.filter(col => 
      !currentColumnNames.includes(col.name.toLowerCase())
    );

    // Find extra columns
    const expectedColumnNames = expectedColumns.map(col => col.name.toLowerCase());
    const extraColumns = schemaResult.recordset.filter(col => 
      !expectedColumnNames.includes(col.COLUMN_NAME.toLowerCase())
    );

    console.log('\n🔍 Analysis:');
    
    if (missingColumns.length > 0) {
      console.log('\n❌ Missing columns:');
      missingColumns.forEach(col => {
        console.log(`  - ${col.name}`);
      });
    } else {
      console.log('\n✅ All expected columns exist');
    }

    if (extraColumns.length > 0) {
      console.log('\n⚠️ Extra columns found (not in code):');
      extraColumns.forEach(col => {
        console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE})`);
      });
    } else {
      console.log('\n✅ No extra columns found');
    }

    // Check indexes
    console.log('\n📋 Checking indexes...\n');
    const indexRequest = pool.request();
    const indexResult = await indexRequest.query(`
      SELECT 
        i.name AS index_name,
        i.type_desc AS index_type,
        COL_NAME(ic.object_id, ic.column_id) AS column_name
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      INNER JOIN sys.tables t ON i.object_id = t.object_id
      WHERE t.name = 'user_subscriptions'
        AND i.name IS NOT NULL
      ORDER BY i.name, ic.key_ordinal;
    `);

    if (indexResult.recordset.length > 0) {
      console.log('Current indexes:');
      console.table(indexResult.recordset);
    } else {
      console.log('No indexes found');
    }

    // Summary
    console.log('\n📊 Summary:');
    console.log(`  Current columns: ${schemaResult.recordset.length}`);
    console.log(`  Expected columns: ${expectedColumns.length}`);
    console.log(`  Missing: ${missingColumns.length}`);
    console.log(`  Extra: ${extraColumns.length}`);

    if (missingColumns.length === 0 && extraColumns.length === 0) {
      console.log('\n✅ Database schema matches code perfectly!');
    } else {
      console.log('\n⚠️ Schema differences found. Review above for details.');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (getPool()) {
      await getPool().close();
      console.log('\n✅ Database connection closed');
    }
  }
}

checkDatabaseSchema()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });






