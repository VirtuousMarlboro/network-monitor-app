/**
 * Cache Service - Simple in-memory cache with TTL
 * Used for settings, host groups, and other rarely-changing data
 */

class CacheService {
    constructor() {
        this.cache = new Map();
        this.ttl = new Map();
    }

    /**
     * Get value from cache
     * @param {string} key - Cache key
     * @returns {any} Cached value or null if expired/missing
     */
    get(key) {
        const expiry = this.ttl.get(key);
        if (!expiry || Date.now() > expiry) {
            this.cache.delete(key);
            this.ttl.delete(key);
            return null;
        }
        return this.cache.get(key);
    }

    /**
     * Set value in cache with TTL
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttlMs - Time to live in milliseconds (default 5 minutes)
     */
    set(key, value, ttlMs = 300000) {
        this.cache.set(key, value);
        this.ttl.set(key, Date.now() + ttlMs);
    }

    /**
     * Delete specific key from cache
     * @param {string} key - Cache key
     */
    delete(key) {
        this.cache.delete(key);
        this.ttl.delete(key);
    }

    /**
     * Invalidate all keys matching a prefix
     * @param {string} prefix - Key prefix to match
     */
    invalidatePrefix(prefix) {
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.delete(key);
            }
        }
    }

    /**
     * Clear entire cache
     */
    clear() {
        this.cache.clear();
        this.ttl.clear();
    }

    /**
     * Get cache stats
     */
    stats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}

// Singleton instance
const cacheService = new CacheService();

// Cache keys
const CACHE_KEYS = {
    SETTINGS: 'settings',
    HOST_GROUPS: 'host_groups',
    USERS: 'users_list',
    HOSTS: 'hosts_list'
};

// Default TTLs
const TTL = {
    SHORT: 60000,      // 1 minute
    MEDIUM: 300000,    // 5 minutes  
    LONG: 900000,      // 15 minutes
    VERY_LONG: 3600000 // 1 hour
};

module.exports = {
    cacheService,
    CACHE_KEYS,
    TTL
};
