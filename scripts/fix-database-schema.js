require('dotenv').config();
const { connectToDatabase, getPool } = require('../config/db');
const mssql = require('mssql');

async function fixDatabaseSchema() {
  console.log('🔧 Fixing database schema to match code...\n');
  
  try {
    await connectToDatabase();
    const pool = getPool();
    
    if (!pool) {
      console.error('❌ Database connection failed');
      process.exit(1);
    }

    console.log('✅ Connected to database\n');

    // Check if SubscriptionRecordId column exists
    const checkRequest = pool.request();
    const checkResult = await checkRequest.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'user_subscriptions'
        AND COLUMN_NAME = 'SubscriptionRecordId';
    `);

    if (checkResult.recordset.length === 0) {
      console.log('✅ SubscriptionRecordId column does not exist - no fix needed');
      await pool.close();
      process.exit(0);
    }

    console.log('⚠️ Found SubscriptionRecordId column - this is not in the code and needs to be removed\n');

    // Check if there are any foreign key constraints or dependencies
    console.log('🔍 Checking for constraints and dependencies...\n');
    
    const constraintRequest = pool.request();
    const constraintResult = await constraintRequest.query(`
      SELECT 
        kc.name AS constraint_name,
        kc.type_desc AS constraint_type,
        c.name AS column_name
      FROM sys.key_constraints kc
      INNER JOIN sys.index_columns ic ON kc.parent_object_id = ic.object_id AND kc.unique_index_id = ic.index_id
      INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE kc.parent_object_id = OBJECT_ID('dbo.user_subscriptions')
        AND c.name = 'SubscriptionRecordId';
    `);

    if (constraintResult.recordset.length > 0) {
      console.log('Found constraints on SubscriptionRecordId:');
      console.table(constraintResult.recordset);
    }

    // Start transaction
    const transaction = new mssql.Transaction(pool);
    await transaction.begin();
    console.log('📝 Transaction started\n');

    try {
      // Step 1: Drop primary key constraint if it exists on SubscriptionRecordId
      const pkName = 'PK_user_subscriptions_SubscriptionRecordId';
      const checkPKRequest = new mssql.Request(transaction);
      const pkExists = await checkPKRequest.query(`
        SELECT name 
        FROM sys.key_constraints 
        WHERE parent_object_id = OBJECT_ID('dbo.user_subscriptions')
          AND name = '${pkName}';
      `);

      if (pkExists.recordset.length > 0) {
        console.log(`📝 Dropping primary key constraint: ${pkName}`);
        const dropPKRequest = new mssql.Request(transaction);
        await dropPKRequest.query(`
          ALTER TABLE [dbo].[user_subscriptions]
          DROP CONSTRAINT [${pkName}];
        `);
        console.log(`✅ Dropped primary key constraint\n`);
      }

      // Step 2: Ensure UserId is the primary key (if not already)
      const checkUserIdPKRequest = new mssql.Request(transaction);
      const userIdPKExists = await checkUserIdPKRequest.query(`
        SELECT name 
        FROM sys.key_constraints 
        WHERE parent_object_id = OBJECT_ID('dbo.user_subscriptions')
          AND type = 'PK'
          AND name LIKE '%UserId%';
      `);

      if (userIdPKExists.recordset.length === 0) {
        console.log('📝 Creating primary key on UserId');
        const createPKRequest = new mssql.Request(transaction);
        await createPKRequest.query(`
          ALTER TABLE [dbo].[user_subscriptions]
          ADD CONSTRAINT [PK_user_subscriptions] PRIMARY KEY CLUSTERED ([UserId]);
        `);
        console.log(`✅ Created primary key on UserId\n`);
      } else {
        console.log(`✅ UserId already has primary key constraint\n`);
      }

      // Step 3: Drop unique constraint on UserId if it exists (since it's now PK)
      const uqName = 'UQ_user_subscriptions_UserId';
      const checkUQRequest = new mssql.Request(transaction);
      const uqExists = await checkUQRequest.query(`
        SELECT name 
        FROM sys.key_constraints 
        WHERE parent_object_id = OBJECT_ID('dbo.user_subscriptions')
          AND name = '${uqName}';
      `);

      if (uqExists.recordset.length > 0) {
        console.log(`📝 Dropping unique constraint: ${uqName} (UserId is now PK)`);
        const dropUQRequest = new mssql.Request(transaction);
        await dropUQRequest.query(`
          ALTER TABLE [dbo].[user_subscriptions]
          DROP CONSTRAINT [${uqName}];
        `);
        console.log(`✅ Dropped unique constraint\n`);
      }

      // Step 4: Drop the SubscriptionRecordId column
      console.log('📝 Dropping SubscriptionRecordId column');
      const dropColumnRequest = new mssql.Request(transaction);
      await dropColumnRequest.query(`
        ALTER TABLE [dbo].[user_subscriptions]
        DROP COLUMN [SubscriptionRecordId];
      `);
      console.log(`✅ Dropped SubscriptionRecordId column\n`);

      // Commit transaction
      await transaction.commit();
      console.log('✅ Transaction committed successfully\n');

      // Verify the fix
      console.log('🔍 Verifying fix...\n');
      const verifyRequest = pool.request();
      const verifyResult = await verifyRequest.query(`
        SELECT 
          COLUMN_NAME,
          DATA_TYPE,
          IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME = 'user_subscriptions'
        ORDER BY ORDINAL_POSITION;
      `);

      console.log('Updated columns in user_subscriptions:');
      console.table(verifyResult.recordset);

      // Check primary key
      const verifyPKRequest = pool.request();
      const verifyPKResult = await verifyPKRequest.query(`
        SELECT 
          kc.name AS constraint_name,
          c.name AS column_name
        FROM sys.key_constraints kc
        INNER JOIN sys.index_columns ic ON kc.parent_object_id = ic.object_id AND kc.unique_index_id = ic.index_id
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE kc.parent_object_id = OBJECT_ID('dbo.user_subscriptions')
          AND kc.type = 'PK';
      `);

      console.log('\nPrimary key constraint:');
      if (verifyPKResult.recordset.length > 0) {
        console.table(verifyPKResult.recordset);
        console.log('\n✅ Primary key is correctly set on UserId');
      } else {
        console.log('⚠️ No primary key found - this is unexpected');
      }

      console.log('\n✅ Database schema fixed successfully!');
      console.log('   - Removed SubscriptionRecordId column');
      console.log('   - Ensured UserId is the primary key');
      console.log('   - Kept cancellation_scheduled column (used in code)');

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

fixDatabaseSchema()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });





