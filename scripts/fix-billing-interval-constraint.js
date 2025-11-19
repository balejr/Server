require('dotenv').config();
const { connectToDatabase, getPool } = require('../config/db');
const mssql = require('mssql');

async function fixConstraint() {
  console.log('🔧 Fixing billing_interval CHECK constraint...\n');
  
  try {
    await connectToDatabase();
    const pool = getPool();
    
    if (!pool) {
      console.error('❌ Database connection failed');
      process.exit(1);
    }

    console.log('✅ Connected to database\n');

    const transaction = new mssql.Transaction(pool);
    await transaction.begin();
    console.log('📝 Transaction started\n');

    try {
      // Drop the old constraint
      console.log('📝 Dropping old CHECK constraint: CK_user_subscriptions_billing_interval');
      const dropRequest = new mssql.Request(transaction);
      await dropRequest.query(`
        ALTER TABLE [dbo].[user_subscriptions]
        DROP CONSTRAINT [CK_user_subscriptions_billing_interval];
      `);
      console.log('✅ Dropped old constraint\n');

      // Create new constraint with correct values
      // Code uses: 'monthly', 'semi_annual', 'annual'
      console.log('📝 Creating new CHECK constraint with correct values...');
      console.log('   Allowed values: NULL, \'monthly\', \'semi_annual\', \'annual\'');
      const createRequest = new mssql.Request(transaction);
      await createRequest.query(`
        ALTER TABLE [dbo].[user_subscriptions]
        ADD CONSTRAINT [CK_user_subscriptions_billing_interval] 
        CHECK ([billing_interval] IS NULL OR 
               [billing_interval] IN ('monthly', 'semi_annual', 'annual'));
      `);
      console.log('✅ Created new constraint\n');

      await transaction.commit();
      console.log('✅ Transaction committed successfully\n');

      // Verify the constraint
      console.log('🔍 Verifying new constraint...\n');
      const verifyRequest = pool.request();
      const verifyResult = await verifyRequest.query(`
        SELECT 
          cc.name AS constraint_name,
          cc.definition AS constraint_definition
        FROM sys.check_constraints cc
        WHERE cc.parent_object_id = OBJECT_ID('dbo.user_subscriptions')
          AND cc.name = 'CK_user_subscriptions_billing_interval';
      `);

      if (verifyResult.recordset.length > 0) {
        console.log('New constraint definition:');
        verifyResult.recordset.forEach(row => {
          console.log(`  ${row.constraint_name}: ${row.constraint_definition}`);
        });
        console.log('\n✅ Constraint updated successfully!');
        console.log('   The constraint now allows: NULL, \'monthly\', \'semi_annual\', \'annual\'');
      } else {
        console.log('⚠️ Could not verify constraint - please check manually');
      }

    } catch (error) {
      await transaction.rollback();
      console.error('\n❌ Error during fix - transaction rolled back');
      throw error;
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

fixConstraint()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });


