/**
 * Transaction Recorder
 * Records subscription lifecycle events in both user_subscriptions and subscription_transactions tables
 */

const { getPool } = require('../config/db');
const mssql = require('mssql');

/**
 * Record a subscription transaction
 * @param {object} transactionData - Transaction details
 * @param {number} transactionData.userId - User ID
 * @param {string} transactionData.subscriptionId - Stripe/Apple subscription ID
 * @param {string} transactionData.type - Transaction type (activation, upgrade, downgrade, pause, resume, cancellation, expiration, renewal)
 * @param {string} transactionData.fromPlan - Previous plan (optional)
 * @param {string} transactionData.toPlan - New plan
 * @param {string} transactionData.billingInterval - Billing interval (monthly, semi_annual, annual)
 * @param {number} transactionData.amount - Transaction amount (optional)
 * @param {string} transactionData.currency - Currency code (default: USD)
 * @param {number} transactionData.prorationAmount - Proration amount (optional)
 * @param {string} transactionData.paymentGateway - Payment gateway (stripe, apple_pay, google_pay)
 * @param {string} transactionData.paymentIntentId - Payment intent ID (optional)
 * @param {string} transactionData.cancellationReason - Cancellation reason (optional)
 * @param {string} transactionData.userFeedback - User feedback (optional)
 * @param {number} transactionData.pauseDurationMonths - Pause duration in months (optional)
 * @param {Date} transactionData.resumeDate - Resume date for paused subscriptions (optional)
 * @returns {Promise<{transactionId: number, success: boolean}>}
 */
async function recordTransaction(transactionData) {
  const pool = getPool();
  
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  
  // Validate required fields
  if (!transactionData.userId) {
    throw new Error('userId is required');
  }
  if (!transactionData.type) {
    throw new Error('transaction type is required');
  }
  if (!transactionData.toPlan) {
    throw new Error('toPlan is required');
  }
  
  // Validate transaction type
  const validTypes = ['activation', 'upgrade', 'downgrade', 'pause', 'resume', 'cancellation', 'expiration', 'renewal'];
  if (!validTypes.includes(transactionData.type)) {
    throw new Error(`Invalid transaction type: ${transactionData.type}. Must be one of: ${validTypes.join(', ')}`);
  }
  
  const transaction = new mssql.Transaction(pool);
  
  try {
    await transaction.begin();
    
    // Step 1: Insert into subscription_transactions table
    const insertRequest = new mssql.Request(transaction);
    insertRequest.input('userId', mssql.Int, parseInt(transactionData.userId, 10));
    insertRequest.input('subscriptionId', mssql.NVarChar(128), transactionData.subscriptionId || null);
    insertRequest.input('transactionType', mssql.NVarChar(32), transactionData.type);
    insertRequest.input('fromPlan', mssql.NVarChar(32), transactionData.fromPlan || null);
    insertRequest.input('toPlan', mssql.NVarChar(32), transactionData.toPlan);
    insertRequest.input('billingInterval', mssql.NVarChar(32), transactionData.billingInterval || null);
    insertRequest.input('amount', mssql.Decimal(10, 2), transactionData.amount || null);
    insertRequest.input('currency', mssql.VarChar(3), transactionData.currency || 'USD');
    insertRequest.input('prorationAmount', mssql.Decimal(10, 2), transactionData.prorationAmount || null);
    insertRequest.input('paymentGateway', mssql.NVarChar(32), transactionData.paymentGateway || null);
    insertRequest.input('paymentIntentId', mssql.NVarChar(128), transactionData.paymentIntentId || null);
    insertRequest.input('cancellationReason', mssql.NVarChar(50), transactionData.cancellationReason || null);
    insertRequest.input('userFeedback', mssql.NVarChar(500), transactionData.userFeedback || null);
    insertRequest.input('pauseDurationMonths', mssql.Int, transactionData.pauseDurationMonths || null);
    insertRequest.input('resumeDate', mssql.DateTimeOffset, transactionData.resumeDate || null);
    
    const insertResult = await insertRequest.query(`
      INSERT INTO [dbo].[subscription_transactions]
      (UserId, subscription_id, transaction_type, from_plan, to_plan, billing_interval,
       amount, currency, proration_amount, payment_gateway, payment_intent_id,
       cancellation_reason, user_feedback, pause_duration_months, resume_date)
      OUTPUT INSERTED.transaction_id
      VALUES (@userId, @subscriptionId, @transactionType, @fromPlan, @toPlan, @billingInterval,
              @amount, @currency, @prorationAmount, @paymentGateway, @paymentIntentId,
              @cancellationReason, @userFeedback, @pauseDurationMonths, @resumeDate)
    `);
    
    const transactionId = insertResult.recordset[0].transaction_id;
    
    // Step 2: Update user_subscriptions with latest transaction info
    const updateRequest = new mssql.Request(transaction);
    updateRequest.input('userId', mssql.Int, parseInt(transactionData.userId, 10));
    updateRequest.input('transactionType', mssql.NVarChar(32), transactionData.type);
    
    await updateRequest.query(`
      UPDATE [dbo].[user_subscriptions]
      SET transaction_type = @transactionType,
          transaction_date = SYSDATETIMEOFFSET(),
          updated_at = SYSDATETIMEOFFSET()
      WHERE UserId = @userId
    `);
    
    // Step 3: Update UserProfile.UserType based on transaction type
    const userTypeUpdate = getUserTypeForTransaction(transactionData.type);
    if (userTypeUpdate) {
      const userProfileRequest = new mssql.Request(transaction);
      userProfileRequest.input('userId', mssql.Int, parseInt(transactionData.userId, 10));
      userProfileRequest.input('userType', mssql.NVarChar(20), userTypeUpdate);
      
      await userProfileRequest.query(`
        UPDATE [dbo].[UserProfile]
        SET UserType = @userType
        WHERE UserID = @userId
      `);
    }
    
    await transaction.commit();
    
    console.log(`✅ Recorded ${transactionData.type} transaction for user ${transactionData.userId} (ID: ${transactionId})`);
    
    return {
      transactionId,
      success: true
    };
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Failed to record transaction:', error.message);
    throw error;
  }
}

