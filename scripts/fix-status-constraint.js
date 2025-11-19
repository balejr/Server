require('dotenv').config();
const { connectToDatabase, getPool } = require('../config/db');
const mssql = require('mssql');

async function fixStatusConstraint() {
  console.log('🔧 Checking and fixing status CHECK constraint...\n');
  
  try {
    await connectToDatabase();
    const pool = getPool();
    
    if (!pool) {
      console.error('❌ Database connection failed');
      process.exit(1);
    }

    console.log('✅ Connected to database\n');

    // Check current status constraint
    const checkRequest = pool.request();
    const checkResult = await checkRequest.query(`
      SELECT 
        cc.name AS constraint_name,
        cc.definition AS constraint_definition
      FROM sys.check_constraints cc
      WHERE cc.parent_object_id = OBJECT_ID('dbo.user_subscriptions')
        AND cc.name = 'CK_user_subscriptions_status';
    `);

    if (checkResult.recordset.length === 0) {
      console.log('⚠️ No status constraint found - this might be okay');
      await pool.close();
      process.exit(0);
    }

    console.log('Current status constraint:');
    console.table(checkResult.recordset);

    const currentDefinition = checkResult.recordset[0].constraint_definition;
    console.log(`\nCurrent definition: ${currentDefinition}`);

    // Expected values: 'active', 'trialing', 'past_due', 'canceled', 'incomplete', 'expired'
    const expectedValues = ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'expired'];
    const hasTrialing = currentDefinition.toLowerCase().includes('trialing');

    if (!hasTrialing) {
      console.log('\n⚠️ Status constraint is missing \'trialing\' - fixing...\n');
      
      const transaction = new mssql.Transaction(pool);
      await transaction.begin();
      console.log('📝 Transaction started\n');

      try {
        // Drop old constraint
        console.log('📝 Dropping old status constraint');
        const dropRequest = new mssql.Request(transaction);
        await dropRequest.query(`
          ALTER TABLE [dbo].[user_subscriptions]
          DROP CONSTRAINT [CK_user_subscriptions_status];
        `);
        console.log('✅ Dropped old constraint\n');

        // Create new constraint with all expected values
        console.log('📝 Creating new status constraint with all values...');
        console.log('   Allowed values: active, trialing, past_due, canceled, incomplete, expired');
        const createRequest = new mssql.Request(transaction);
        await createRequest.query(`
          ALTER TABLE [dbo].[user_subscriptions]
          ADD CONSTRAINT [CK_user_subscriptions_status] 
          CHECK ([status] IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'expired'));
        `);
        console.log('✅ Created new constraint\n');

        await transaction.commit();
        console.log('✅ Transaction committed successfully\n');

        // Verify
        const verifyRequest = pool.request();
        const verifyResult = await verifyRequest.query(`
          SELECT 
            cc.name AS constraint_name,
            cc.definition AS constraint_definition
          FROM sys.check_constraints cc
          WHERE cc.parent_object_id = OBJECT_ID('dbo.user_subscriptions')
            AND cc.name = 'CK_user_subscriptions_status';
        `);

        console.log('New constraint definition:');
        verifyResult.recordset.forEach(row => {
          console.log(`  ${row.constraint_name}: ${row.constraint_definition}`);
        });
        console.log('\n✅ Status constraint updated successfully!');

      } catch (error) {
        await transaction.rollback();
        console.error('\n❌ Error during fix - transaction rolled back');
        throw error;
      }
    } else {
      console.log('\n✅ Status constraint already includes \'trialing\' - no fix needed');
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

fixStatusConstraint()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });


