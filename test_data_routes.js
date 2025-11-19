
require('dotenv').config();
try {
  console.log('Attempting to require ./routes/dataRoutes.js...');
  const dataRoutes = require('./routes/dataRoutes');
  console.log('✅ Successfully required dataRoutes.js');
} catch (error) {
  console.error('❌ Failed to require dataRoutes.js:', error);
  process.exit(1);
}

