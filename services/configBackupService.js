/**
 * Config Backup Service
 * Handles SSH-based config backup for MikroTik and FortiGate routers
 * with AES-256 encryption for credentials and config files
 */

const { Client } = require('ssh2');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Encryption settings
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

// Get encryption key from environment
function getEncryptionKey() {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error('SESSION_SECRET must be at least 32 characters for encryption');
    }
    return crypto.scryptSync(secret, 'config-backup-salt', 32);
}

/**
 * Encrypt text using AES-256-GCM
 * @param {string} plainText - Text to encrypt
 * @returns {string} - Base64 encoded encrypted data
 */
function encrypt(plainText) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Combine iv + authTag + encrypted data
    const combined = Buffer.concat([
        iv,
        authTag,
        Buffer.from(encrypted, 'base64')
    ]);

    return combined.toString('base64');
}

/**
 * Decrypt text using AES-256-GCM
 * @param {string} encryptedData - Base64 encoded encrypted data
 * @returns {string} - Decrypted plain text
 */
function decrypt(encryptedData) {
    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedData, 'base64');

    // Extract iv, authTag, and encrypted content
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted.toString('base64'), 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Encrypt credentials for storage in database
 */
function encryptCredentials(credentials) {
    return encrypt(JSON.stringify(credentials));
}

/**
 * Decrypt credentials from database
 */
function decryptCredentials(encryptedCredentials) {
    return JSON.parse(decrypt(encryptedCredentials));
}

/**
 * SSH Command mappings per vendor
 */
const SSH_COMMANDS = {
    mikrotik: '/export compact',
    fortigate: 'show full-configuration'
};

/**
 * Backup config via SSH
 * @param {Object} options
 * @param {string} options.host - Router IP/hostname
 * @param {number} options.port - SSH port (default 22)
 * @param {string} options.username - SSH username
 * @param {string} options.password - SSH password
 * @param {string} options.vendor - 'mikrotik' or 'fortigate'
 * @param {number} options.timeout - Connection timeout in ms (default 30000)
 * @returns {Promise<string>} - Config content
 */
function backupViaSsh(options) {
    return new Promise((resolve, reject) => {
        const { host, port = 22, username, password, vendor, timeout = 30000 } = options;

        const command = SSH_COMMANDS[vendor];
        if (!command) {
            return reject(new Error(`Unsupported vendor: ${vendor}`));
        }

        const conn = new Client();
        let configOutput = '';
        let errorOutput = '';
        let connectionTimeout;

        // Set connection timeout
        connectionTimeout = setTimeout(() => {
            conn.end();
            reject(new Error(`SSH connection timeout after ${timeout}ms`));
        }, timeout);

        conn.on('ready', () => {
            clearTimeout(connectionTimeout);
            console.log(`[Backup] SSH connected to ${host}:${port}`);

            conn.exec(command, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                stream.on('close', (code, signal) => {
                    conn.end();
                    if (errorOutput && !configOutput) {
                        reject(new Error(errorOutput));
                    } else {
                        resolve(configOutput);
                    }
                });

                stream.on('data', (data) => {
                    configOutput += data.toString();
                });

                stream.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });
            });
        });

        conn.on('error', (err) => {
            clearTimeout(connectionTimeout);
            reject(err);
        });

        // Connect with password authentication
        // MikroTik may require specific algorithms
        conn.connect({
            host,
            port,
            username,
            password,
            readyTimeout: timeout,
            // Accept all host keys (for network devices)
            hostVerifier: () => true,
            // Try keyboard-interactive as fallback
            tryKeyboard: true,
            // Algorithms compatible with MikroTik RouterOS
            algorithms: {
                kex: [
                    'curve25519-sha256',
                    'curve25519-sha256@libssh.org',
                    'ecdh-sha2-nistp256',
                    'ecdh-sha2-nistp384',
                    'ecdh-sha2-nistp521',
                    'diffie-hellman-group-exchange-sha256',
                    'diffie-hellman-group14-sha256',
                    'diffie-hellman-group14-sha1',
                    'diffie-hellman-group1-sha1'
                ],
                cipher: [
                    'aes128-ctr',
                    'aes192-ctr',
                    'aes256-ctr',
                    'aes128-gcm',
                    'aes128-gcm@openssh.com',
                    'aes256-gcm',
                    'aes256-gcm@openssh.com',
                    'aes256-cbc',
                    'aes192-cbc',
                    'aes128-cbc',
                    '3des-cbc'
                ],
                serverHostKey: [
                    'ssh-rsa',
                    'ssh-dss',
                    'ecdsa-sha2-nistp256',
                    'ecdsa-sha2-nistp384',
                    'ecdsa-sha2-nistp521',
                    'ssh-ed25519',
                    'rsa-sha2-256',
                    'rsa-sha2-512'
                ],
                hmac: [
                    'hmac-sha2-256',
                    'hmac-sha2-512',
                    'hmac-sha1',
                    'hmac-md5'
                ]
            }
        });
    });
}

