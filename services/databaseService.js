/**
 * Database Service - SQLite storage for traffic and logs
 * Replaces JSON file storage for better performance and querying
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Constants
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'network_monitor.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);
console.log('💾 Database initialized:', DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// ========================================
// Schema Initialization
// ========================================
function initializeSchema() {
    // Traffic History Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS traffic_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            host_id TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            in_octets INTEGER,
            out_octets INTEGER,
            traffic_in REAL DEFAULT 0,
            traffic_out REAL DEFAULT 0,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );
        
        CREATE INDEX IF NOT EXISTS idx_traffic_host_time 
        ON traffic_history(host_id, timestamp DESC);
    `);

    // Logs Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS logs (
            id TEXT PRIMARY KEY,
            timestamp INTEGER NOT NULL,
            host_id TEXT NOT NULL,
            host_name TEXT,
            host TEXT,
            type TEXT NOT NULL,
            latency REAL,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );
        
        CREATE INDEX IF NOT EXISTS idx_logs_time 
        ON logs(timestamp DESC);
        
        CREATE INDEX IF NOT EXISTS idx_logs_host 
        ON logs(host_id);
    `);

    // Audit Logs Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            user_id TEXT,
            username TEXT,
            action TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            user_agent TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_audit_time 
        ON audit_logs(timestamp DESC);
    `);

    // ========================================
    // NEW TABLES - Complete SQLite Migration
    // ========================================

    // Host Groups Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS host_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );
    `);

    // Hosts Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS hosts (
            id TEXT PRIMARY KEY,
            host TEXT NOT NULL,
            name TEXT,
            cid TEXT,
            status TEXT DEFAULT 'unknown',
            latency REAL,
            latitude REAL,
            longitude REAL,
            group_id TEXT,
            snmp_enabled INTEGER DEFAULT 0,
            snmp_community TEXT,
            snmp_version TEXT DEFAULT '2c',
            snmp_interface INTEGER,
            snmp_interface_name TEXT,
            last_check INTEGER,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            FOREIGN KEY (group_id) REFERENCES host_groups(id)
        );
        
        CREATE INDEX IF NOT EXISTS idx_hosts_status ON hosts(status);
        CREATE INDEX IF NOT EXISTS idx_hosts_group ON hosts(group_id);
    `);

    // Users Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT,
            role TEXT DEFAULT 'user',
            must_change_password INTEGER DEFAULT 1,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );
        
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `);

    // Tickets Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS tickets (
            id TEXT PRIMARY KEY,
            host_id TEXT,
            cid TEXT,
            source TEXT,
            status TEXT DEFAULT 'open',
            priority TEXT DEFAULT 'medium',
            description TEXT,
            resolution TEXT,
            pic TEXT,
            submitter TEXT,
            created_at INTEGER,
            first_response_at INTEGER,
            resolved_at INTEGER,
            created_by TEXT,
            FOREIGN KEY (host_id) REFERENCES hosts(id)
        );
        
        CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
        CREATE INDEX IF NOT EXISTS idx_tickets_host ON tickets(host_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at DESC);
    `);

    // Ticket Comments Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS ticket_comments (
            id TEXT PRIMARY KEY,
            ticket_id TEXT NOT NULL,
            author_id TEXT,
            author_name TEXT,
            content TEXT,
            attachments TEXT,
            created_at INTEGER,
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
        );
        
        CREATE INDEX IF NOT EXISTS idx_comments_ticket ON ticket_comments(ticket_id);
    `);

    // Settings Table (Key-Value)
    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );
    `);

    // Push Subscriptions Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            endpoint TEXT UNIQUE,
            keys TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );
    `);

    // WAF Logs Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS waf_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            ip TEXT,
            path TEXT,
            attack_type TEXT,
            pattern TEXT,
            matched_value TEXT,
            user_agent TEXT,
            blocked INTEGER DEFAULT 1
        );
        
        CREATE INDEX IF NOT EXISTS idx_waf_time ON waf_logs(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_waf_type ON waf_logs(attack_type);
    `);

    // API Keys Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            name TEXT,
            key_hash TEXT UNIQUE,
            user_id TEXT,
            permissions TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            last_used INTEGER
        );
    `);

    // Webhooks Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS webhooks (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            events TEXT,
            secret TEXT,
            enabled INTEGER DEFAULT 1,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );
    `);

    // Maintenance Windows Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_windows (
            id TEXT PRIMARY KEY,
            host_id TEXT,
            start_time INTEGER,
            end_time INTEGER,
            reason TEXT,
            created_by TEXT,
            FOREIGN KEY (host_id) REFERENCES hosts(id)
        );
    `);

    console.log('✅ Database schema initialized');
}

// Initialize on module load
initializeSchema();

// ========================================
// Traffic History Operations
// ========================================
const trafficInsertStmt = db.prepare(`
    INSERT INTO traffic_history (host_id, timestamp, in_octets, out_octets, traffic_in, traffic_out)
    VALUES (?, ?, ?, ?, ?, ?)
`);

const trafficSelectStmt = db.prepare(`
    SELECT timestamp, in_octets as inOctets, out_octets as outOctets, traffic_in, traffic_out
    FROM traffic_history
    WHERE host_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
`);

const trafficLastEntryStmt = db.prepare(`
    SELECT timestamp, in_octets as inOctets, out_octets as outOctets, traffic_in, traffic_out
    FROM traffic_history
    WHERE host_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
`);

const trafficCleanupStmt = db.prepare(`
    DELETE FROM traffic_history 
    WHERE host_id = ? AND id NOT IN (
        SELECT id FROM traffic_history 
        WHERE host_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
    )
`);

/**
 * Store a traffic data point
 */
