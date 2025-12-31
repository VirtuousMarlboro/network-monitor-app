const cron = require('node-cron');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

// Configuration
const BACKUP_ENABLED = process.env.BACKUP_ENABLED === 'true';
const BACKUP_SCHEDULE = process.env.BACKUP_CRON || '0 0 * * *'; // Default: Midnight
const BACKUP_PATH = process.env.BACKUP_PATH || './backups';
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS) || 7;
const DATA_DIR = path.join(__dirname, '../data');

// Track last backup time
let lastBackupTime = null;

// Ensure backup directory exists
function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_PATH)) {
        try {
            fs.mkdirSync(BACKUP_PATH, { recursive: true });
        } catch (error) {
            console.error(`❌ Failed to create backup directory at ${BACKUP_PATH}:`, error.message);
            return false;
        }
    }
    return true;
}

// Perform Backup
async function performBackup() {
    console.log('📦 Starting auto-backup...');

    if (!ensureBackupDir()) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup-nms-${timestamp}.zip`;
    const outputPath = path.join(BACKUP_PATH, filename);

    // Create a file to stream archive data to.
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
    });

    output.on('close', function () {
        console.log(`✅ Backup completed! File: ${filename} (${archive.pointer()} bytes)`);
        cleanupOldBackups();
    });

    archive.on('warning', function (err) {
        if (err.code === 'ENOENT') {
            console.warn('Backup warning:', err);
        } else {
            console.error('Backup error:', err);
        }
    });

    archive.on('error', function (err) {
        console.error('Backup failed:', err);
    });

    // pipe archive data to the file
    archive.pipe(output);

    // SECURITY: Backup data files but EXCLUDE settings.json (may contain secrets)
    // Backup individual files instead of entire directory
    const filesToBackup = ['hosts.json', 'logs.json', 'users.json', 'tickets.json', 'waf-logs.json'];
    for (const file of filesToBackup) {
        const filePath = path.join(DATA_DIR, file);
        if (fs.existsSync(filePath)) {
            archive.file(filePath, { name: `data/${file}` });
        }
    }
    // Note: settings.json is excluded because it may contain Telegram tokens
    // Sessions database is excluded as it's ephemeral

    // Also backup uploads if exists
    const uploadsDir = path.join(__dirname, '../uploads');
    if (fs.existsSync(uploadsDir)) {
        archive.directory(uploadsDir, 'uploads');
    }

    // append .env for full restoration (Optional, be careful with secrets if sharing zip)
    // archive.file(path.join(__dirname, '../.env'), { name: '.env.backup' });

    await archive.finalize();
}

// Cleanup old backups
function cleanupOldBackups() {
    try {
        const files = fs.readdirSync(BACKUP_PATH);
        const now = Date.now();
        const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;

        let deletedCount = 0;
        files.forEach(file => {
            if (!file.startsWith('backup-nms-')) return;

            const filePath = path.join(BACKUP_PATH, file);
            const stats = fs.statSync(filePath);

            if (now - stats.mtimeMs > retentionMs) {
                fs.unlinkSync(filePath);
                deletedCount++;
            }
        });

        if (deletedCount > 0) {
            console.log(`🧹 Cleaned up ${deletedCount} old backup file(s).`);
        }
    } catch (error) {
        console.error('Error cleaning up old backups:', error);
    }
}

// Parse cron schedule to calculate next run time (simple parser for common patterns)
function getNextBackupTime() {
    if (!BACKUP_ENABLED) {
        return null;
    }

    try {
        // Parse simple cron patterns like "0 0 * * *" (minute hour * * *)
        const parts = BACKUP_SCHEDULE.split(' ');
        if (parts.length < 5) return null;

        const minute = parseInt(parts[0]) || 0;
        const hour = parseInt(parts[1]) || 0;

        const now = new Date();
        const nextRun = new Date();
        nextRun.setHours(hour, minute, 0, 0);

        // If the time has already passed today, schedule for tomorrow
        if (nextRun <= now) {
            nextRun.setDate(nextRun.getDate() + 1);
        }

        return nextRun;
    } catch (err) {
        console.error('Error calculating next backup time:', err);
        return null;
    }
}

// Get backup schedule info (for API)
function getBackupScheduleInfo() {
    const nextRun = getNextBackupTime();
    return {
        enabled: BACKUP_ENABLED,
        schedule: BACKUP_SCHEDULE,
        nextRun: nextRun ? nextRun.toISOString() : null,
        lastRun: lastBackupTime ? lastBackupTime.toISOString() : null,
        retentionDays: RETENTION_DAYS,
        backupPath: BACKUP_PATH
    };
}

// Initialize Service
function init() {
    if (!BACKUP_ENABLED) {
        console.log('⚠️ Auto-backup is DISABLED in settings.');
        return;
    }

    console.log(`🕒 Backup Scheduler initialized. Schedule: ${BACKUP_SCHEDULE}`);
    console.log(`📂 Backup Destination: ${BACKUP_PATH}`);

    // Validate cron syntax validity
    if (!cron.validate(BACKUP_SCHEDULE)) {
        console.error('❌ Invalid Cron Syntax for BACKUP_CRON. Backup not scheduled.');
        return;
    }

    // Log next backup time
    const nextRun = getNextBackupTime();
    if (nextRun) {
        console.log(`⏰ Next backup scheduled at: ${nextRun.toLocaleString()}`);
    }

    cron.schedule(BACKUP_SCHEDULE, () => {
        lastBackupTime = new Date();
        performBackup();
    });
}

module.exports = {
    init,
    performBackup, // Exported for manual trigger testing
    getNextBackupTime,
    getBackupScheduleInfo
};
