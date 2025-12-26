/**
 * SNMP Routes Tests
 * Tests for SNMP traffic history API with time filters
 */

const request = require('supertest');
const express = require('express');

// Mock hosts
let mockHosts = [];

// Mock history data
const mockHistoryData = [
    { timestamp: Date.now() - 3600000, traffic_in: 10.5, traffic_out: 5.2 },
    { timestamp: Date.now() - 1800000, traffic_in: 15.3, traffic_out: 8.1 },
    { timestamp: Date.now(), traffic_in: 12.0, traffic_out: 6.5 }
];

// Mock dependencies
const mockDeps = {
    getHosts: jest.fn(() => mockHosts),
    snmpService: {
        getInterfaces: jest.fn(() => Promise.resolve([
            { index: 1, name: 'eth0', description: 'Ethernet' }
        ]))
    },
    databaseService: {
        getTrafficHistoryByTimeRange: jest.fn(() => mockHistoryData)
    },
    middleware: {
        requireAuth: (req, res, next) => next()
    }
};

describe('SNMP Routes', () => {
    let app;

    beforeAll(() => {
        const { createSnmpRoutes } = require('../routes/snmpRoutes');

        app = express();
        app.use(express.json());

        const snmpRouter = createSnmpRoutes(mockDeps);
        app.use('/api/hosts', snmpRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockHosts = [
            { id: 'host-1', name: 'Test Host', host: '192.168.1.1', snmpCommunity: 'public', snmpVersion: '2c' }
        ];
    });

    describe('GET /:id/snmp/history', () => {
        test('should return traffic history with default 24h period', async () => {
            const response = await request(app)
                .get('/api/hosts/host-1/snmp/history')
                .expect(200);

            expect(response.body).toHaveProperty('history');
            expect(response.body).toHaveProperty('stats');
            expect(response.body).toHaveProperty('period', '24h');
            expect(mockDeps.databaseService.getTrafficHistoryByTimeRange).toHaveBeenCalled();
        });

        test('should accept period query parameter', async () => {
            const response = await request(app)
                .get('/api/hosts/host-1/snmp/history?period=1h')
                .expect(200);

            expect(response.body.period).toBe('1h');
        });

        test('should accept from/to query parameters', async () => {
            const from = new Date(Date.now() - 3600000).toISOString();
            const to = new Date().toISOString();

            const response = await request(app)
                .get(`/api/hosts/host-1/snmp/history?from=${from}&to=${to}`)
                .expect(200);

            expect(response.body).toHaveProperty('from');
            expect(response.body).toHaveProperty('to');
        });

        test('should calculate statistics correctly', async () => {
            const response = await request(app)
                .get('/api/hosts/host-1/snmp/history')
                .expect(200);

            const stats = response.body.stats;
            expect(stats).toHaveProperty('inbound');
            expect(stats).toHaveProperty('outbound');
            expect(stats.inbound).toHaveProperty('current');
            expect(stats.inbound).toHaveProperty('average');
            expect(stats.inbound).toHaveProperty('maximum');

            // Verify calculations
            expect(stats.inbound.current).toBe(12.0);
            expect(stats.inbound.maximum).toBe(15.3);
        });

        test('should handle all period values', async () => {
            const periods = ['1h', '6h', '24h', '7d', '30d'];

            for (const period of periods) {
                const response = await request(app)
                    .get(`/api/hosts/host-1/snmp/history?period=${period}`)
                    .expect(200);

                expect(response.body.history).toBeDefined();
            }
        });
    });

    describe('POST /:id/snmp/scan', () => {
        test('should return interfaces for valid host', async () => {
            const response = await request(app)
                .post('/api/hosts/host-1/snmp/scan')
                .send({})
                .expect(200);

            expect(Array.isArray(response.body)).toBe(true);
            expect(mockDeps.snmpService.getInterfaces).toHaveBeenCalled();
        });

        test('should return 404 for non-existent host', async () => {
            mockHosts = []; // Empty hosts

            await request(app)
                .post('/api/hosts/host-1/snmp/scan')
                .send({})
                .expect(404);
        });
    });
});