function storeTrafficEntry(hostId, data) {
    try {
        trafficInsertStmt.run(
            hostId,
            data.timestamp,
            data.inOctets,
            data.outOctets,
            data.traffic_in || 0,
            data.traffic_out || 0
        );
    } catch (err) {
        console.error('Error storing traffic entry:', err.message);
    }
}

/**
 * Get traffic history for a host
 */
function getTrafficHistory(hostId, limit = 500) {
    try {
        const rows = trafficSelectStmt.all(hostId, limit);
        // Reverse to get chronological order (oldest first)
        return rows.reverse();
    } catch (err) {
        console.error('Error getting traffic history:', err.message);
        return [];
    }
}

/**
 * Get traffic history with pagination (offset-based)
 * @param {string} hostId - Host ID
 * @param {number} limit - Number of records per page
 * @param {number} offset - Number of records to skip
 * @returns {Object} { data: [], total: number, hasMore: boolean }
 */
function getTrafficHistoryPaginated(hostId, limit = 100, offset = 0) {
    try {
        const countStmt = db.prepare('SELECT COUNT(*) as total FROM traffic_history WHERE host_id = ?');
        const { total } = countStmt.get(hostId);

        const dataStmt = db.prepare(`
            SELECT * FROM traffic_history 
            WHERE host_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ? OFFSET ?
        `);
        const rows = dataStmt.all(hostId, limit, offset);

        return {
            data: rows.reverse(), // Chronological order
            total,
            hasMore: offset + limit < total,
            page: Math.floor(offset / limit) + 1,
            totalPages: Math.ceil(total / limit)
        };
    } catch (err) {
        console.error('Error getting paginated traffic history:', err.message);
        return { data: [], total: 0, hasMore: false, page: 1, totalPages: 0 };
    }
}

/**
 * Get the last traffic entry for rate calculation
 */
function getLastTrafficEntry(hostId) {
    try {
        return trafficLastEntryStmt.get(hostId) || null;
    } catch (err) {
        console.error('Error getting last traffic entry:', err.message);
        return null;
    }
}

/**
 * Clean up old traffic entries (keep only last N)
 */
function cleanupTrafficHistory(hostId, keepCount = 2880) {
    try {
        trafficCleanupStmt.run(hostId, hostId, keepCount);
    } catch (err) {
        console.error('Error cleaning traffic history:', err.message);
    }
}

