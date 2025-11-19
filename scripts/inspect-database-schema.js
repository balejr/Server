// Temporary script to inspect database schema
// This will be deleted after inspection
const mssql = require('mssql');

const config = {
  user: 'ApogeeDev_UWMJohan',
  password: 'SecurePassword123',
  server: 'apogeehnp.database.windows.net',
  database: 'ApogeeFit',
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

async function inspectSchema() {
  try {
    const pool = await mssql.connect(config);
    console.log('✅ Connected to database\n');

    // Check user_subscriptions table structure
    console.log('=== user_subscriptions TABLE ===');
    const subColumns = await pool.request().query(`
      SELECT 
        COLUMN_NAME, 
        DATA_TYPE, 
        IS_NULLABLE,
        COLUMN_DEFAULT,
        CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'user_subscriptions'
      ORDER BY ORDINAL_POSITION
    `);
    console.table(subColumns.recordset);

    // Check primary key and constraints
    console.log('\n=== user_subscriptions CONSTRAINTS ===');
    const subConstraints = await pool.request().query(`
      SELECT 
        tc.CONSTRAINT_NAME,
        tc.CONSTRAINT_TYPE,
        kcu.COLUMN_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      WHERE tc.TABLE_SCHEMA = 'dbo' 
        AND tc.TABLE_NAME = 'user_subscriptions'
      ORDER BY tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME
    `);
    console.table(subConstraints.recordset);

    // Check foreign keys
    console.log('\n=== user_subscriptions FOREIGN KEYS ===');
    const subFKs = await pool.request().query(`
      SELECT 
        fk.name AS FK_NAME,
        OBJECT_NAME(fk.parent_object_id) AS PARENT_TABLE,
        COL_NAME(fc.parent_object_id, fc.parent_column_id) AS COLUMN_NAME,
        OBJECT_NAME(fk.referenced_object_id) AS REFERENCED_TABLE,
        COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS REFERENCED_COLUMN
      FROM sys.foreign_keys AS fk
      INNER JOIN sys.foreign_key_columns AS fc 
        ON fk.object_id = fc.constraint_object_id
      WHERE OBJECT_NAME(fk.parent_object_id) = 'user_subscriptions'
    `);
    console.table(subFKs.recordset);

    // Check CHECK constraints
    console.log('\n=== user_subscriptions CHECK CONSTRAINTS ===');
    const subChecks = await pool.request().query(`
      SELECT 
        cc.name AS CONSTRAINT_NAME,
        cc.definition AS CHECK_DEFINITION
      FROM sys.check_constraints cc
      WHERE OBJECT_NAME(cc.parent_object_id) = 'user_subscriptions'
    `);
    console.table(subChecks.recordset);

    // Check plans table
    console.log('\n=== plans TABLE ===');
    const plansColumns = await pool.request().query(`
      SELECT 
        COLUMN_NAME, 
        DATA_TYPE, 
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'plans'
      ORDER BY ORDINAL_POSITION
    `);
    console.table(plansColumns.recordset);

    // Check payments table
    console.log('\n=== payments TABLE ===');
    const paymentsColumns = await pool.request().query(`
      SELECT 
        COLUMN_NAME, 
        DATA_TYPE, 
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'payments'
      ORDER BY ORDINAL_POSITION
    `);
    console.table(paymentsColumns.recordset);

    // Check payments foreign keys
    console.log('\n=== payments FOREIGN KEYS ===');
    const paymentsFKs = await pool.request().query(`
      SELECT 
        fk.name AS FK_NAME,
        OBJECT_NAME(fk.parent_object_id) AS PARENT_TABLE,
        COL_NAME(fc.parent_object_id, fc.parent_column_id) AS COLUMN_NAME,
        OBJECT_NAME(fk.referenced_object_id) AS REFERENCED_TABLE,
        COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS REFERENCED_COLUMN
      FROM sys.foreign_keys AS fk
      INNER JOIN sys.foreign_key_columns AS fc 
        ON fk.object_id = fc.constraint_object_id
      WHERE OBJECT_NAME(fk.parent_object_id) = 'payments'
    `);
    console.table(paymentsFKs.recordset);

    // Check payments CHECK constraints
    console.log('\n=== payments CHECK CONSTRAINTS ===');
    const paymentsChecks = await pool.request().query(`
      SELECT 
        cc.name AS CONSTRAINT_NAME,
        cc.definition AS CHECK_DEFINITION
      FROM sys.check_constraints cc
      WHERE OBJECT_NAME(cc.parent_object_id) = 'payments'
    `);
    console.table(paymentsChecks.recordset);

    await pool.close();
    console.log('\n✅ Schema inspection complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

inspectSchema();

