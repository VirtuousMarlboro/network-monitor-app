/**
 * User Management Routes
 * Handles CRUD operations for users and profile updates
 */
const express = require('express');
const bcrypt = require('bcryptjs');

/**
 * Factory function to create user routes
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getUsers - Function to get users array
 * @param {Function} deps.setUsers - Function to set users array (for delete)
 * @param {Function} deps.saveUsers - Function to save users
 * @param {Function} deps.isStrongPassword - Password validation function
 * @param {Function} deps.getPasswordStrengthError - Error message function
 * @param {Object} deps.middleware - { requireAuth, requireAdmin }
 * @returns {express.Router}
 */
function createUserRoutes(deps) {
    const router = express.Router();
    const { getUsers, setUsers, saveUsers, isStrongPassword, getPasswordStrengthError, middleware } = deps;

    // GET /api/users - List all users (Admin only)
    router.get('/', middleware.requireAdmin, (req, res) => {
        const users = getUsers();
        const safeUsers = users.map(u => ({ id: u.id, username: u.username, role: u.role, name: u.name }));
        res.json(safeUsers);
    });

    // GET /api/users/list - Minimal user list for PIC dropdown (All authenticated)
    router.get('/list', middleware.requireAuth, (req, res) => {
        const users = getUsers();
        const safeUsers = users.map(u => ({ id: u.id, name: u.name || u.username, username: u.username }));
        res.json(safeUsers);
    });

    // POST /api/users - Create new user (Admin only)
    router.post('/', middleware.requireAdmin, (req, res) => {
        const { username, password, role, name } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const users = getUsers();
        if (users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(password, salt);
        const newUser = {
            id: Date.now().toString(),
            username,
            password: hash,
            role: role || 'user',
            name: name || username,
            mustChangePassword: true // Force password change on first login
        };
        users.push(newUser);
        saveUsers();
        res.json({ id: newUser.id, username: newUser.username, role: newUser.role, name: newUser.name });
    });

    // PUT /api/users/:id - Update user (Admin only)
    router.put('/:id', middleware.requireAdmin, (req, res) => {
        const { id } = req.params;
        const { username, password, role, name } = req.body;
        const users = getUsers();

        const user = users.find(u => u.id === id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Validate unique username if changed
        if (username && username !== user.username) {
            if (users.find(u => u.username === username)) {
                return res.status(400).json({ error: 'Username already exists' });
            }
            user.username = username;
        }

        if (name) user.name = name;
        if (role) user.role = role;

        // Only update password if provided
        if (password && password.trim() !== '') {
            const salt = bcrypt.genSaltSync(10);
            user.password = bcrypt.hashSync(password, salt);
        }

        saveUsers();
        res.json({ id: user.id, username: user.username, role: user.role, name: user.name });
    });

    // DELETE /api/users/:id - Delete user (Admin only)
    router.delete('/:id', middleware.requireAdmin, (req, res) => {
        const { id } = req.params;
        let users = getUsers();

        // SECURITY: Protect superadmin by username
        const userToDelete = users.find(u => u.id === id);
        if (userToDelete && userToDelete.username === 'admin') {
            return res.status(403).json({ error: 'Cannot delete superadmin' });
        }

        const initialLength = users.length;
        users = users.filter(u => u.id !== id);
        if (users.length === initialLength) {
            return res.status(404).json({ error: 'User not found' });
        }

        setUsers(users);
        saveUsers();
        res.json({ message: 'User deleted' });
    });

    // PUT /api/profile - Update own profile (All authenticated)
    router.put('/profile', middleware.requireAuth, (req, res) => {
        const { username, password, name } = req.body;
        const userId = req.session.userId;
        const users = getUsers();

        const user = users.find(u => u.id === userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Validate unique username if changed
        if (username && username !== user.username) {
            if (users.find(u => u.username === username)) {
                return res.status(400).json({ error: 'Username already exists' });
            }
            user.username = username;
        }

        if (name) user.name = name;

        // Only update password if provided
        if (password && password.trim() !== '') {
            if (!isStrongPassword(password)) {
                return res.status(400).json({ error: getPasswordStrengthError() });
            }
            const salt = bcrypt.genSaltSync(10);
            user.password = bcrypt.hashSync(password, salt);
        }

        saveUsers();
        res.json({ id: user.id, username: user.username, role: user.role, name: user.name });
    });

    return router;
}

module.exports = { createUserRoutes };
