/**
 * Database Service Tests
 * Tests for traffic history, host CRUD, and user operations
 */

// Mock the database before requiring the service
jest.mock('better-sqlite3', () => {
    const mockDb = {
        pragma: jest.fn(),
        exec: jest.fn(),
        prepare: jest.fn(() => ({
            run: jest.fn(),
            get: jest.fn(),
            all: jest.fn(() => [])
        })),
        transaction: jest.fn(fn => fn)
    };
    return jest.fn(() => mockDb);
});

describe('Database Service', () => {
    let databaseService;

    beforeAll(() => {
        // Require after mocking
        databaseService = require('../services/databaseService');
    });

    describe('Traffic History', () => {
        test('getTrafficHistory should return array', () => {
            const history = databaseService.getTrafficHistory('test-host-id', 100);
            expect(Array.isArray(history)).toBe(true);
        });

        test('getTrafficHistoryByTimeRange should accept time parameters', () => {
            const now = Date.now();
            const oneDayAgo = now - (24 * 60 * 60 * 1000);
            const history = databaseService.getTrafficHistoryByTimeRange('test-host-id', oneDayAgo, now);
            expect(Array.isArray(history)).toBe(true);
        });

        test('storeTrafficEntry should not throw', () => {
            expect(() => {
                databaseService.storeTrafficEntry('test-host-id', {
                    timestamp: Date.now(),
                    inOctets: 1000,
                    outOctets: 500,
                    traffic_in: 10.5,
                    traffic_out: 5.2
                });
            }).not.toThrow();
        });
    });

    describe('Host Operations', () => {
        test('getAllHosts should return array', () => {
            const hosts = databaseService.getAllHosts();
            expect(Array.isArray(hosts)).toBe(true);
        });

        test('getHostById should handle null result', () => {
            const host = databaseService.getHostById('non-existent-id');
            // Should return null or undefined for non-existent host
            expect(host === null || host === undefined).toBe(true);
        });
    });

    describe('User Operations', () => {
        test('getAllUsers should return array', () => {
            const users = databaseService.getAllUsers();
            expect(Array.isArray(users)).toBe(true);
        });

        test('getUserByUsername should handle non-existent user', () => {
            const user = databaseService.getUserByUsername('non-existent-user');
            expect(user === null || user === undefined).toBe(true);
        });
    });

    describe('Settings', () => {
        test('getSetting should handle non-existent key', () => {
            const setting = databaseService.getSetting('non-existent-key');
            expect(setting).toBeNull();
        });
    });
});