/**
 * Backup config via HTTPS (FortiGate REST API)
 * @param {Object} options
 * @param {string} options.host - FortiGate IP/hostname
 * @param {number} options.port - HTTPS port (default 443)
 * @param {string} options.apiToken - FortiGate API token
 * @param {number} options.timeout - Request timeout in ms (default 30000)
 * @returns {Promise<string>} - Config content
 */
function backupViaHttps(options) {
    return new Promise((resolve, reject) => {
        const { host, port = 443, apiToken, timeout = 30000 } = options;

        if (!apiToken) {
            return reject(new Error('API Token is required for HTTPS backup'));
        }

        const https = require('https');

        // FortiGate config backup endpoint
        const requestOptions = {
            hostname: host,
            port: port,
            path: '/api/v2/monitor/system/config/backup?scope=global',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Accept': 'application/octet-stream'
            },
            timeout: timeout,
            // Skip SSL certificate verification (self-signed certs on FortiGate)
            rejectUnauthorized: false
        };

        console.log(`[Backup] HTTPS connecting to ${host}:${port}`);

        const req = https.request(requestOptions, (res) => {
            let data = [];

            if (res.statusCode === 401) {
                reject(new Error('Authentication failed: Invalid API token'));
                return;
            }

            if (res.statusCode === 403) {
                reject(new Error('Access denied: API token lacks required permissions'));
                return;
            }

            if (res.statusCode !== 200) {
                reject(new Error(`HTTP Error: ${res.statusCode} ${res.statusMessage}`));
                return;
            }

            res.on('data', (chunk) => {
                data.push(chunk);
            });

            res.on('end', () => {
                const buffer = Buffer.concat(data);
                // FortiGate returns config as text
                const configContent = buffer.toString('utf8');

                if (!configContent || configContent.length < 100) {
                    reject(new Error('Empty or invalid config received'));
                    return;
                }

                console.log(`[Backup] HTTPS backup successful, size: ${configContent.length} bytes`);
                resolve(configContent);
            });
        });

        req.on('error', (err) => {
            reject(new Error(`HTTPS connection failed: ${err.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`HTTPS request timeout after ${timeout}ms`));
        });

        req.end();
    });
}

/**
 * Save encrypted config to filesystem
 * @param {string} hostId - Host ID
 * @param {string} configContent - Plain config text
 * @param {string} backupType - 'manual' or 'scheduled'
 * @returns {Object} - { filename, path, sizeBytes }
 */
function saveEncryptedConfig(hostId, configContent, backupType = 'manual') {
    const backupDir = path.join(__dirname, '..', 'data', 'backups', hostId);

    // Create backup directory if not exists
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const randomId = crypto.randomBytes(4).toString('hex');
    const filename = `${timestamp}_${backupType}_${randomId}.enc`;
    const filepath = path.join(backupDir, filename);

    // Encrypt and save
    const encryptedContent = encrypt(configContent);
    fs.writeFileSync(filepath, encryptedContent, 'utf8');

    return {
        filename,
        path: filepath,
        sizeBytes: fs.statSync(filepath).size
    };
}

/**
 * Load and decrypt config from filesystem
 * @param {string} hostId - Host ID
 * @param {string} filename - Backup filename
 * @returns {string} - Decrypted config content
 */
function loadDecryptedConfig(hostId, filename) {
    const filepath = path.join(__dirname, '..', 'data', 'backups', hostId, filename);

    if (!fs.existsSync(filepath)) {
        throw new Error('Backup file not found');
    }

    const encryptedContent = fs.readFileSync(filepath, 'utf8');
    return decrypt(encryptedContent);
}

/**
 * Delete backup file
 * @param {string} hostId - Host ID
 * @param {string} filename - Backup filename
 */
function deleteBackupFile(hostId, filename) {
    const filepath = path.join(__dirname, '..', 'data', 'backups', hostId, filename);

    if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        return true;
    }
    return false;
}

/**
 * Get all backup files for a host (without decrypting)
 * @param {string} hostId - Host ID
 * @returns {Array} - List of backup file info
 */
function listBackupFiles(hostId) {
    const backupDir = path.join(__dirname, '..', 'data', 'backups', hostId);

    if (!fs.existsSync(backupDir)) {
        return [];
    }

    return fs.readdirSync(backupDir)
        .filter(f => f.endsWith('.enc'))
        .map(filename => {
            const filepath = path.join(backupDir, filename);
            const stats = fs.statSync(filepath);

            // Parse filename: 2025-12-30T10-30-00_manual_abc123.enc
            const parts = filename.replace('.enc', '').split('_');
            const timestamp = parts[0].replace(/-/g, (m, i) => i > 9 ? ':' : '-');
            const backupType = parts[1] || 'manual';

            return {
                filename,
                sizeBytes: stats.size,
                createdAt: stats.mtime,
                backupType
            };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = {
    encrypt,
    decrypt,
    encryptCredentials,
    decryptCredentials,
    backupViaSsh,
    backupViaHttps,
    saveEncryptedConfig,
    loadDecryptedConfig,
    deleteBackupFile,
    listBackupFiles,
    SSH_COMMANDS
};
