/**
 * Jest E2E Configuration
 * For running Puppeteer tests separately
 */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/e2e.test.js'],
    testTimeout: 30000,
    verbose: true
};
