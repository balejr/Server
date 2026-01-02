/**
 * Input Validation Middleware
 * 
 * Uses express-validator to validate and sanitize incoming request data.
 * Provides validation schemas for all data endpoints.
 */

const { body, param, query, validationResult } = require('express-validator');

/**
 * Middleware to check validation results and return errors if any
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    });
  }
  next();
};

// ==================== DAILY LOG VALIDATORS ====================

const dailyLogCreateValidation = [
  body('sleep')
    .optional()
    .isFloat({ min: 0, max: 24 })
    .withMessage('Sleep must be between 0 and 24 hours'),
  body('steps')
    .optional()
    .isInt({ min: 0, max: 200000 })
    .withMessage('Steps must be between 0 and 200,000'),
  body('heartrate')
    .optional()
    .isInt({ min: 20, max: 300 })
    .withMessage('Heart rate must be between 20 and 300 bpm'),
  body('waterIntake')
    .optional()
    .isFloat({ min: 0, max: 20 })
    .withMessage('Water intake must be between 0 and 20 liters'),
  body('sleepQuality')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Sleep quality must be between 1 and 10'),
  body('caloriesBurned')
    .optional()
    .isInt({ min: 0, max: 10000 })
    .withMessage('Calories burned must be between 0 and 10,000'),
  body('restingHeartRate')
    .optional()
    .isInt({ min: 20, max: 200 })
    .withMessage('Resting heart rate must be between 20 and 200 bpm'),
  body('heartrateVariability')
    .optional()
    .isInt({ min: 0, max: 300 })
    .withMessage('HRV must be between 0 and 300 ms'),
  body('weight')
    .optional()
    .isFloat({ min: 20, max: 700 })
    .withMessage('Weight must be between 20 and 700 (lbs or kg)'),
  body('effectiveDate')
    .optional()
    .isISO8601()
    .withMessage('Effective date must be a valid date'),
  validate
];

const dailyLogUpdateValidation = [
  param('logId')
    .isInt({ min: 1 })
    .withMessage('Log ID must be a positive integer'),
  ...dailyLogCreateValidation.slice(0, -1), // Remove the validate middleware
  validate
];

// ==================== EXERCISE EXISTENCE VALIDATORS ====================

const exerciseExistenceCreateValidation = [
  body('exerciseList')
    .isArray({ min: 1 })
    .withMessage('Exercise list must be a non-empty array'),
  body('exerciseList.*.exerciseId')
    .notEmpty()
    .withMessage('Exercise ID is required'),
  body('exerciseList.*.exerciseName')
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage('Exercise name must be under 200 characters'),
  body('exerciseList.*.sets')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Sets must be between 1 and 100'),
  body('exerciseList.*.reps')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Reps must be between 1 and 1,000'),
  body('exerciseList.*.weight')
    .optional()
    .isFloat({ min: 0, max: 2000 })
    .withMessage('Weight must be between 0 and 2,000'),
  body('exerciseList.*.duration')
    .optional()
    .isInt({ min: 0, max: 86400 })
    .withMessage('Duration must be between 0 and 86,400 seconds'),
  body('exerciseList.*.rpe')
    .optional()
    .isFloat({ min: 1, max: 10 })
    .withMessage('RPE must be between 1 and 10'),
  validate
];

const exerciseExistenceUpdateValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Exercise existence ID must be a positive integer'),
  body('Sets')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Sets must be between 1 and 100'),
  body('Reps')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Reps must be between 1 and 1,000'),
  body('Weight')
    .optional()
    .isFloat({ min: 0, max: 2000 })
    .withMessage('Weight must be between 0 and 2,000'),
  body('Duration')
    .optional()
    .isInt({ min: 0, max: 86400 })
    .withMessage('Duration must be between 0 and 86,400 seconds'),
  body('Completed')
    .optional()
    .isBoolean()
    .withMessage('Completed must be a boolean'),
  body('Status')
    .optional()
    .isIn(['not started', 'in progress', 'completed', 'aborted'])
    .withMessage('Status must be: not started, in progress, completed, or aborted'),
  body('RPE')
    .optional()
    .isFloat({ min: 1, max: 10 })
    .withMessage('RPE must be between 1 and 10'),
  body('Notes')
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .withMessage('Notes must be under 1,000 characters'),
  validate
];

// ==================== WORKOUT ROUTINE VALIDATORS ====================

const workoutRoutineCreateValidation = [
  body('workoutName')
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage('Workout name must be under 200 characters'),
  body('exerciseInstances')
    .optional()
    .isString()
    .withMessage('Exercise instances must be a comma-separated string'),
  body('duration')
    .optional()
    .isInt({ min: 0, max: 86400 })
    .withMessage('Duration must be between 0 and 86,400 seconds'),
  body('caloriesBurned')
    .optional()
    .isInt({ min: 0, max: 10000 })
    .withMessage('Calories burned must be between 0 and 10,000'),
  body('intensity')
    .optional()
    .isFloat({ min: 0, max: 10 })
    .withMessage('Intensity must be between 0 and 10'),
  body('load')
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage('Load must be between 0 and 100,000'),
  body('completed')
    .optional()
    .isBoolean()
    .withMessage('Completed must be a boolean'),
  body('workoutRoutineDate')
    .optional()
    .isISO8601()
    .withMessage('Workout date must be a valid date'),
  validate
];

const workoutRoutineUpdateValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Workout routine ID must be a positive integer'),
  ...workoutRoutineCreateValidation.slice(0, -1),
  validate
];

// ==================== MESOCYCLE VALIDATORS ====================

const mesocycleCreateValidation = [
  body('start_date')
    .notEmpty()
    .isISO8601()
    .withMessage('Start date must be a valid date'),
  body('end_date')
    .notEmpty()
    .isISO8601()
    .withMessage('End date must be a valid date'),
  body('is_current')
    .optional()
    .isBoolean()
    .withMessage('is_current must be a boolean'),
  body('created_date')
    .optional()
    .isISO8601()
    .withMessage('Created date must be a valid date'),
  validate
];

const mesocycleUpdateValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Mesocycle ID must be a positive integer'),
  body('start_date')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid date'),
  body('end_date')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid date'),
  body('is_current')
    .optional()
    .isBoolean()
    .withMessage('is_current must be a boolean'),
  validate
];

// ==================== MICROCYCLE VALIDATORS ====================

const microcycleCreateValidation = [
  body('mesocycle_id')
    .notEmpty()
    .isInt({ min: 1 })
    .withMessage('Mesocycle ID must be a positive integer'),
  body('start_date')
    .notEmpty()
    .isISO8601()
    .withMessage('Start date must be a valid date'),
  body('end_date')
    .notEmpty()
    .isISO8601()
    .withMessage('End date must be a valid date'),
  body('is_current')
    .optional()
    .isBoolean()
    .withMessage('is_current must be a boolean'),
  body('created_date')
    .optional()
    .isISO8601()
    .withMessage('Created date must be a valid date'),
  body('week_number')
    .optional()
    .isInt({ min: 1, max: 52 })
    .withMessage('Week number must be between 1 and 52'),
  validate
];

const microcycleUpdateValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Microcycle ID must be a positive integer'),
  body('start_date')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid date'),
  body('end_date')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid date'),
  body('is_current')
    .optional()
    .isBoolean()
    .withMessage('is_current must be a boolean'),
  body('week_number')
    .optional()
    .isInt({ min: 1, max: 52 })
    .withMessage('Week number must be between 1 and 52'),
  validate
];

// ==================== PARAM VALIDATORS ====================

const idParamValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID must be a positive integer'),
  validate
];

const logIdParamValidation = [
  param('logId')
    .isInt({ min: 1 })
    .withMessage('Log ID must be a positive integer'),
  validate
];

const dateParamValidation = [
  param('date')
    .isISO8601()
    .withMessage('Date must be a valid ISO 8601 date'),
  validate
];

module.exports = {
  validate,
  // Daily Log
  dailyLogCreateValidation,
  dailyLogUpdateValidation,
  // Exercise Existence
  exerciseExistenceCreateValidation,
  exerciseExistenceUpdateValidation,
  // Workout Routine
  workoutRoutineCreateValidation,
  workoutRoutineUpdateValidation,
  // Mesocycle
  mesocycleCreateValidation,
  mesocycleUpdateValidation,
  // Microcycle
  microcycleCreateValidation,
  microcycleUpdateValidation,
  // Param validators
  idParamValidation,
  logIdParamValidation,
  dateParamValidation
};

