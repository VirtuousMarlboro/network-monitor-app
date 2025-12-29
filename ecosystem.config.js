/**
 * PM2 Ecosystem Configuration
 * Production deployment with clustering and monitoring
 */
module.exports = {
    apps: [{
        name: 'network-monitor',
        script: 'server.js',

        // Clustering (not recommended due to SQLite - use single instance)
        // Set to 1 for single-server deployment
        instances: 1,

        // Enable cluster mode only if using external database (PostgreSQL/MySQL)
        // exec_mode: 'cluster',
        exec_mode: 'fork',

        // Auto-restart
        autorestart: true,
        watch: false,
        max_memory_restart: '500M',

        // Environment variables
        env: {
            NODE_ENV: 'development',
            PORT: 3000
        },
        env_production: {
            NODE_ENV: 'production',
            PORT: 3000
        },

        // Logging
        error_file: './logs/pm2-error.log',
        out_file: './logs/pm2-out.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
        merge_logs: true,

        // Graceful reload
        kill_timeout: 5000,
        wait_ready: true,
        listen_timeout: 10000,

        // Health check
        // PM2 will ping /api/live endpoint to check if app is alive
        // Requires pm2-metrics module for advanced monitoring
    }]
};

/**
 * Usage:
 * 
 * Development:
 *   pm2 start ecosystem.config.js
 * 
 * Production:
 *   pm2 start ecosystem.config.js --env production
 * 
 * Monitoring:
 *   pm2 monit
 * 
 * Logs:
 *   pm2 logs network-monitor
 * 
 * Restart:
 *   pm2 restart network-monitor
 * 
 * Stop:
 *   pm2 stop network-monitor
 * 
 * Delete:
 *   pm2 delete network-monitor
 * 
 * Startup (auto-start on boot):
 *   pm2 startup
 *   pm2 save
 */
