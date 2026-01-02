/**
 * Query Builder Utility
 * 
 * Provides whitelist-based field validation for dynamic UPDATE queries.
 * Prevents SQL injection by only allowing pre-defined column names.
 */

const logger = require('./logger');

/**
 * Allowed fields per table - only these columns can be updated via PATCH endpoints
 * Column names should match the exact database column names (case-sensitive for some DBs)
 */
const ALLOWED_FIELDS = {
  DailyLogs: [
    'Sleep',
    'Steps',
    'Heartrate',
    'WaterIntake',
    'SleepQuality',
    'CaloriesBurned',
    'RestingHeartrate',
    'HeartrateVariability',
    'Weight',
    'EffectiveDate'
  ],
  
  ExerciseExistence: [
    'ExerciseID',
    'ExerciseName',
    'Sets',
    'Reps',
    'Weight',
    'Duration',
    'Completed',
    'Status',
    'Notes',
    'RPE',
    'RestTime',
    'Date',
    'TargetMuscle',
    'Equipment',
    'GifUrl'
  ],
  
  WorkoutRoutine: [
    'WorkoutName',
    'ExerciseInstances',
    'Equipment',
    'Duration',
    'CaloriesBurned',
    'Intensity',
    'Load',
    'DurationLeft',
    'Completed',
    'WorkoutRoutineDate'
  ],
  
  Mesocycles: [
    'start_date',
    'end_date',
    'is_current',
    'created_date'
  ],
  
  Microcycles: [
    'mesocycle_id',
    'start_date',
    'end_date',
    'is_current',
    'created_date',
    'week_number'
  ]
};

/**
 * Filters request body fields against the allowed whitelist for a table
 * 
 * @param {string} tableName - The database table name (must match key in ALLOWED_FIELDS)
 * @param {Object} fields - The fields from request body to filter
 * @returns {Object} - { valid: boolean, safeFields: Object, rejectedFields: string[] }
 */
const filterFields = (tableName, fields) => {
  const allowedList = ALLOWED_FIELDS[tableName];
  
  if (!allowedList) {
    logger.error(`Unknown table name in queryBuilder: ${tableName}`);
    return { valid: false, safeFields: {}, rejectedFields: Object.keys(fields) };
  }
  
  const safeFields = {};
  const rejectedFields = [];
  
  // Case-insensitive matching for flexibility
  const allowedLower = allowedList.map(f => f.toLowerCase());
  
  for (const [key, value] of Object.entries(fields)) {
    const keyLower = key.toLowerCase();
    const matchIndex = allowedLower.indexOf(keyLower);
    
    if (matchIndex !== -1) {
      // Use the correct casing from the whitelist
      safeFields[allowedList[matchIndex]] = value;
    } else {
      rejectedFields.push(key);
    }
  }
  
  if (rejectedFields.length > 0) {
    logger.warn(`Rejected fields for ${tableName}:`, rejectedFields);
  }
  
  return {
    valid: Object.keys(safeFields).length > 0,
    safeFields,
    rejectedFields
  };
};

/**
 * Builds a parameterized UPDATE query with whitelisted fields
 * 
 * @param {string} tableName - The database table name
 * @param {Object} fields - The fields from request body
 * @param {Object} request - The mssql request object to add inputs to
 * @returns {Object} - { success: boolean, updateClause: string, error?: string }
 */
const buildUpdateQuery = (tableName, fields, request) => {
  const { valid, safeFields, rejectedFields } = filterFields(tableName, fields);
  
  if (!valid) {
    return {
      success: false,
      updateClause: '',
      error: `No valid fields to update. Rejected: ${rejectedFields.join(', ')}`
    };
  }
  
  const setClauses = [];
  
  for (const [column, value] of Object.entries(safeFields)) {
    // Use a safe parameter name (column name with prefix to avoid conflicts)
    const paramName = `upd_${column}`;
    request.input(paramName, value);
    setClauses.push(`${column} = @${paramName}`);
  }
  
  return {
    success: true,
    updateClause: setClauses.join(', '),
    safeFields,
    rejectedFields
  };
};

/**
 * Validates that all provided fields are in the whitelist (strict mode)
 * Returns error if ANY field is not allowed
 * 
 * @param {string} tableName - The database table name
 * @param {Object} fields - The fields to validate
 * @returns {Object} - { valid: boolean, error?: string }
 */
const validateFieldsStrict = (tableName, fields) => {
  const { rejectedFields } = filterFields(tableName, fields);
  
  if (rejectedFields.length > 0) {
    return {
      valid: false,
      error: `Invalid fields: ${rejectedFields.join(', ')}`
    };
  }
  
  return { valid: true };
};

module.exports = {
  ALLOWED_FIELDS,
  filterFields,
  buildUpdateQuery,
  validateFieldsStrict
};

