/**
 * Simple in-memory cache with TTL and maxSize support
 * 
 * Note: The exerciseCache is no longer used - exercises are fetched on-demand
 * from ExerciseDB API to reduce memory footprint on Azure App Service.
 * This class is kept for potential future use with smaller datasets.
 */

class SimpleCache {
  /**
   * Create a new cache instance
   * @param {number} ttlMs - Time-to-live in milliseconds (default: 24 hours)
   * @param {number} maxSize - Maximum number of entries (default: unlimited)
   */
  constructor(ttlMs = 24 * 60 * 60 * 1000, maxSize = null) {
    this.cache = new Map();
    this.ttl = ttlMs;
    this.maxSize = maxSize;
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
    // If maxSize is set and we're at capacity, evict oldest entry
    if (this.maxSize && this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    
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
   * @returns {Object} - { size, maxSize, keys }
   */
  stats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: Array.from(this.cache.keys())
    };
  }
}

// Pre-configured cache (kept for backwards compatibility, but not actively used)
// Exercise data is now fetched on-demand to reduce memory usage
const exerciseCache = new SimpleCache(24 * 60 * 60 * 1000, 100);

module.exports = { SimpleCache, exerciseCache };
