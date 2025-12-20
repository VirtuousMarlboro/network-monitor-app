/**
 * Host Management Routes
 * Handles CRUD operations for monitored hosts
 */
const express = require('express');

/**
 * Factory function to create host routes
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getHosts - Get monitoredHosts array
 * @param {Function} deps.getPingHistory - Get pingHistory object
 * @param {Function} deps.saveHosts - Save hosts to file
 * @param {Function} deps.isValidHost - Validate hostname/IP
 * @param {Function} deps.getUsers - Get users array
 * @param {Function} deps.addAuditLog - Add audit log entry
 * @param {Function} deps.broadcastSSE - Broadcast SSE event
 * @param {Object} deps.middleware - { requireAuth }
 * @returns {express.Router}
 */
function createHostRoutes(deps) {
    const router = express.Router();
    const {
        getHosts, getPingHistory, saveHosts, isValidHost,
        getUsers, addAuditLog, broadcastSSE, middleware
    } = deps;

    // GET /api/hosts - Get all monitored hosts
    router.get('/', middleware.requireAuth, (req, res) => {
        res.json(getHosts());
    });

    // POST /api/hosts - Add a new host
    router.post('/', middleware.requireAuth, (req, res) => {
        const {
            host, name, latitude, longitude, cid, groupId,
            snmpEnabled, snmpCommunity, snmpVersion, snmpInterface, snmpInterfaceName
        } = req.body;

        if (!host) {
            return res.status(400).json({ error: 'Host/IP is required' });
        }

        if (!isValidHost(host)) {
            return res.status(400).json({ error: 'Invalid Hostname or IP Address' });
        }

        const hosts = getHosts();

        // Check if name already exists
        if (name && name.trim()) {
            const existingName = hosts.find(h => h.name.toLowerCase() === name.toLowerCase().trim());
            if (existingName) {
                return res.status(400).json({ error: `Nama host '${name}' sudah digunakan (IP: ${existingName.host})` });
            }
        }

        // Check if CID already exists (if provided)
        if (cid && cid.trim()) {
            const existingCid = hosts.find(h => h.cid === cid);
            if (existingCid) {
                return res.status(400).json({ error: `CID '${cid}' already exists for host '${existingCid.name}'` });
            }
        }

        const newHost = {
            id: Date.now().toString(),
            host: host,
            name: name || host,
            cid: cid || null,
            groupId: groupId || null,
            status: 'unknown',
            latency: null,
            lastCheck: null,
            latitude: latitude || null,
            longitude: longitude || null,
            addedAt: new Date().toISOString(),
            snmpEnabled: snmpEnabled || false,
            snmpCommunity: snmpCommunity || 'public',
            snmpVersion: snmpVersion || '2c',
            snmpInterface: snmpInterface || null,
            snmpInterfaceName: snmpInterfaceName || null,
            traffic: null
        };

        hosts.push(newHost);
        const pingHistory = getPingHistory();
        pingHistory[newHost.id] = [];
        saveHosts();

        // Audit log for host creation
        const users = getUsers();
        const user = users.find(u => u.id === req.session?.userId);
        addAuditLog(req.session?.userId || 'system', user?.username || 'anonymous', 'host_add', `Added host: ${newHost.name} (${newHost.host})`, { hostId: newHost.id });

        broadcastSSE('host-added', newHost);
        res.status(201).json(newHost);
    });

    // PUT /api/hosts/:id - Update host details
    router.put('/:id', middleware.requireAuth, (req, res) => {
        const { id } = req.params;
        const {
            name, host, cid, groupId, latitude, longitude,
            snmpEnabled, snmpCommunity, snmpVersion, snmpInterface, snmpInterfaceName
        } = req.body;

        const hosts = getHosts();
        const hostData = hosts.find(h => h.id === id);
        if (!hostData) {
            return res.status(404).json({ error: 'Host not found' });
        }

        // Check if name is being changed to an existing name
        if (name !== undefined && name.trim() && name.toLowerCase().trim() !== hostData.name.toLowerCase()) {
            const existingName = hosts.find(h => h.id !== id && h.name.toLowerCase() === name.toLowerCase().trim());
            if (existingName) {
                return res.status(400).json({ error: `Nama host '${name}' sudah digunakan (IP: ${existingName.host})` });
            }
            hostData.name = name;
        } else if (name !== undefined) {
            hostData.name = name;
        }

        if (host !== undefined && host !== hostData.host) {
            hostData.host = host;
        }

        // Check if CID is being changed to an existing one
        if (cid !== undefined && cid !== hostData.cid) {
            if (cid && cid.trim()) {
                const existingCid = hosts.find(h => h.id !== id && h.cid === cid);
                if (existingCid) {
                    return res.status(400).json({ error: `CID '${cid}' sudah terdaftar untuk host '${existingCid.name}'` });
                }
            }
            hostData.cid = cid;
        }

        if (groupId !== undefined) hostData.groupId = groupId || null;
        if (latitude !== undefined) hostData.latitude = latitude;
        if (longitude !== undefined) hostData.longitude = longitude;
        if (snmpEnabled !== undefined) hostData.snmpEnabled = snmpEnabled;
        if (snmpCommunity !== undefined) hostData.snmpCommunity = snmpCommunity;
        if (snmpVersion !== undefined) hostData.snmpVersion = snmpVersion;
        if (snmpInterface !== undefined) hostData.snmpInterface = snmpInterface;
        if (snmpInterfaceName !== undefined) hostData.snmpInterfaceName = snmpInterfaceName;

        saveHosts();

        // Audit log for host edit
        const users = getUsers();
        const user = users.find(u => u.id === req.session?.userId);
        addAuditLog(req.session?.userId || 'system', user?.username || 'anonymous', 'host_edit', `Edited host: ${hostData.name}`, { hostId: id });

        broadcastSSE('hosts-update', hosts);
        res.json(hostData);
    });

    // PUT /api/hosts/:id/location - Update host location only
    router.put('/:id/location', middleware.requireAuth, (req, res) => {
        const { id } = req.params;
        const { latitude, longitude } = req.body;

        const hosts = getHosts();
        const hostData = hosts.find(h => h.id === id);
        if (!hostData) {
            return res.status(404).json({ error: 'Host not found' });
        }

        hostData.latitude = latitude;
        hostData.longitude = longitude;
        saveHosts();

        broadcastSSE('hosts-update', hosts);
        res.json(hostData);
    });

    // DELETE /api/hosts/:id - Remove a host
    router.delete('/:id', middleware.requireAuth, (req, res) => {
        const { id } = req.params;
        const hosts = getHosts();
        const index = hosts.findIndex(h => h.id === id);

        if (index === -1) {
            return res.status(404).json({ error: 'Host not found' });
        }

        const deleted = hosts.splice(index, 1)[0];
        const pingHistory = getPingHistory();
        delete pingHistory[id];
        saveHosts();

        // Audit log for host deletion
        const users = getUsers();
        const user = users.find(u => u.id === req.session?.userId);
        addAuditLog(req.session?.userId || 'system', user?.username || 'anonymous', 'host_delete', `Deleted host: ${deleted.name}`, { hostId: id });

        broadcastSSE('host-removed', { id });
        res.json({ success: true });
    });

    return router;
}

module.exports = { createHostRoutes };
