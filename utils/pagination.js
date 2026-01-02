/**
 * Pagination utility for list endpoints
 * Provides consistent pagination across all GET endpoints returning lists
 */

/**
 * Extract and validate pagination parameters from request
 * @param {Object} req - Express request object
 * @returns {Object} - { page, limit, offset }
 */
const paginate = (req) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

/**
 * Build a standardized paginated response
 * @param {Array} data - The data array for current page
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @param {number} total - Total count of items
 * @returns {Object} - Paginated response object
 */
const paginatedResponse = (data, page, limit, total) => ({
  data,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasMore: page * limit < total
  }
});

module.exports = { paginate, paginatedResponse };

