require('dotenv').config();
const { connectToDatabase, getPool } = require('../config/db');
const mssql = require('mssql');

async function verifyConstraints() {
  console.log('🔍 Verifying all CHECK constraints...\n');
  
  try {
    await connectToDatabase();
    const pool = getPool();
    
    if (!pool) {
      console.error('❌ Database connection failed');
      process.exit(1);
    }

    console.log('✅ Connected to database\n');

    // Get all CHECK constraints on user_subscriptions
    const constraintRequest = pool.request();
    const constraintResult = await constraintRequest.query(`
      SELECT 
        cc.name AS constraint_name,
        cc.definition AS constraint_definition,
        c.name AS column_name
      FROM sys.check_constraints cc
      INNER JOIN sys.columns c ON cc.parent_object_id = c.object_id
      WHERE cc.parent_object_id = OBJECT_ID('dbo.user_subscriptions')
      ORDER BY c.name, cc.name;
    `);

    console.log('All CHECK constraints on user_subscriptions:');
    console.table(constraintResult.recordset);

    console.log('\n📋 Constraint details:');
    constraintResult.recordset.forEach(row => {
      console.log(`\n${row.constraint_name} (on ${row.column_name}):`);
      console.log(`  ${row.constraint_definition}`);
    });

    // Expected values based on code
    console.log('\n📋 Expected values based on code:');
    console.log('  billing_interval: NULL, \'monthly\', \'semi_annual\', \'annual\'');
    console.log('  plan: \'Premium\', \'Free\' (capitalized)');
    console.log('  status: \'active\', \'trialing\', \'past_due\', \'canceled\', \'incomplete\', etc.');

    // Check if constraints match expectations
    const billingConstraint = constraintResult.recordset.find(c => c.constraint_name === 'CK_user_subscriptions_billing_interval');
    if (billingConstraint) {
      const definition = billingConstraint.constraint_definition.toLowerCase();
      if (definition.includes('monthly') && definition.includes('semi_annual') && definition.includes('annual')) {
        console.log('\n✅ billing_interval constraint is correct');
      } else {
        console.log('\n⚠️ billing_interval constraint may need review');
      }
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

verifyConstraints()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });


