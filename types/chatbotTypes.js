/**
 * @fileoverview Type definitions for FitNext Chatbot structured responses
 */

/**
 * @typedef {('GENERAL'|'WORKOUT_CONFIRM'|'WORKOUT_CREATE'|'WORKOUT_MODIFY'|'OUT_OF_SCOPE')} ResponseMode
 */

/**
 * @typedef {('GENERAL'|'WORKOUT_REQUEST'|'WORKOUT_MODIFICATION'|'OUT_OF_SCOPE')} IntentType
 */

/**
 * @typedef {Object} MessageContent
 * @property {string} title - Short heading for the response
 * @property {string} body - Main content of the response
 */

/**
 * @typedef {Object} Exercise
 * @property {string} name - Name of the exercise
 * @property {number} sets - Number of sets
 * @property {string} reps - Number of reps (can be range like "8-12")
 * @property {number} restSec - Rest time in seconds
 * @property {number} rpe - Rate of Perceived Exertion (1-10)
 */

/**
 * @typedef {Object} AccessoryExercise
 * @property {string} name - Name of the exercise
 * @property {number} sets - Number of sets
 * @property {string} reps - Number of reps (can be range like "8-12")
 */

/**
 * @typedef {Object} WorkoutDay
 * @property {number} dayIndex - Day number (1, 2, 3, etc.)
 * @property {string} label - Day label (e.g., "Push", "Pull", "Legs")
 * @property {string[]} warmup - Warm-up exercises
 * @property {Exercise[]} main - Main exercises
 * @property {AccessoryExercise[]} accessories - Accessory exercises
 * @property {string} finisher - Finisher exercise description
 * @property {string[]} cooldown - Cool-down exercises
 */

/**
 * @typedef {Object} WorkoutPlan
 * @property {WorkoutDay[]} days - Array of workout days
 */

/**
 * @typedef {Object} WorkoutSummary
 * @property {string} goal - Fitness goal
 * @property {number} daysPerWeek - Number of workout days per week
 * @property {string} experience - Experience level
 * @property {string[]} equipment - Available equipment
 * @property {string[]} constraints - Any constraints or limitations
 */

/**
 * @typedef {Object} ChatbotPayload
 * @property {string[]} [answer] - Answer points for general questions
 * @property {string} [nextBestAction] - Suggested next action
 * @property {string} [confirmQuestion] - Confirmation question
 * @property {WorkoutSummary} [summary] - Workout plan summary
 * @property {WorkoutPlan} [plan] - Full workout plan
 * @property {string} [referral] - Referral message for out-of-scope
 * @property {string} [whatICanDo] - What the assistant can help with
 */

/**
 * @typedef {Object} StructuredResponse
 * @property {ResponseMode} mode - Response mode
 * @property {IntentType} intent - Detected intent
 * @property {MessageContent} message - Message content
 * @property {ChatbotPayload} payload - Response payload
 * @property {string[]} errors - Any errors
 */

/**
 * @typedef {Object} UsageLimit
 * @property {number} remaining - Remaining queries
 * @property {number} used - Used queries
 * @property {Date} weekStart - Week start date
 */

/**
 * @typedef {Object} ChatResponse
 * @property {boolean} success - Whether the request was successful
 * @property {StructuredResponse} response - Structured AI response
 * @property {number} remaining_queries - Remaining queries for user
 * @property {string} conversation_id - Chat session ID
 */

module.exports = {
  // Export types for JSDoc usage
  ResponseMode: /** @type {ResponseMode} */ (null),
  IntentType: /** @type {IntentType} */ (null),
  MessageContent: /** @type {MessageContent} */ (null),
  Exercise: /** @type {Exercise} */ (null),
  AccessoryExercise: /** @type {AccessoryExercise} */ (null),
  WorkoutDay: /** @type {WorkoutDay} */ (null),
  WorkoutPlan: /** @type {WorkoutPlan} */ (null),
  WorkoutSummary: /** @type {WorkoutSummary} */ (null),
  ChatbotPayload: /** @type {ChatbotPayload} */ (null),
  StructuredResponse: /** @type {StructuredResponse} */ (null),
  UsageLimit: /** @type {UsageLimit} */ (null),
  ChatResponse: /** @type {ChatResponse} */ (null),
};
