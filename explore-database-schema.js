require('dotenv').config();
const { connectToDatabase, getPool } = require('./config/db');

async function exploreDatabaseSchema() {
  console.log('🔍 Exploring database schema...\n');
  
  try {
    await connectToDatabase();
    const pool = getPool();
    
    if (!pool) {
      console.error('❌ Database not configured');
      process.exit(1);
    }

    console.log('✅ Connected to database\n');

    // Get all tables
    console.log('📊 Fetching all tables...\n');
    const tablesResult = await pool.request().query(`
      SELECT 
        TABLE_SCHEMA,
        TABLE_NAME,
        TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME;
    `);

    console.log(`Found ${tablesResult.recordset.length} tables:\n`);
    console.table(tablesResult.recordset);

    // For each table, get columns
    for (const table of tablesResult.recordset) {
      const tableName = table.TABLE_NAME;
      console.log(`\n\n${'='.repeat(80)}`);
      console.log(`TABLE: ${tableName}`);
      console.log('='.repeat(80));

      // Get columns
      const columnsResult = await pool.request().query(`
        SELECT 
          COLUMN_NAME,
          DATA_TYPE,
          CHARACTER_MAXIMUM_LENGTH,
          IS_NULLABLE,
          COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${tableName}'
        ORDER BY ORDINAL_POSITION;
      `);

      console.log('\nColumns:');
      console.table(columnsResult.recordset);

      // Get primary keys
      const pkResult = await pool.request().query(`
        SELECT 
          COLUMN_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_NAME = '${tableName}'
          AND CONSTRAINT_NAME LIKE 'PK_%';
      `);

      if (pkResult.recordset.length > 0) {
        console.log('\nPrimary Keys:');
        console.table(pkResult.recordset);
      }

      // Get foreign keys
      const fkResult = await pool.request().query(`
        SELECT 
          fk.name AS FK_Name,
          tp.name AS Parent_Table,
          cp.name AS Parent_Column,
          tr.name AS Referenced_Table,
          cr.name AS Referenced_Column
        FROM sys.foreign_keys fk
        INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
        INNER JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id
        INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        INNER JOIN sys.columns cp ON fkc.parent_column_id = cp.column_id AND fkc.parent_object_id = cp.object_id
        INNER JOIN sys.columns cr ON fkc.referenced_column_id = cr.column_id AND fkc.referenced_object_id = cr.object_id
        WHERE tp.name = '${tableName}';
      `);

      if (fkResult.recordset.length > 0) {
        console.log('\nForeign Keys:');
        console.table(fkResult.recordset);
      }

      // Get indexes
      const indexResult = await pool.request().query(`
        SELECT 
          i.name AS Index_Name,
          i.type_desc AS Index_Type,
          i.is_unique AS Is_Unique
        FROM sys.indexes i
        INNER JOIN sys.tables t ON i.object_id = t.object_id
        WHERE t.name = '${tableName}'
          AND i.name IS NOT NULL;
      `);

      if (indexResult.recordset.length > 0) {
        console.log('\nIndexes:');
        console.table(indexResult.recordset);
      }

      // Get row count
      try {
        const countResult = await pool.request().query(`
          SELECT COUNT(*) as RowCount FROM [dbo].[${tableName}];
        `);
        console.log(`\nRow Count: ${countResult.recordset[0].RowCount}`);
      } catch (e) {
        console.log(`\nRow Count: Unable to retrieve (${e.message})`);
      }
    }

    // Get database info
    console.log('\n\n' + '='.repeat(80));
    console.log('DATABASE INFORMATION');
    console.log('='.repeat(80));

    const dbInfoResult = await pool.request().query(`
      SELECT 
        name AS Database_Name,
        create_date AS Created_Date,
        compatibility_level AS Compatibility_Level
      FROM sys.databases
      WHERE name = DB_NAME();
    `);

    console.log('\nDatabase Info:');
    console.table(dbInfoResult.recordset);

    console.log('\n✅ Schema exploration completed!');
    
  } catch (error) {
    console.error('\n❌ Error exploring schema:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await pool.close();
  }
}

// Run the exploration
exploreDatabaseSchema()
  .then(() => {
    console.log('\n✅ Exploration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Exploration script failed:', error);
    process.exit(1);
  });

