/**
 * Application Constants
 * Centralized configuration for magic numbers and settings
 */

module.exports = {
    // Rate Limiting
    RATE_LIMIT: {
        WINDOW_MS: 15 * 60 * 1000,  // 15 minutes
        MAX_REQUESTS: 1000,          // Per window
        AUTH_MAX_ATTEMPTS: 10,       // Login attempts per window
    },

    // Traffic Monitoring
    TRAFFIC: {
        HISTORY_RETENTION_POINTS: 2880, // ~24h at 30s interval
        POLL_INTERVAL_MS: 30000,        // 30 seconds
        MAX_REALISTIC_MBPS: 10000,      // 10 Gbps cap
        DISPLAY_POINTS: 100,            // Chart display points
        TIME_GAP_MAX_SECONDS: 300,      // 5 minutes max gap for rate calculation
    },

    // Ping Monitoring
    PING: {
        RETRY_THRESHOLD: 3,             // Failures before considering offline
        HISTORY_RETENTION: 100,         // Last 100 ping results per host
        AUTO_PING_INTERVAL_MS: 30000,   // 30 seconds
    },

    // Data Storage
    STORAGE: {
        MAX_LOGS: 1000,                 // Maximum log entries
        MAX_AUDIT_LOGS: 500,            // Maximum audit log entries
        SESSION_MAX_AGE_DAYS: 7,        // Session expiration
    },

    // Security
    SECURITY: {
        PASSWORD_MIN_LENGTH: 8,
        MAX_HOST_LENGTH: 255,
        FILE_SIZE_LIMIT_MB: 5,
    },

    // UI Refresh
    REFRESH: {
        DASHBOARD_INTERVAL_MS: 30000,   // 30 seconds
        TRAFFIC_CHART_INTERVAL_MS: 5000, // 5 seconds
    },
};
