/**
 * Simple in-memory cache with TTL support
 * Used for caching expensive API calls like ExerciseDB
 */

class SimpleCache {
  /**
   * Create a new cache instance
   * @param {number} ttlMs - Time-to-live in milliseconds (default: 24 hours)
   */
  constructor(ttlMs = 24 * 60 * 60 * 1000) {
    this.cache = new Map();
    this.ttl = ttlMs;
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {*} - Cached data or null if expired/missing
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   */
  set(key, data) {
    this.cache.set(key, { 
      data, 
      expiry: Date.now() + this.ttl 
    });
  }

  /**
   * Check if key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Invalidate a specific cache key
   * @param {string} key - Cache key to invalidate
   */
  invalidate(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} - { size, keys }
   */
  stats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

// Pre-configured cache for ExerciseDB API responses (24h TTL)
const exerciseCache = new SimpleCache(24 * 60 * 60 * 1000);

module.exports = { SimpleCache, exerciseCache };

