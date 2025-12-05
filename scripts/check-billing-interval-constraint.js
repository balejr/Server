require('dotenv').config();
const { connectToDatabase, getPool } = require('../config/db');
const mssql = require('mssql');

async function checkConstraint() {
  console.log('🔍 Checking billing_interval CHECK constraint...\n');
  
  try {
    await connectToDatabase();
    const pool = getPool();
    
    if (!pool) {
      console.error('❌ Database connection failed');
      process.exit(1);
    }

    console.log('✅ Connected to database\n');

    // Check for CHECK constraint on billing_interval
    const constraintRequest = pool.request();
    const constraintResult = await constraintRequest.query(`
      SELECT 
        cc.name AS constraint_name,
        cc.definition AS constraint_definition,
        c.name AS column_name
      FROM sys.check_constraints cc
      INNER JOIN sys.columns c ON cc.parent_object_id = c.object_id
      WHERE cc.parent_object_id = OBJECT_ID('dbo.user_subscriptions')
        AND c.name = 'billing_interval';
    `);

    if (constraintResult.recordset.length > 0) {
      console.log('Found CHECK constraint on billing_interval:');
      console.table(constraintResult.recordset);
      console.log('\nConstraint definition:');
      constraintResult.recordset.forEach(row => {
        console.log(`  ${row.constraint_name}: ${row.constraint_definition}`);
      });
    } else {
      console.log('No CHECK constraint found on billing_interval');
    }

    // Check what values are currently in the database
    const valuesRequest = pool.request();
    const valuesResult = await valuesRequest.query(`
      SELECT DISTINCT billing_interval, COUNT(*) as count
      FROM [dbo].[user_subscriptions]
      WHERE billing_interval IS NOT NULL
      GROUP BY billing_interval;
    `);

    if (valuesResult.recordset.length > 0) {
      console.log('\nCurrent values in billing_interval column:');
      console.table(valuesResult.recordset);
    } else {
      console.log('\nNo values found in billing_interval column');
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

checkConstraint()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });






