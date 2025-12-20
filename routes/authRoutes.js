/**
 * Authentication Routes
 * Handles login, logout, session check, and password change
 */
const express = require('express');
const bcrypt = require('bcryptjs');

/**
 * Factory function to create auth routes
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getUsers - Function to get users array
 * @param {Function} deps.saveUsers - Function to save users
 * @param {Function} deps.addAuditLog - Function to add audit log
 * @param {Function} deps.isStrongPassword - Password validation function
 * @param {Function} deps.getPasswordStrengthError - Error message function
 * @param {Object} deps.middleware - Auth middleware { requireAuth }
 * @returns {express.Router}
 */
function createAuthRoutes(deps) {
    const router = express.Router();
    const { getUsers, saveUsers, addAuditLog, isStrongPassword, getPasswordStrengthError, middleware } = deps;

    // POST /api/login
    router.post('/login', (req, res) => {
        const { username, password } = req.body;
        const users = getUsers();
        const user = users.find(u => u.username === username);

        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // SECURITY: Store both userId and userRole in session
        req.session.userId = user.id;
        req.session.userRole = user.role;

        // Check if user needs to change password
        let mustChangePassword = user.mustChangePassword === true;

        // Auto-flag if property missing
        if (user.mustChangePassword === undefined) {
            user.mustChangePassword = true;
            mustChangePassword = true;
            saveUsers();
        }
        // Re-evaluate password strength on every login
        else if (!isStrongPassword(password) && !mustChangePassword) {
            user.mustChangePassword = true;
            mustChangePassword = true;
            saveUsers();
        }

        // Audit log for login
        addAuditLog(user.id, user.username, 'login', 'User logged in', { ip: req.ip });

        res.json({
            id: user.id,
            username: user.username,
            role: user.role,
            name: user.name,
            mustChangePassword
        });
    });

    // POST /api/logout
    router.post('/logout', (req, res) => {
        // Audit log before session destroy
        if (req.session && req.session.userId) {
            const users = getUsers();
            const user = users.find(u => u.id === req.session.userId);
            addAuditLog(req.session.userId, user?.username || 'unknown', 'logout', 'User logged out', { ip: req.ip });
        }
        req.session.destroy();
        res.json({ message: 'Logged out' });
    });

    // GET /api/me - Get current user
    router.get('/me', (req, res) => {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const users = getUsers();
        const user = users.find(u => u.id === req.session.userId);
        if (!user) return res.status(401).json({ error: 'User not found' });

        res.json({
            id: user.id,
            username: user.username,
            role: user.role,
            name: user.name,
            mustChangePassword: user.mustChangePassword === true
        });
    });

    // PUT /api/change-password
    router.put('/change-password', middleware.requireAuth, (req, res) => {
        const { newPassword, confirmPassword } = req.body;
        const userId = req.session.userId;
        const users = getUsers();

        const user = users.find(u => u.id === userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!newPassword || !confirmPassword) {
            return res.status(400).json({ error: 'Password baru dan konfirmasi wajib diisi' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ error: 'Password baru dan konfirmasi tidak sama' });
        }

        if (!isStrongPassword(newPassword)) {
            return res.status(400).json({ error: getPasswordStrengthError() });
        }

        // Update password and clear the flag
        const salt = bcrypt.genSaltSync(10);
        user.password = bcrypt.hashSync(newPassword, salt);
        user.mustChangePassword = false;

        saveUsers();
        res.json({ message: 'Password berhasil diubah' });
    });

    return router;
}

module.exports = { createAuthRoutes };