// ========================================
// Logs Operations
// ========================================
const logInsertStmt = db.prepare(`
    INSERT INTO logs (id, timestamp, host_id, host_name, host, type, latency)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const logsSelectStmt = db.prepare(`
    SELECT * FROM logs
    ORDER BY timestamp DESC
    LIMIT ?
`);

function storeLog(logEntry) {
    try {
        logInsertStmt.run(
            logEntry.id,
            logEntry.timestamp,
            logEntry.hostId,
            logEntry.hostName,
            logEntry.host,
            logEntry.type,
            logEntry.latency || null
        );
    } catch (err) {
        console.error('Error storing log:', err.message);
    }
}

function getLogs(limit = 1000) {
    try {
        return logsSelectStmt.all(limit);
    } catch (err) {
        console.error('Error getting logs:', err.message);
        return [];
    }
}

// ========================================
// Audit Logs Operations
// ========================================
const auditInsertStmt = db.prepare(`
    INSERT INTO audit_logs (timestamp, user_id, username, action, details, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const auditSelectStmt = db.prepare(`
    SELECT * FROM audit_logs
    ORDER BY timestamp DESC
    LIMIT ?
`);

function storeAuditLog(entry) {
    try {
        auditInsertStmt.run(
            entry.timestamp,
            entry.userId,
            entry.username,
            entry.action,
            JSON.stringify(entry.details || {}),
            entry.ipAddress,
            entry.userAgent
        );
    } catch (err) {
        console.error('Error storing audit log:', err.message);
    }
}

function getAuditLogs(limit = 500) {
    try {
        const rows = auditSelectStmt.all(limit);
        return rows.map(row => ({
            ...row,
            details: JSON.parse(row.details || '{}')
        }));
    } catch (err) {
        console.error('Error getting audit logs:', err.message);
        return [];
    }
}

// ========================================
// Host Groups Operations
// ========================================
const groupInsertStmt = db.prepare(`
    INSERT OR REPLACE INTO host_groups (id, name, color, created_at)
    VALUES (?, ?, ?, ?)
`);

function getAllHostGroups() {
    return db.prepare('SELECT * FROM host_groups ORDER BY name').all();
}

function createHostGroup(group) {
    groupInsertStmt.run(group.id, group.name, group.color, Date.now());
}

function updateHostGroup(id, data) {
    const stmt = db.prepare('UPDATE host_groups SET name = ?, color = ? WHERE id = ?');
    stmt.run(data.name, data.color, id);
}

function deleteHostGroup(id) {
    db.prepare('DELETE FROM host_groups WHERE id = ?').run(id);
}

// ========================================
// Hosts Operations
// ========================================
function getAllHosts() {
    return db.prepare('SELECT * FROM hosts ORDER BY name').all().map(h => ({
        ...h,
        snmpEnabled: !!h.snmp_enabled,
        snmpCommunity: h.snmp_community,
        snmpVersion: h.snmp_version,
        snmpInterface: h.snmp_interface,
        snmpInterfaceName: h.snmp_interface_name,
        groupId: h.group_id,
        lastCheck: h.last_check,
        createdAt: h.created_at
    }));
}

function getHostById(id) {
    const h = db.prepare('SELECT * FROM hosts WHERE id = ?').get(id);
    if (!h) return null;
    return {
        ...h,
        snmpEnabled: !!h.snmp_enabled,
        snmpCommunity: h.snmp_community,
        snmpVersion: h.snmp_version,
        snmpInterface: h.snmp_interface,
        snmpInterfaceName: h.snmp_interface_name,
        groupId: h.group_id,
        lastCheck: h.last_check,
        createdAt: h.created_at
    };
}

function createHost(host) {
    const stmt = db.prepare(`
        INSERT INTO hosts (id, host, name, cid, status, latency, latitude, longitude, 
            group_id, snmp_enabled, snmp_community, snmp_version, snmp_interface, 
            snmp_interface_name, last_check, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        host.id, host.host, host.name, host.cid, host.status || 'unknown',
        host.latency, host.latitude, host.longitude, host.groupId,
        host.snmpEnabled ? 1 : 0, host.snmpCommunity, host.snmpVersion || '2c',
        host.snmpInterface, host.snmpInterfaceName, host.lastCheck, Date.now()
    );
}

function updateHost(id, data) {
    const fields = [];
    const values = [];

    if (data.host !== undefined) { fields.push('host = ?'); values.push(data.host); }
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.cid !== undefined) { fields.push('cid = ?'); values.push(data.cid); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    if (data.latency !== undefined) { fields.push('latency = ?'); values.push(data.latency); }
    if (data.latitude !== undefined) { fields.push('latitude = ?'); values.push(data.latitude); }
    if (data.longitude !== undefined) { fields.push('longitude = ?'); values.push(data.longitude); }
    if (data.groupId !== undefined) { fields.push('group_id = ?'); values.push(data.groupId); }
    if (data.snmpEnabled !== undefined) { fields.push('snmp_enabled = ?'); values.push(data.snmpEnabled ? 1 : 0); }
    if (data.snmpCommunity !== undefined) { fields.push('snmp_community = ?'); values.push(data.snmpCommunity); }
    if (data.snmpVersion !== undefined) { fields.push('snmp_version = ?'); values.push(data.snmpVersion); }
    if (data.snmpInterface !== undefined) { fields.push('snmp_interface = ?'); values.push(data.snmpInterface); }
    if (data.snmpInterfaceName !== undefined) { fields.push('snmp_interface_name = ?'); values.push(data.snmpInterfaceName); }
    if (data.lastCheck !== undefined) { fields.push('last_check = ?'); values.push(data.lastCheck); }

    if (fields.length === 0) return;

    values.push(id);
    db.prepare(`UPDATE hosts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function deleteHost(id) {
    db.prepare('DELETE FROM hosts WHERE id = ?').run(id);
}

// ========================================
// Users Operations
// ========================================
function getAllUsers() {
    return db.prepare('SELECT id, username, name, role, must_change_password, created_at FROM users ORDER BY username').all()
        .map(u => ({
            id: u.id,
            username: u.username,
            name: u.name,
            role: u.role,
            mustChangePassword: !!u.must_change_password,
            createdAt: u.created_at
        }));
}

function getUserById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function createUser(user) {
    const stmt = db.prepare(`
        INSERT INTO users (id, username, password, name, role, must_change_password, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(user.id, user.username, user.password, user.name, user.role || 'user',
        user.mustChangePassword !== false ? 1 : 0, Date.now());
}

function updateUser(id, data) {
    const fields = [];
    const values = [];

    if (data.username !== undefined) { fields.push('username = ?'); values.push(data.username); }
    if (data.password !== undefined) { fields.push('password = ?'); values.push(data.password); }
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.role !== undefined) { fields.push('role = ?'); values.push(data.role); }
    if (data.mustChangePassword !== undefined) { fields.push('must_change_password = ?'); values.push(data.mustChangePassword ? 1 : 0); }

    if (fields.length === 0) return;

    values.push(id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function deleteUser(id) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// ========================================
// Tickets Operations
// ========================================
function getAllTickets() {
    return db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all().map(t => ({
        ...t,
        hostId: t.host_id,
        firstResponseAt: t.first_response_at,
        resolvedAt: t.resolved_at,
        createdAt: t.created_at,
        createdBy: t.created_by,
        comments: getTicketComments(t.id)
    }));
}

function getTicketById(id) {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!t) return null;
    return {
        ...t,
        hostId: t.host_id,
        firstResponseAt: t.first_response_at,
        resolvedAt: t.resolved_at,
        createdAt: t.created_at,
        createdBy: t.created_by,
        comments: getTicketComments(id)
    };
}

function createTicket(ticket) {
    const stmt = db.prepare(`
        INSERT INTO tickets (id, host_id, cid, source, status, priority, description, 
            resolution, pic, submitter, created_at, first_response_at, resolved_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        ticket.id, ticket.hostId, ticket.cid, ticket.source, ticket.status || 'open',
        ticket.priority || 'medium', ticket.description, ticket.resolution,
        ticket.pic, ticket.submitter, ticket.createdAt || Date.now(),
        ticket.firstResponseAt, ticket.resolvedAt, ticket.createdBy
    );
}

function updateTicket(id, data) {
    const fields = [];
    const values = [];

    if (data.hostId !== undefined) { fields.push('host_id = ?'); values.push(data.hostId); }
    if (data.cid !== undefined) { fields.push('cid = ?'); values.push(data.cid); }
    if (data.source !== undefined) { fields.push('source = ?'); values.push(data.source); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    if (data.priority !== undefined) { fields.push('priority = ?'); values.push(data.priority); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.resolution !== undefined) { fields.push('resolution = ?'); values.push(data.resolution); }
    if (data.pic !== undefined) { fields.push('pic = ?'); values.push(data.pic); }
    if (data.submitter !== undefined) { fields.push('submitter = ?'); values.push(data.submitter); }
    if (data.firstResponseAt !== undefined) { fields.push('first_response_at = ?'); values.push(data.firstResponseAt); }
    if (data.resolvedAt !== undefined) { fields.push('resolved_at = ?'); values.push(data.resolvedAt); }

    if (fields.length === 0) return;

    values.push(id);
    db.prepare(`UPDATE tickets SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function deleteTicket(id) {
    db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
    db.prepare('DELETE FROM ticket_comments WHERE ticket_id = ?').run(id);
}

// Ticket Comments
function getTicketComments(ticketId) {
    return db.prepare('SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at').all(ticketId)
        .map(c => ({
            id: c.id,
            authorId: c.author_id,
            authorName: c.author_name,
            content: c.content,
            attachments: c.attachments ? JSON.parse(c.attachments) : [],
            createdAt: c.created_at
        }));
}

function addTicketComment(ticketId, comment) {
    const stmt = db.prepare(`
        INSERT INTO ticket_comments (id, ticket_id, author_id, author_name, content, attachments, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(comment.id, ticketId, comment.authorId, comment.authorName,
        comment.content, JSON.stringify(comment.attachments || []), comment.createdAt || Date.now());
}

function deleteTicketComment(commentId) {
    db.prepare('DELETE FROM ticket_comments WHERE id = ?').run(commentId);
}

// ========================================
// Settings Operations (Key-Value)
// ========================================
function getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
}

function setSetting(key, value) {
    db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
    `).run(key, JSON.stringify(value), Date.now());
}

function getAllSettings() {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    for (const row of rows) {
        settings[row.key] = JSON.parse(row.value);
    }
    return settings;
}

// ========================================
// Migration from JSON files
// ========================================
function migrateFromJson() {
    const trafficJsonPath = path.join(DATA_DIR, 'snmp_traffic.json');

    // Check if JSON file exists and has data
    if (fs.existsSync(trafficJsonPath)) {
        try {
            const jsonData = JSON.parse(fs.readFileSync(trafficJsonPath, 'utf-8'));
            let totalMigrated = 0;

            // Use transaction for bulk insert
            const insertMany = db.transaction((entries) => {
                for (const entry of entries) {
                    trafficInsertStmt.run(
                        entry.host_id,
                        entry.timestamp,
                        entry.inOctets || 0,
                        entry.outOctets || 0,
                        entry.traffic_in || 0,
                        entry.traffic_out || 0
                    );
                }
            });

            for (const [hostId, history] of Object.entries(jsonData)) {
                if (Array.isArray(history) && history.length > 0) {
                    const entries = history.map(h => ({
                        host_id: hostId,
                        timestamp: h.timestamp,
                        inOctets: h.inOctets,
                        outOctets: h.outOctets,
                        traffic_in: h.traffic_in || 0,
                        traffic_out: h.traffic_out || 0
                    }));

                    insertMany(entries);
                    totalMigrated += entries.length;
                }
            }

            console.log(`✅ Migrated ${totalMigrated} traffic entries from JSON to SQLite`);

            // Backup and remove old JSON file
            const backupPath = trafficJsonPath.replace('.json', '.json.bak');
            fs.renameSync(trafficJsonPath, backupPath);
            console.log(`📦 JSON file backed up to ${backupPath}`);

        } catch (err) {
            console.error('Migration error:', err.message);
        }
    }
}

// ========================================
// Complete Migration - All JSON files
// ========================================
function migrateAllFromJson() {
    console.log('🔄 Starting complete migration from JSON to SQLite...');

    // Migrate hosts
    const hostsPath = path.join(DATA_DIR, 'hosts.json');
    if (fs.existsSync(hostsPath)) {
        try {
            const hosts = JSON.parse(fs.readFileSync(hostsPath, 'utf-8'));
            db.transaction(() => {
                for (const host of hosts) {
                    createHost(host);
                }
            })();
            console.log(`✅ Migrated ${hosts.length} hosts`);
        } catch (err) {
            console.error('Hosts migration error:', err.message);
        }
    }

    // Migrate users
    const usersPath = path.join(DATA_DIR, 'users.json');
    if (fs.existsSync(usersPath)) {
        try {
            const users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
            db.transaction(() => {
                for (const user of users) {
                    createUser(user);
                }
            })();
            console.log(`✅ Migrated ${users.length} users`);
        } catch (err) {
            console.error('Users migration error:', err.message);
        }
    }

    // Migrate tickets
    const ticketsPath = path.join(DATA_DIR, 'tickets.json');
    if (fs.existsSync(ticketsPath)) {
        try {
            const tickets = JSON.parse(fs.readFileSync(ticketsPath, 'utf-8'));
            db.transaction(() => {
                for (const ticket of tickets) {
                    createTicket(ticket);
                    if (ticket.comments) {
                        for (const comment of ticket.comments) {
                            addTicketComment(ticket.id, comment);
                        }
                    }
                }
            })();
            console.log(`✅ Migrated ${tickets.length} tickets`);
        } catch (err) {
            console.error('Tickets migration error:', err.message);
        }
    }

    // Migrate host groups
    const groupsPath = path.join(DATA_DIR, 'host_groups.json');
    if (fs.existsSync(groupsPath)) {
        try {
            const groups = JSON.parse(fs.readFileSync(groupsPath, 'utf-8'));
            db.transaction(() => {
                for (const group of groups) {
                    createHostGroup(group);
                }
            })();
            console.log(`✅ Migrated ${groups.length} host groups`);
        } catch (err) {
            console.error('Host groups migration error:', err.message);
        }
    }

    // Migrate settings
    const settingsPath = path.join(DATA_DIR, 'settings.json');
    if (fs.existsSync(settingsPath)) {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            for (const [key, value] of Object.entries(settings)) {
                setSetting(key, value);
            }
            console.log(`✅ Migrated settings`);
        } catch (err) {
            console.error('Settings migration error:', err.message);
        }
    }

    console.log('✅ Complete migration finished!');
}

// ========================================
// Cleanup on exit
// ========================================
process.on('exit', () => db.close());
process.on('SIGHUP', () => process.exit(128 + 1));
process.on('SIGINT', () => process.exit(128 + 2));
process.on('SIGTERM', () => process.exit(128 + 15));

module.exports = {
    db,
    // Traffic
    storeTrafficEntry,
    getTrafficHistory,
    getTrafficHistoryPaginated,
    getLastTrafficEntry,
    cleanupTrafficHistory,
    // Logs
    storeLog,
    getLogs,
    // Audit
    storeAuditLog,
    getAuditLogs,
    // Host Groups
    getAllHostGroups,
    createHostGroup,
    updateHostGroup,
    deleteHostGroup,
    // Hosts
    getAllHosts,
    getHostById,
    createHost,
    updateHost,
    deleteHost,
    // Users
    getAllUsers,
    getUserById,
    getUserByUsername,
    createUser,
    updateUser,
    deleteUser,
    // Tickets
    getAllTickets,
    getTicketById,
    createTicket,
    updateTicket,
    deleteTicket,
    getTicketComments,
    addTicketComment,
    deleteTicketComment,
    // Settings
    getSetting,
    setSetting,
    getAllSettings,
    // Migration
    migrateFromJson,
    migrateAllFromJson,
};
