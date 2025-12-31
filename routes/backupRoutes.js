/**
 * Backup Routes
 * Handles config backup operations via SSH
 */
const express = require('express');

/**
 * Factory function to create backup routes
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getHosts - Get hosts array
 * @param {Object} deps.databaseService - Database service
 * @param {Object} deps.configBackupService - Config backup service
 * @param {Object} deps.middleware - { requireAuth, requireAdmin }
 * @returns {express.Router}
 */
function createBackupRoutes(deps) {
    const router = express.Router();
    const { getHosts, databaseService, configBackupService, middleware } = deps;

    // POST /api/hosts/:id/backup - Trigger manual backup
    router.post('/:id/backup', middleware.requireAuth, async (req, res) => {
        try {
            const hosts = getHosts();
            const host = hosts.find(h => h.id === req.params.id);

            if (!host) {
                return res.status(404).json({ error: 'Host not found' });
            }

            // Check if backup is enabled and configured
            if (!host.backupEnabled) {
                return res.status(400).json({ error: 'Backup not enabled for this host' });
            }

            if (!host.backupCredentials) {
                return res.status(400).json({ error: 'Backup credentials not configured' });
            }

            // Decrypt credentials
            let credentials;
            try {
                credentials = configBackupService.decryptCredentials(host.backupCredentials);
                console.log(`[Backup] Credentials decrypted: username=${credentials.username}, port=${credentials.port}, hasPassword=${!!credentials.password}`);
            } catch (err) {
                console.error(`[Backup] Failed to decrypt credentials:`, err.message);
                return res.status(500).json({ error: 'Failed to decrypt credentials' });
            }

            console.log(`[Backup] Starting backup for ${host.name} (${host.backupVendor}, method: ${host.backupMethod || 'ssh'})`);

            let configContent;

            // Choose backup method based on vendor and configured method
            if (host.backupVendor === 'fortigate' && host.backupMethod === 'https') {
                // FortiGate HTTPS backup via REST API
                if (!credentials.apiToken) {
                    return res.status(400).json({ error: 'API Token required for HTTPS backup' });
                }

                configContent = await configBackupService.backupViaHttps({
                    host: host.host,
                    port: credentials.port || 443,
                    apiToken: credentials.apiToken,
                    timeout: 60000
                });
            } else {
                // SSH backup (default for MikroTik and FortiGate SSH)
                configContent = await configBackupService.backupViaSsh({
                    host: host.host,
                    port: credentials.port || 22,
                    username: credentials.username,
                    password: credentials.password,
                    vendor: host.backupVendor,
                    timeout: 60000
                });
            }

            // Save encrypted config
            const { filename, sizeBytes } = configBackupService.saveEncryptedConfig(
                host.id,
                configContent,
                'manual'
            );

            // Store in database
            const dbResult = databaseService.storeConfigBackup(
                host.id,
                filename,
                host.backupVendor,
                sizeBytes,
                'manual'
            );

            console.log(`[Backup] ✅ Backup completed for ${host.name}: ${filename} (${sizeBytes} bytes)`);

            res.json({
                success: true,
                backup: {
                    id: dbResult.id,
                    filename,
                    sizeBytes,
                    vendor: host.backupVendor,
                    createdAt: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('[Backup] Error:', error.message);
            res.status(500).json({ error: 'Backup failed: ' + error.message });
        }
    });

    // GET /api/hosts/:id/backups - List backup history
    router.get('/:id/backups', middleware.requireAuth, (req, res) => {
        const hostId = req.params.id;
        const limit = parseInt(req.query.limit) || 50;

        const backups = databaseService.getConfigBackups(hostId, limit);

        res.json({
            backups: backups.map(b => ({
                id: b.id,
                filename: b.filename,
                vendor: b.vendor,
                sizeBytes: b.size_bytes,
                backupType: b.backup_type,
                createdAt: new Date(b.created_at).toISOString()
            }))
        });
    });

    // GET /api/backups/:id/download - Download decrypted config
    router.get('/download/:id', middleware.requireAuth, (req, res) => {
        try {
            const backup = databaseService.getConfigBackupById(req.params.id);

            if (!backup) {
                return res.status(404).json({ error: 'Backup not found' });
            }

            // Decrypt and return config
            const configContent = configBackupService.loadDecryptedConfig(
                backup.host_id,
                backup.filename
            );

            // Set filename for download
            const downloadName = backup.filename.replace('.enc', '.txt');
            res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
            res.setHeader('Content-Type', 'text/plain');
            res.send(configContent);

        } catch (error) {
            console.error('[Backup Download] Error:', error.message);
            res.status(500).json({ error: 'Download failed: ' + error.message });
        }
    });

    // DELETE /api/backups/:id - Delete backup
    router.delete('/delete/:id', middleware.requireAdmin, (req, res) => {
        try {
            const backup = databaseService.getConfigBackupById(req.params.id);

            if (!backup) {
                return res.status(404).json({ error: 'Backup not found' });
            }

            // Delete file from filesystem
            configBackupService.deleteBackupFile(backup.host_id, backup.filename);

            // Delete from database
            databaseService.deleteConfigBackup(backup.id);

            res.json({ success: true, message: 'Backup deleted' });

        } catch (error) {
            console.error('[Backup Delete] Error:', error.message);
            res.status(500).json({ error: 'Delete failed: ' + error.message });
        }
    });

    // POST /api/hosts/:id/backup/config - Save backup configuration
    router.post('/:id/backup/config', middleware.requireAdmin, (req, res) => {
        try {
            const hosts = getHosts();
            const hostIndex = hosts.findIndex(h => h.id === req.params.id);

            if (hostIndex === -1) {
                return res.status(404).json({ error: 'Host not found' });
            }

            const { enabled, vendor, method, port, username, password, apiToken } = req.body;
            const host = hosts[hostIndex];
            const backupMethod = method || 'ssh'; // Default to SSH

            // Determine credentials to use based on method
            let credentialsToSave;

            if (vendor === 'fortigate' && backupMethod === 'https') {
                // HTTPS method requires API token
                if (apiToken && apiToken.trim() !== '') {
                    credentialsToSave = configBackupService.encryptCredentials({
                        port: port || 443,
                        apiToken: apiToken
                    });
                } else if (host.backupCredentials && host.backupMethod === 'https') {
                    // Preserve existing API token
                    try {
                        const existingCreds = configBackupService.decryptCredentials(host.backupCredentials);
                        credentialsToSave = configBackupService.encryptCredentials({
                            port: port || existingCreds.port || 443,
                            apiToken: existingCreds.apiToken
                        });
                    } catch (e) {
                        return res.status(400).json({ error: 'API Token is required (existing credentials invalid)' });
                    }
                } else if (enabled) {
                    return res.status(400).json({ error: 'API Token is required for HTTPS backup' });
                } else {
                    credentialsToSave = null;
                }
            } else {
                // SSH method requires username/password
                if (password && password.trim() !== '') {
                    // New password provided, encrypt new credentials
                    credentialsToSave = configBackupService.encryptCredentials({
                        port: port || 22,
                        username,
                        password
                    });
                } else if (host.backupCredentials) {
                    // No new password, preserve existing credentials but update port/username
                    try {
                        const existingCreds = configBackupService.decryptCredentials(host.backupCredentials);
                        credentialsToSave = configBackupService.encryptCredentials({
                            port: port || existingCreds.port || 22,
                            username: username || existingCreds.username,
                            password: existingCreds.password // Keep existing password
                        });
                    } catch (e) {
                        // If decryption fails, require new password
                        return res.status(400).json({ error: 'Password is required (existing credentials invalid)' });
                    }
                } else if (enabled) {
                    // Enabling backup requires credentials
                    return res.status(400).json({ error: 'Password is required when enabling backup' });
                } else {
                    // Disabling backup, no credentials needed
                    credentialsToSave = null;
                }
            }

            // Update host
            host.backupEnabled = enabled;
            host.backupVendor = vendor;
            host.backupMethod = backupMethod;
            if (credentialsToSave !== null) {
                host.backupCredentials = credentialsToSave;
            }

            // Update in database
            const updateData = {
                backupEnabled: enabled ? 1 : 0,
                backupVendor: vendor,
                backupMethod: backupMethod
            };
            if (credentialsToSave !== null) {
                updateData.backupCredentials = credentialsToSave;
            }
            databaseService.updateHost(host.id, updateData);

            res.json({ success: true, message: 'Backup configuration saved' });

        } catch (error) {
            console.error('[Backup Config] Error:', error.message);
            res.status(500).json({ error: 'Failed to save config: ' + error.message });
        }
    });

    // GET /api/hosts/:id/backup/config - Get backup configuration (without password)
    router.get('/:id/backup/config', middleware.requireAuth, (req, res) => {
        const hosts = getHosts();
        const host = hosts.find(h => h.id === req.params.id);

        if (!host) {
            return res.status(404).json({ error: 'Host not found' });
        }

        const method = host.backupMethod || 'ssh';
        let port = method === 'https' ? 443 : 22;
        let username = '';

        if (host.backupCredentials) {
            try {
                const creds = configBackupService.decryptCredentials(host.backupCredentials);
                port = creds.port || port;
                username = creds.username || '';
            } catch (e) {
                // Ignore decryption errors
            }
        }

        res.json({
            enabled: host.backupEnabled || false,
            vendor: host.backupVendor || 'mikrotik',
            method: method,
            port,
            username,
            hasCredentials: !!host.backupCredentials
        });
    });

    // GET /api/backup/schedule - Get auto backup schedule info
    router.get('/schedule', middleware.requireAuth, (req, res) => {
        // Import backup service for schedule info
        const backupService = require('../services/backupService');
        const scheduleInfo = backupService.getBackupScheduleInfo();
        res.json(scheduleInfo);
    });

    return router;
}

module.exports = { createBackupRoutes };
