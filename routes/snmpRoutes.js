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
    // Supports query params: period (1h, 6h, 24h, 7d, 30d), from, to (ISO timestamps)
    router.get('/:id/snmp/history', middleware.requireAuth, (req, res) => {
        const hostId = req.params.id;
        const { period, from, to } = req.query;

        // Calculate time range based on period or from/to
        let fromTime, toTime = Date.now();

        if (from && to) {
            // Manual date range
            fromTime = new Date(from).getTime();
            toTime = new Date(to).getTime();
        } else {
            // Preset periods
            const periodMap = {
                '1h': 60 * 60 * 1000,
                '6h': 6 * 60 * 60 * 1000,
                '24h': 24 * 60 * 60 * 1000,
                '7d': 7 * 24 * 60 * 60 * 1000,
                '30d': 30 * 24 * 60 * 60 * 1000
            };
            const duration = periodMap[period] || periodMap['24h']; // Default to 24h
            fromTime = toTime - duration;
        }

        // Get filtered traffic history
        const history = databaseService.getTrafficHistoryByTimeRange(hostId, fromTime, toTime);

        // Calculate statistics
        let stats = {
            inbound: { current: 0, average: 0, maximum: 0 },
            outbound: { current: 0, average: 0, maximum: 0 }
        };

        if (history.length > 0) {
            const inValues = history.map(h => h.traffic_in || 0);
            const outValues = history.map(h => h.traffic_out || 0);

            stats.inbound.current = inValues[inValues.length - 1];
            stats.inbound.average = inValues.reduce((a, b) => a + b, 0) / inValues.length;
            stats.inbound.maximum = Math.max(...inValues);

            stats.outbound.current = outValues[outValues.length - 1];
            stats.outbound.average = outValues.reduce((a, b) => a + b, 0) / outValues.length;
            stats.outbound.maximum = Math.max(...outValues);
        }

        res.json({
            history,
            stats,
            period: period || '24h',
            from: new Date(fromTime).toISOString(),
            to: new Date(toTime).toISOString()
        });
    });

    return router;
}

module.exports = { createSnmpRoutes };
