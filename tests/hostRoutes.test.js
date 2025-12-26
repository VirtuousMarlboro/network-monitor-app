/**
 * Host Routes Tests
 * Tests for host CRUD API endpoints
 */

const request = require('supertest');
const express = require('express');

// Mock host data
let mockHosts = [];

// Mock dependencies
const mockDeps = {
    getHosts: jest.fn(() => mockHosts),
    getPingHistory: jest.fn(() => ({})),
    saveHosts: jest.fn(),
    isValidHost: jest.fn((host) => /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || /^[a-zA-Z0-9.-]+$/.test(host)),
    getUsers: jest.fn(() => [{ id: 'user-1', username: 'admin' }]),
    addAuditLog: jest.fn(),
    broadcastSSE: jest.fn(),
    middleware: {
        requireAuth: (req, res, next) => {
            req.session = { userId: 'user-1' };
            next();
        }
    }
};

describe('Host Routes', () => {
    let app;

    beforeAll(() => {
        const { createHostRoutes } = require('../routes/hostRoutes');

        app = express();
        app.use(express.json());

        const hostRouter = createHostRoutes(mockDeps);
        app.use('/api/hosts', hostRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset mock hosts
        mockHosts = [
            {
                id: 'host-1',
                name: 'Server A',
                host: '192.168.1.1',
                cid: 'CID-001',
                status: 'online',
                latency: 5.2,
                groupId: 'group-1'
            },
            {
                id: 'host-2',
                name: 'Server B',
                host: '192.168.1.2',
                cid: 'CID-002',
                status: 'offline',
                latency: null,
                groupId: 'group-1'
            }
        ];
    });

    describe('GET /', () => {
        test('should return all hosts', async () => {
            const response = await request(app)
                .get('/api/hosts')
                .expect(200);

            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBe(2);
        });

        test('should include host properties', async () => {
            const response = await request(app)
                .get('/api/hosts')
                .expect(200);

            const host = response.body[0];
            expect(host).toHaveProperty('id');
            expect(host).toHaveProperty('name');
            expect(host).toHaveProperty('host');
        });
    });

    describe('POST /', () => {
        test('should reject missing host field', async () => {
            const response = await request(app)
                .post('/api/hosts')
                .send({ name: 'New Server' })
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });

        test('should reject invalid host format', async () => {
            mockDeps.isValidHost.mockReturnValueOnce(false);

            const response = await request(app)
                .post('/api/hosts')
                .send({ host: 'invalid host!!' })
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });

        test('should create host with valid data', async () => {
            const newHost = {
                name: 'New Server',
                host: '192.168.1.100'
            };

            const response = await request(app)
                .post('/api/hosts')
                .send(newHost)
                .expect(201);

            expect(response.body).toHaveProperty('id');
            expect(response.body.name).toBe('New Server');
            expect(mockDeps.saveHosts).toHaveBeenCalled();
            expect(mockDeps.broadcastSSE).toHaveBeenCalledWith('host-added', expect.any(Object));
        });
    });

    describe('PUT /:id', () => {
        test('should update existing host', async () => {
            const updates = { name: 'Updated Server' };

            const response = await request(app)
                .put('/api/hosts/host-1')
                .send(updates)
                .expect(200);

            expect(response.body.name).toBe('Updated Server');
            expect(mockDeps.saveHosts).toHaveBeenCalled();
        });

        test('should return 404 for non-existent host', async () => {
            await request(app)
                .put('/api/hosts/non-existent')
                .send({ name: 'Test' })
                .expect(404);
        });
    });

    describe('DELETE /:id', () => {
        test('should delete existing host', async () => {
            await request(app)
                .delete('/api/hosts/host-1')
                .expect(200);

            expect(mockDeps.saveHosts).toHaveBeenCalled();
            expect(mockDeps.broadcastSSE).toHaveBeenCalledWith('host-removed', { id: 'host-1' });
        });

        test('should return 404 for non-existent host', async () => {
            await request(app)
                .delete('/api/hosts/non-existent')
                .expect(404);
        });
    });
});
