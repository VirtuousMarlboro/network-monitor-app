/**
 * Auth Routes Tests
 * Tests for authentication endpoints
 */

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

// Mock users
let mockUsers = [];

// Mock dependencies
const mockDeps = {
    getUsers: jest.fn(() => mockUsers),
    saveUsers: jest.fn(),
    addAuditLog: jest.fn(),
    isStrongPassword: jest.fn(() => true),
    getPasswordStrengthError: jest.fn(() => 'Password requires 8+ chars, uppercase, lowercase, number, symbol'),
    middleware: {
        requireAuth: (req, res, next) => {
            if (!req.session || !req.session.userId) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            next();
        }
    }
};

describe('Auth Routes', () => {
    let app;

    beforeAll(() => {
        const { createAuthRoutes } = require('../routes/authRoutes');

        app = express();
        app.use(express.json());
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false
        }));

        const authRouter = createAuthRoutes(mockDeps);
        app.use('/api/auth', authRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset mock users with hashed password
        const hashedPassword = bcrypt.hashSync('correct-password', 10);
        mockUsers = [
            {
                id: 'user-1',
                username: 'admin',
                password: hashedPassword,
                role: 'admin',
                name: 'Admin User',
                mustChangePassword: false
            }
        ];
    });

    describe('POST /login', () => {
        test('should reject non-existent user', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ username: 'nonexistent', password: 'password' })
                .expect(401);

            expect(response.body).toHaveProperty('error');
        });

        test('should reject wrong password', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ username: 'admin', password: 'wrong-password' })
                .expect(401);

            expect(response.body).toHaveProperty('error');
        });

        test('should accept correct credentials', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ username: 'admin', password: 'correct-password' })
                .expect(200);

            expect(response.body).toHaveProperty('username', 'admin');
            expect(response.body).toHaveProperty('role', 'admin');
            expect(mockDeps.addAuditLog).toHaveBeenCalled();
        });
    });

    describe('GET /me', () => {
        test('should return 401 when not authenticated', async () => {
            await request(app)
                .get('/api/auth/me')
                .expect(401);
        });
    });

    describe('POST /logout', () => {
        test('should logout successfully', async () => {
            const response = await request(app)
                .post('/api/auth/logout')
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Logged out');
        });
    });
});