/**
 * Determine UserType based on transaction type
 * @param {string} transactionType - Transaction type
 * @returns {string|null} - UserType to set, or null if no change needed
 */
function getUserTypeForTransaction(transactionType) {
  switch (transactionType) {
    case 'activation':
    case 'upgrade':
    case 'downgrade':
    case 'pause':
    case 'resume':
    case 'cancellation':
    case 'renewal':
      return 'Premium'; // User stays Premium for all these
    case 'expiration':
      return 'Free'; // Only expiration reverts to Free
    default:
      return null; // No change
  }
}

/**
 * Get transaction history for a user
 * @param {number} userId - User ID
 * @param {number} months - Number of months of history (default: 12)
 * @returns {Promise<Array>} Array of transaction records
 */
async function getTransactionHistory(userId, months = 12) {
  const pool = getPool();
  
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  
  const result = await pool.request()
    .input('userId', mssql.Int, parseInt(userId, 10))
    .input('monthsAgo', mssql.Int, months)
    .query(`
      SELECT 
        transaction_id,
        subscription_id,
        transaction_type,
        transaction_date,
        from_plan,
        to_plan,
        billing_interval,
        amount,
        currency,
        proration_amount,
        payment_gateway,
        payment_intent_id,
        cancellation_reason,
        user_feedback,
        pause_duration_months,
        resume_date
      FROM [dbo].[subscription_transactions]
      WHERE UserId = @userId
        AND transaction_date >= DATEADD(MONTH, -@monthsAgo, SYSDATETIMEOFFSET())
      ORDER BY transaction_date DESC
    `);
  
  return result.recordset;
}

module.exports = {
  recordTransaction,
  getTransactionHistory,
  getUserTypeForTransaction
};

