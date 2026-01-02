/**
 * API Client Helper
 *
 * Provides a configured axios instance for making API requests
 * with timing, authentication, and error handling.
 */

const axios = require("axios");

// Configuration
const API_BASE_URL =
  process.env.API_BASE_URL || "https://apogeehnp.azurewebsites.net/api";

/**
 * Create an axios instance with default configuration
 */
const createApiClient = () => {
  const instance = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
    },
    validateStatus: () => true, // Don't throw on non-2xx status codes
  });

  return instance;
};

// Shared state for tokens across tests
const state = {
  accessToken: null,
  refreshToken: null,
  userId: null,
  mfaSessionToken: null,
  biometricToken: null,
};

/**
 * Get current authentication state
 */
const getState = () => ({ ...state });

/**
 * Update authentication state
 */
const setState = (newState) => {
  Object.assign(state, newState);
};

/**
 * Clear authentication state
 */
const clearState = () => {
  state.accessToken = null;
  state.refreshToken = null;
  state.userId = null;
  state.mfaSessionToken = null;
  state.biometricToken = null;
};

/**
 * Make an API request with timing
 *
 * @param {string} method - HTTP method (GET, POST, PUT, PATCH, DELETE)
 * @param {string} endpoint - API endpoint (e.g., '/auth/signin')
 * @param {object} data - Request body (for POST, PUT, PATCH)
 * @param {object} headers - Additional headers
 * @returns {Promise<{response: object, duration: number}>}
 */
const request = async (method, endpoint, data = null, headers = {}) => {
  const client = createApiClient();
  const start = Date.now();

  const config = {
    method,
    url: endpoint,
    headers: {
      ...headers,
    },
  };

  if (data) {
    config.data = data;
  }

  const response = await client(config);
  const duration = Date.now() - start;

  return { response, duration };
};

/**
 * Make an authenticated API request
 *
 * @param {string} method - HTTP method
 * @param {string} endpoint - API endpoint
 * @param {object} data - Request body
 * @returns {Promise<{response: object, duration: number}>}
 */
const authRequest = async (method, endpoint, data = null) => {
  if (!state.accessToken) {
    throw new Error("No access token available. Please sign in first.");
  }

  return request(method, endpoint, data, {
    Authorization: `Bearer ${state.accessToken}`,
  });
};

/**
 * Convenience methods for common HTTP verbs
 */
const api = {
  get: (endpoint, headers = {}) => request("GET", endpoint, null, headers),
  post: (endpoint, data, headers = {}) => request("POST", endpoint, data, headers),
  put: (endpoint, data, headers = {}) => request("PUT", endpoint, data, headers),
  patch: (endpoint, data, headers = {}) => request("PATCH", endpoint, data, headers),
  delete: (endpoint, data = {}, headers = {}) => request("DELETE", endpoint, data, headers),

  // Authenticated versions
  auth: {
    get: (endpoint) => authRequest("GET", endpoint),
    post: (endpoint, data) => authRequest("POST", endpoint, data),
    put: (endpoint, data) => authRequest("PUT", endpoint, data),
    patch: (endpoint, data) => authRequest("PATCH", endpoint, data),
    delete: (endpoint, data = {}) => authRequest("DELETE", endpoint, data),
  },
};

module.exports = {
  API_BASE_URL,
  api,
  request,
  authRequest,
  getState,
  setState,
  clearState,
  createApiClient,
};

