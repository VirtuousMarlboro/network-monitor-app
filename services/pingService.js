/**
 * Ping Service - Network host monitoring
 * Extracted from server.js for better modularity
 */

const ping = require('ping');

// ========================================
// Configuration
// ========================================
const DEFAULT_CONFIG = {
    timeout: 10,           // Seconds to wait for ping response
    attempts: 3,           // Number of ping attempts
    pingArgs: ['-n', '1']  // Windows-specific: send 1 ping
};

let config = { ...DEFAULT_CONFIG };

/**
 * Update ping configuration
 * @param {Object} newConfig - Partial config to merge
 */
function configure(newConfig) {
    config = { ...config, ...newConfig };
}

// ========================================
// Host Validation (Security)
// ========================================
/**
 * Validate hostname/IP to prevent command injection
 * @param {string} host - Hostname or IP to validate
 * @returns {boolean}
 */
function isValidHost(host) {
    if (!host || typeof host !== 'string') return false;

    // Allow IP addresses (v4) and valid domain names / hostnames
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    const domainRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    // Check length to prevent buffer overflows
    if (host.length > 255) return false;

    return ipRegex.test(host) || domainRegex.test(host);
}

// ========================================
// Single Ping (Internal)
// ========================================
/**
 * Execute a single ping attempt
 * @param {string} host - Hostname or IP
 * @returns {Promise<Object>} Ping result
 */
async function singlePing(host) {
    try {
        const result = await ping.promise.probe(host, {
            timeout: config.timeout,
            extra: config.pingArgs
        });

        return {
            host: host,
            alive: result.alive,
            time: result.time === 'unknown' ? null : parseFloat(result.time),
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            host: host,
            alive: false,
            time: null,
            timestamp: new Date().toISOString(),
            error: error.message
        };
    }
}

// ========================================
// Multi-Attempt Ping (Primary)
// ========================================
/**
 * Ping host with multiple attempts for reliability
 * Host is considered ONLINE if ANY attempt succeeds
 * @param {string} host - Hostname or IP
 * @returns {Promise<Object>} Ping result
 */
async function pingHost(host) {
    // SECURITY: Prevent Command Injection
    if (!isValidHost(host)) {
        return {
            host: host,
            alive: false,
            time: null,
            timestamp: new Date().toISOString(),
            error: 'Invalid Hostname/IP'
        };
    }

    // Try up to attempts times - success on ANY attempt = online
    let lastResult = null;
    let bestLatency = null;

    for (let attempt = 1; attempt <= config.attempts; attempt++) {
        const result = await singlePing(host);
        lastResult = result;

        if (result.alive) {
            // Success! Return immediately
            console.log(`[PING] ${host}: SUCCESS on attempt ${attempt}/${config.attempts} (${result.time}ms)`);
            return result;
        }

        // Track latency even for failed attempts if we got a response
        if (result.time !== null && (bestLatency === null || result.time < bestLatency)) {
            bestLatency = result.time;
        }
    }

    // All attempts failed
    console.log(`[PING] ${host}: FAILED all ${config.attempts} attempts`);
    return {
        host: host,
        alive: false,
        time: bestLatency,
        timestamp: new Date().toISOString(),
        attempts: config.attempts
    };
}

// ========================================
// Quick Ping (Single Attempt)
// ========================================
/**
 * Quick ping for user-initiated checks
 * @param {string} host - Hostname or IP
 * @returns {Promise<Object>} Ping result
 */
async function quickPing(host) {
    if (!isValidHost(host)) {
        return {
            host: host,
            alive: false,
            time: null,
            timestamp: new Date().toISOString(),
            error: 'Invalid Hostname/IP'
        };
    }

    return await singlePing(host);
}

// ========================================
// Exports
// ========================================
module.exports = {
    // Configuration
    configure,
    getConfig: () => ({ ...config }),

    // Validation
    isValidHost,

    // Ping functions
    singlePing,
    pingHost,
    quickPing,

    // Constants (for reference)
    DEFAULT_CONFIG
};
