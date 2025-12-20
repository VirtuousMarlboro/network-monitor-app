/**
 * SNMP Routes
 * Handles SNMP interface scanning and traffic history
 */
const express = require('express');

/**
 * Factory function to create SNMP routes
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getHosts - Get hosts array
 * @param {Object} deps.snmpService - SNMP service module
 * @param {Object} deps.databaseService - Database service for traffic history
 * @param {Object} deps.middleware - { requireAuth }
 * @returns {express.Router}
 */
function createSnmpRoutes(deps) {
    const router = express.Router();
    const { getHosts, snmpService, databaseService, middleware } = deps;

    // POST /api/hosts/:id/snmp/scan - Scan for SNMP Interfaces
    router.post('/:id/snmp/scan', middleware.requireAuth, async (req, res) => {
        try {
            const hosts = getHosts();
            const hostData = hosts.find(h => h.id === req.params.id);
            if (!hostData) {
                return res.status(404).json({ error: 'Host not found' });
            }

            // Use provided community/version from body if testing changes, or fallback to saved
            const community = req.body.community || hostData.snmpCommunity || 'public';
            const version = req.body.version || hostData.snmpVersion || '2c';

            console.log(`🔍 Scanning interfaces for ${hostData.name} (${hostData.host})...`);
            const interfaces = await snmpService.getInterfaces(hostData.host, community, version);
            res.json(interfaces);
        } catch (error) {
            console.error('SNMP Scan Error:', error.message);
            res.status(500).json({ error: 'Failed to scan interfaces: ' + error.message });
        }
    });

    // GET /api/hosts/:id/snmp/history - Get SNMP Traffic History (from SQLite)
    router.get('/:id/snmp/history', middleware.requireAuth, (req, res) => {
        const hostId = req.params.id;
        const history = databaseService.getTrafficHistory(hostId, 500);
        res.json({ history });
    });

    return router;
}

module.exports = { createSnmpRoutes };
