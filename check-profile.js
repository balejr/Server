require('dotenv').config();
const { connectToDatabase, getPool } = require('./config/db');

(async () => {
  await connectToDatabase();
  const pool = getPool();
  const r = await pool.request()
    .input('u', 66)
    .query('SELECT DOB, Height, Weight, Goals FROM dbo.UserProfile WHERE UserID = @u');
  console.log('Profile:', JSON.stringify(r.recordset[0], null, 2));
  process.exit(0);
})();




