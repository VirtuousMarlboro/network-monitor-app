/**
 * Authentication Middleware
 * Extracted from server.js for modularity
 */

/**
 * Factory function to create auth middleware
 * @param {Function} getUsers - Function that returns the users array
 * @returns {Object} Auth middleware functions
 */
function createAuthMiddleware(getUsers) {
    /**
     * Require authenticated session
     */
    const requireAuth = (req, res, next) => {
        if (req.session && req.session.userId) {
            return next();
        }
        return res.status(401).json({ error: 'Unauthorized' });
    };

    /**
     * Require admin role
     */
    const requireAdmin = (req, res, next) => {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        // SECURITY: Check session role first (faster), fallback to user lookup
        if (req.session.userRole === 'admin') {
            return next();
        }
        // Fallback: lookup user if session role not set (legacy sessions)
        const users = getUsers();
        const user = users.find(u => u.id === req.session.userId);
        if (user && user.role === 'admin') {
            return next();
        }
        return res.status(403).json({ error: 'Forbidden' });
    };

    /**
     * SECURITY: Block all API access if user must change password
     */
    const requirePasswordChanged = (req, res, next) => {
        // Allow these endpoints even if password change is required
        // NOTE: Paths are relative to /api since middleware is mounted there
        const allowedPaths = ['/me', '/change-password', '/logout', '/login', '/events', '/host-groups', '/hosts/export', '/hosts/import', '/audit-logs'];

        if (allowedPaths.some(path => req.path === path || req.path.startsWith(path))) {
            return next();
        }

        if (!req.session || !req.session.userId) {
            return next(); // Not logged in, let other middleware handle
        }

        const users = getUsers();
        const user = users.find(u => u.id === req.session.userId);
        if (user && user.mustChangePassword === true) {
            return res.status(403).json({
                error: 'Anda harus mengganti password terlebih dahulu',
                mustChangePassword: true
            });
        }

        return next();
    };

    return {
        requireAuth,
        requireAdmin,
        requirePasswordChanged
    };
}

module.exports = { createAuthMiddleware };
