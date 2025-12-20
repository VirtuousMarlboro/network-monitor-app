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
    getLastTrafficEntry,
    cleanupTrafficHistory,
    // Logs
    storeLog,
    getLogs,
    // Audit
    storeAuditLog,
    getAuditLogs,
    // Migration
    migrateFromJson,
};
