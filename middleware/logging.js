/**
 * Request Logging Middleware
 * Logs API requests for security audit trail
 */

function createLoggingMiddleware(databaseService) {
    return (req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            const userId = req.session?.userId || 'anonymous';

            // Log only API requests (not static files)
            if (req.path.startsWith('/api/')) {
                const logEntry = {
                    timestamp: Date.now(),
                    method: req.method,
                    path: req.path,
                    userId,
                    statusCode: res.statusCode,
                    duration,
                    ip: req.ip || req.connection?.remoteAddress || 'unknown'
                };

                // Store significant requests (POST/PUT/DELETE or errors)
                if (req.method !== 'GET' || res.statusCode >= 400) {
                    try {
                        databaseService.storeAuditLog({
                            timestamp: logEntry.timestamp,
                            userId: logEntry.userId,
                            username: req.session?.username || 'system',
                            action: `${logEntry.method} ${logEntry.path}`,
                            details: { statusCode: logEntry.statusCode, duration: logEntry.duration },
                            ipAddress: logEntry.ip,
                            userAgent: req.headers['user-agent']
                        });
                    } catch (err) {
                        // Don't fail requests if logging fails
                        console.error('Logging error:', err.message);
                    }
                }
            }
        });
        next();
    };
}

module.exports = { createLoggingMiddleware };
