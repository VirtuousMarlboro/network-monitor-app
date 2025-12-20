require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const ping = require('ping');
const xlsx = require('xlsx');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');
const https = require('https');
const backupService = require('./services/backupService');
const { wafMiddleware, getWafStats } = require('./services/wafService');
const webpush = require('web-push');
const snmpService = require('./services/snmpService');
const databaseService = require('./services/databaseService');

// ========================================
// Modular Routes & Middleware (Phase 3 Refactoring)
// ========================================
const { createAuthMiddleware } = require('./middleware/auth');
const { createAuthRoutes } = require('./routes/authRoutes');
const { createUserRoutes } = require('./routes/userRoutes');
const { createHostRoutes } = require('./routes/hostRoutes');
const { createTicketRoutes } = require('./routes/ticketRoutes');
const { createSnmpRoutes } = require('./routes/snmpRoutes');
const { createSettingsRoutes } = require('./routes/settingsRoutes');

// SECURITY: Persistent session store with SQLite
const Database = require('better-sqlite3');
const SqliteStore = require('better-sqlite3-session-store')(session);

// Configure multer for file uploads
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        // Strict allowlist for MIME types
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

        if (!allowedMimes.includes(file.mimetype)) {
            return cb(new Error('Hanya file gambar (JPG, PNG, GIF, WEBP) yang diizinkan!'));
        }

        const allowedExts = /jpeg|jpg|png|gif|webp/;
        const extname = allowedExts.test(path.extname(file.originalname).toLowerCase());

        if (extname) {
            return cb(null, true);
        }
        cb(new Error('Ekstensi file tidak valid!'));
    }
});

// Input Validation Helpers
function isValidHost(host) {
    if (!host || typeof host !== 'string') return false;
    // Allow IP addresses (v4) and valid domain names / hostnames
    // simple regex for basic sanity check against command injection
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    const domainRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    // Check length to prevent massive buffer overflows (though unlikely in JS)
    if (host.length > 255) return false;

    return ipRegex.test(host) || domainRegex.test(host);
}

function isStrongPassword(password) {
    if (!password || password.length < 8) return false;
    // At least 1 uppercase, 1 lowercase, 1 digit, 1 symbol
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    return hasUppercase && hasLowercase && hasDigit && hasSymbol;
}

function getPasswordStrengthError() {
    return 'Password harus minimal 8 karakter, mengandung huruf besar, huruf kecil, angka, dan simbol';
}

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// SECURITY: Remove/Obfuscate Technology Headers
// ========================================
// Remove X-Powered-By header (Express fingerprinting)
app.disable('x-powered-by');

// Custom middleware to obfuscate server identity
app.use((req, res, next) => {
    // Remove or overwrite the Server header to prevent tech fingerprinting
    res.removeHeader('X-Powered-By');
    res.setHeader('Server', 'WebServer'); // Generic server name
    next();
});

// ========================================
// SECURITY: Session Secret Validation
// ========================================
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32 || SESSION_SECRET.includes('change_me') || SESSION_SECRET.includes('fallback')) {
    console.error('âŒ FATAL: SESSION_SECRET must be set and at least 32 characters!');
    console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    process.exit(1);
}

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const HOSTS_FILE = path.join(DATA_DIR, 'hosts.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HOST_GROUPS_FILE = path.join(DATA_DIR, 'host_groups.json');
const AUDIT_LOGS_FILE = path.join(DATA_DIR, 'audit_logs.json');
const MAINTENANCE_FILE = path.join(DATA_DIR, 'maintenance.json');
const PUSH_SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'push_subscriptions.json');
const VAPID_KEYS_FILE = path.join(DATA_DIR, 'vapid_keys.json');
const API_KEYS_FILE = path.join(DATA_DIR, 'api_keys.json');
const WEBHOOKS_FILE = path.join(DATA_DIR, 'webhooks.json');
const SNMP_TRAFFIC_FILE = path.join(DATA_DIR, 'snmp_traffic.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// VAPID Keys for Push Notifications
let vapidKeys = null;
if (fs.existsSync(VAPID_KEYS_FILE)) {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_KEYS_FILE, 'utf-8'));
} else {
    // Generate new VAPID keys
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_KEYS_FILE, JSON.stringify(vapidKeys, null, 2));
    console.log('ðŸ“± Generated new VAPID keys for push notifications');
}

// Configure web-push with VAPID keys
webpush.setVapidDetails(
    'mailto:admin@networkmonitor.local',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// Trust proxy - required when behind reverse proxy (nginx, IIS, etc.)
// This allows express-rate-limit to correctly identify client IPs
app.set('trust proxy', 1);

// SECURITY: HTTPS Redirect for Production
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.headers['x-forwarded-proto'] !== 'https') {
            return res.redirect(`https://${req.headers.host}${req.url}`);
        }
        next();
    });
    console.log('ðŸ”’ HTTPS redirect enabled for production');
}

// Security Middleware with Hardened CSP
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // Script sources - unsafe-inline needed for inline scripts, unsafe-eval for some libraries
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
            // Block inline event handlers (onclick, onload, etc.) - more secure
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
            // Block inline style attributes for better security
            styleSrcAttr: ["'unsafe-inline'"], // Needed for some UI libraries
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:", "https:", "blob:", "https://*.tile.openstreetmap.org", "https://tile.openstreetmap.org"],
            connectSrc: ["'self'", "https://nominatim.openstreetmap.org", "https://api.telegram.org", "https://*.tile.openstreetmap.org", "https://tile.openstreetmap.org"],
            frameSrc: ["'none'"],
            frameAncestors: ["'none'"], // Prevent clickjacking (replaces X-Frame-Options)
            objectSrc: ["'none'"],
            // Prevent base tag hijacking
            baseUri: ["'self'"],
            // Restrict form submissions to same origin
            formAction: ["'self'"],
            // Block plugins like Flash
            pluginTypes: [],
            // Upgrade HTTP to HTTPS in production
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
            // Block all mixed content
            blockAllMixedContent: process.env.NODE_ENV === 'production' ? [] : null,
        }
    },
    crossOriginEmbedderPolicy: false, // Required for loading external map tiles
    // Additional security headers
    xContentTypeOptions: true, // Prevent MIME sniffing
    xDnsPrefetchControl: { allow: false }, // Prevent DNS prefetching
    xDownloadOptions: true, // Prevent IE from executing downloads
    xFrameOptions: { action: 'deny' }, // Legacy clickjacking protection
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' }, // Block Adobe cross-domain policies
    xXssProtection: true, // Enable XSS filter (legacy browsers)
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, // Control referrer info
    hsts: process.env.NODE_ENV === 'production' ? {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
    } : false
}));

// Rate Limiting - Increased for traffic monitoring (polls every 5s)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs (was 100)
    skip: (req) => {
        // Skip rate limiting for SNMP history endpoint (polled frequently)
        return req.path.includes('/snmp/history');
    }
});
app.use(limiter);

// Permissions Policy (formerly Feature Policy)
// Controls which browser features can be used
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', [
        'geolocation=(self)',           // Allow geolocation for map features
        'camera=()',                    // Disable camera access
        'microphone=()',                // Disable microphone access
        'payment=()',                   // Disable payment API
        'usb=()',                       // Disable USB access
        'magnetometer=()',              // Disable magnetometer
        'gyroscope=()',                 // Disable gyroscope
        'accelerometer=()',             // Disable accelerometer
        'autoplay=(self)',              // Allow autoplay for notification sounds
        'fullscreen=(self)',            // Allow fullscreen for map view
        'picture-in-picture=()',        // Disable picture-in-picture
        'display-capture=()',           // Disable screen capture
        'document-domain=()',           // Disable document.domain
        'encrypted-media=()',           // Disable encrypted media
        'interest-cohort=()'            // Disable FLoC tracking
    ].join(', '));
    next();
});

// Auth Rate Limit (Stricter)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // 10 attempts per 15 minutes
    message: { error: 'Terlalu banyak percobaan login, silakan coba lagi nanti.' }
});
app.use('/api/login', authLimiter);

// CORS Configuration - Restrict in production
const corsOrigin = process.env.CORS_ORIGIN;
const corsOptions = {
    // If CORS_ORIGIN is '*', allow all. Otherwise, use specific origin or disable.
    origin: corsOrigin === '*' ? true : (corsOrigin || false),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
app.use(express.json());

// Web Application Firewall (WAF) - Must be after express.json() to access req.body
app.use(wafMiddleware);
console.log('ðŸ›¡ï¸ WAF (Web Application Firewall) enabled');
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_DIR));

// SECURITY: Persistent SQLite Session Store
const SESSION_DB_PATH = path.join(DATA_DIR, 'sessions.db');
const sessionDb = new Database(SESSION_DB_PATH);
console.log('ðŸ’¾ Session store: SQLite (persistent)');

app.use(session({
    name: 'nms.sid', // Custom session name (hide express)
    secret: SESSION_SECRET, // Already validated at startup
    resave: false,
    saveUninitialized: false,
    store: new SqliteStore({
        client: sessionDb,
        expired: {
            clear: true,
            intervalMs: 900000 // Clear expired sessions every 15 minutes
        }
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true if https
        httpOnly: true,
        sameSite: 'lax', // CSRF Protection
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Store monitored hosts in memory (loaded from file on startup)
let monitoredHosts = [];
let pingHistory = {};
let sseClients = [];
let autoPingEnabled = true;
let autoPingInterval = null;

// Probe configuration
const PROBE_INTERVAL = 10000;  // 10 seconds polling interval
const PROBE_TIMEOUT = 1;        // 1 second timeout for ping
const PROBE_DOWN_COUNT = 2;     // 2 failures to declare device down
const TICKET_DELAY = 120000;    // 2 minutes delay before creating ticket (in ms)

// Failure counter per host
let hostFailureCount = {};

// Track when host first went down (for delayed ticket creation)
let hostDownSince = {};

// Track if ticket has already been created for current outage
let hostTicketCreated = {};

// Store status change logs
let statusLogs = [];
const MAX_LOGS = 500;

// Store users
let users = [];

// Store tickets
let tickets = [];
let ticketCounters = { auto: 0, manual: 0 };

// Store settings - Load from ENV first, then settings.json as fallback
let telegramConfig = {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || ''
};

// Store host groups
let hostGroups = [];

// Store audit logs
let auditLogs = [];
const MAX_AUDIT_LOGS = 1000;

// Store scheduled maintenance windows (Phase 2)
let maintenanceWindows = [];

// Store push notification subscriptions (Phase 3)
let pushSubscriptions = [];

// API Keys for external access (Phase 3)
let apiKeys = [];

// Webhooks for external integrations (Phase 3)
let webhooks = [];

// Store SNMP traffic data - NOW IN SQLITE via databaseService
// let snmpTraffic = {}; // DEPRECATED: Traffic data now stored in SQLite database

// ========================================
// Data Persistence Functions
// ========================================

function loadData() {
    try {
        // Load hosts
        if (fs.existsSync(HOSTS_FILE)) {
            const hostsData = fs.readFileSync(HOSTS_FILE, 'utf-8');
            monitoredHosts = JSON.parse(hostsData);
            console.log(`ðŸ“‚ Loaded ${monitoredHosts.length} hosts from file`);
        }

        // Load logs
        if (fs.existsSync(LOGS_FILE)) {
            const logsData = fs.readFileSync(LOGS_FILE, 'utf-8');
            statusLogs = JSON.parse(logsData);
            console.log(`ðŸ“‚ Loaded ${statusLogs.length} logs from file`);
        }

        // Load users
        if (fs.existsSync(USERS_FILE)) {
            const usersData = fs.readFileSync(USERS_FILE, 'utf-8');
            users = JSON.parse(usersData);
            console.log(`ðŸ“‚ Loaded ${users.length} users from file`);
        } else {
            // Create default admin if no users file exists
            createDefaultAdmin();
        }

        // Load tickets
        if (fs.existsSync(TICKETS_FILE)) {
            const ticketsData = fs.readFileSync(TICKETS_FILE, 'utf-8');
            const parsed = JSON.parse(ticketsData);
            tickets = parsed.tickets || [];
            ticketCounters = parsed.counters || { auto: 0, manual: 0 };
            console.log(`ðŸ“‚ Loaded ${tickets.length} tickets from file`);
        }

        // Load settings
        if (fs.existsSync(SETTINGS_FILE)) {
            const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf-8');
            const settings = JSON.parse(settingsData);
            if (settings.telegram) {
                telegramConfig = settings.telegram;
            }
            console.log('ðŸ“‚ Loaded settings from file');
        }

        // Load host groups
        if (fs.existsSync(HOST_GROUPS_FILE)) {
            const groupsData = fs.readFileSync(HOST_GROUPS_FILE, 'utf-8');
            hostGroups = JSON.parse(groupsData);
            console.log(`ðŸ“‚ Loaded ${hostGroups.length} host groups from file`);
        }

        // Load audit logs
        if (fs.existsSync(AUDIT_LOGS_FILE)) {
            const auditData = fs.readFileSync(AUDIT_LOGS_FILE, 'utf-8');
            auditLogs = JSON.parse(auditData);
            console.log(`ðŸ“‚ Loaded ${auditLogs.length} audit logs from file`);
        }

        // Load maintenance windows (Phase 2)
        if (fs.existsSync(MAINTENANCE_FILE)) {
            const maintenanceData = fs.readFileSync(MAINTENANCE_FILE, 'utf-8');
            maintenanceWindows = JSON.parse(maintenanceData);
            console.log(`ðŸ“‚ Loaded ${maintenanceWindows.length} maintenance windows from file`);
        }

        // Load push subscriptions (Phase 3)
        if (fs.existsSync(PUSH_SUBSCRIPTIONS_FILE)) {
            const pushData = fs.readFileSync(PUSH_SUBSCRIPTIONS_FILE, 'utf-8');
            pushSubscriptions = JSON.parse(pushData);
            console.log(`ðŸ“‚ Loaded ${pushSubscriptions.length} push subscriptions from file`);
        }

        // Load API keys (Phase 3)
        if (fs.existsSync(API_KEYS_FILE)) {
            const apiKeysData = fs.readFileSync(API_KEYS_FILE, 'utf-8');
            apiKeys = JSON.parse(apiKeysData);
            console.log(`ðŸ“‚ Loaded ${apiKeys.length} API keys from file`);
        }

        // Load webhooks (Phase 3)
        if (fs.existsSync(WEBHOOKS_FILE)) {
            const webhooksData = fs.readFileSync(WEBHOOKS_FILE, 'utf-8');
            webhooks = JSON.parse(webhooksData);
            console.log(`ðŸ“‚ Loaded ${webhooks.length} webhooks from file`);
        }

        // SNMP traffic now stored in SQLite - no need to load from JSON
        // Migration: uncomment below to migrate existing JSON data once
        // if (fs.existsSync(SNMP_TRAFFIC_FILE)) {
        //     databaseService.migrateFromJson();
        // }
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

function saveHosts() {
    try {
        fs.writeFileSync(HOSTS_FILE, JSON.stringify(monitoredHosts, null, 2));
    } catch (error) {
        console.error('Error saving hosts:', error);
    }
}

function saveLogs() {
    try {
        fs.writeFileSync(LOGS_FILE, JSON.stringify(statusLogs, null, 2));
    } catch (error) {
        console.error('Error saving logs:', error);
    }
}

function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (error) {
        console.error('Error saving users:', error);
    }
}

function saveTickets() {
    try {
        fs.writeFileSync(TICKETS_FILE, JSON.stringify({ tickets, counters: ticketCounters }, null, 2));
    } catch (error) {
        console.error('Error saving tickets:', error);
    }
}

function saveSettings() {
    try {
        const settings = {
            telegram: telegramConfig
        };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error('Error saving settings:', error);
    }
}

function saveHostGroups() {
    try {
        fs.writeFileSync(HOST_GROUPS_FILE, JSON.stringify(hostGroups, null, 2));
    } catch (error) {
        console.error('Error saving host groups:', error);
    }
}

function saveAuditLogs() {
    try {
        fs.writeFileSync(AUDIT_LOGS_FILE, JSON.stringify(auditLogs, null, 2));
    } catch (error) {
        console.error('Error saving audit logs:', error);
    }
}

// DEPRECATED: Traffic now saved to SQLite automatically
// function saveSnmpTraffic() {
//     try {
//         fs.writeFileSync(SNMP_TRAFFIC_FILE, JSON.stringify(snmpTraffic, null, 2));
//     } catch (error) {
//         console.error('Error saving SNMP traffic:', error);
//     }
// }

// Phase 2: Scheduled Maintenance Functions
function saveMaintenanceWindows() {
    try {
        fs.writeFileSync(MAINTENANCE_FILE, JSON.stringify(maintenanceWindows, null, 2));
    } catch (error) {
        console.error('Error saving maintenance windows:', error);
    }
}

/**
 * Check if a host is currently in a maintenance window
 * @param {string} hostId - Host ID to check
 * @returns {Object|null} - Active maintenance window or null
 */
function isHostInMaintenance(hostId) {
    const now = new Date();
    return maintenanceWindows.find(mw => {
        if (!mw.active) return false;
        const start = new Date(mw.startTime);
        const end = new Date(mw.endTime);
        const isInTimeRange = now >= start && now <= end;
        const isHostIncluded = mw.hostIds.includes(hostId) || mw.hostIds.includes('all');
        return isInTimeRange && isHostIncluded;
    }) || null;
}

// Phase 3: Push Notification Functions
function savePushSubscriptions() {
    try {
        fs.writeFileSync(PUSH_SUBSCRIPTIONS_FILE, JSON.stringify(pushSubscriptions, null, 2));
    } catch (error) {
        console.error('Error saving push subscriptions:', error);
    }
}

/**
 * Send push notification to all subscribers
 * @param {Object} payload - Notification payload {title, body, icon, url}
 */
async function sendPushNotificationToAll(payload) {
    if (pushSubscriptions.length === 0) {
        console.log('ðŸ“± No push subscribers');
        return;
    }

    const notificationPayload = JSON.stringify({
        title: payload.title || 'Network Monitor',
        body: payload.body || 'Notifikasi baru',
        icon: payload.icon || '/logo.png',
        url: payload.url || '/',
        tag: payload.tag || 'netmonitor-alert'
    });

    // Push delivery options for better reliability (especially iOS)
    // Topic must be max 32 characters and URL-safe
    const topic = (payload.tag || 'netmonitor-alert').substring(0, 32).replace(/[^a-zA-Z0-9_-]/g, '');
    const pushOptions = {
        TTL: 86400, // 24 hours - keep trying to deliver
        urgency: 'high', // Tell push service this is important
        topic: topic // Allows replacing notifications
    };

    const expiredSubscriptions = [];

    for (const subscription of pushSubscriptions) {
        try {
            await webpush.sendNotification(subscription, notificationPayload, pushOptions);
        } catch (error) {
            if (error.statusCode === 404 || error.statusCode === 410) {
                // Subscription expired or invalid
                expiredSubscriptions.push(subscription.endpoint);
                console.log('ðŸ“± Removing expired push subscription');
            } else {
                console.error('Push notification error:', error.message);
            }
        }
    }

    // Remove expired subscriptions
    if (expiredSubscriptions.length > 0) {
        pushSubscriptions = pushSubscriptions.filter(
            sub => !expiredSubscriptions.includes(sub.endpoint)
        );
        savePushSubscriptions();
    }

    console.log(`ðŸ“± Push notifications sent to ${pushSubscriptions.length} subscribers`);
}

// Phase 3: API Key Functions
function saveApiKeys() {
    try {
        fs.writeFileSync(API_KEYS_FILE, JSON.stringify(apiKeys, null, 2));
    } catch (error) {
        console.error('Error saving API keys:', error);
    }
}

function saveWebhooks() {
    try {
        fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(webhooks, null, 2));
    } catch (error) {
        console.error('Error saving webhooks:', error);
    }
}

/**
 * Generate a random API key
 */
function generateApiKey() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate API key from request header
 * @param {string} key - API key from X-API-Key header
 * @returns {Object|null} - API key object if valid, null otherwise
 */
function validateApiKey(key) {
    if (!key) return null;
    const apiKey = apiKeys.find(k => k.key === key && k.enabled);
    if (apiKey) {
        // Update last used timestamp
        apiKey.lastUsed = new Date().toISOString();
        saveApiKeys();
    }
    return apiKey;
}

/**
 * Middleware to require API key authentication
 */
function requireApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    const validKey = validateApiKey(apiKey);

    if (!validKey) {
        return res.status(401).json({ error: 'Invalid or missing API key' });
    }

    req.apiKey = validKey;
    next();
}

/**
 * Send webhook event to all configured webhooks
 * @param {string} eventType - Event type (host_down, host_up)
 * @param {Object} payload - Event data
 */
async function sendWebhookEvent(eventType, payload) {
    const activeWebhooks = webhooks.filter(w => w.enabled && w.events.includes(eventType));

    if (activeWebhooks.length === 0) {
        console.log(`ðŸ”— No webhooks configured for event: ${eventType}`);
        return;
    }

    const eventData = {
        event: eventType,
        timestamp: new Date().toISOString(),
        data: payload
    };

    for (const webhook of activeWebhooks) {
        try {
            // Create HMAC signature if secret is set
            let headers = { 'Content-Type': 'application/json' };
            if (webhook.secret) {
                const signature = crypto
                    .createHmac('sha256', webhook.secret)
                    .update(JSON.stringify(eventData))
                    .digest('hex');
                headers['X-Webhook-Signature'] = `sha256=${signature}`;
            }

            const response = await fetch(webhook.url, {
                method: 'POST',
                headers,
                body: JSON.stringify(eventData),
                timeout: 10000
            });

            if (response.ok) {
                console.log(`ðŸ”— Webhook sent successfully to ${webhook.name}: ${eventType}`);
                webhook.lastDelivery = { success: true, timestamp: new Date().toISOString() };
            } else {
                console.error(`ðŸ”— Webhook failed for ${webhook.name}: ${response.status}`);
                webhook.lastDelivery = { success: false, timestamp: new Date().toISOString(), error: `HTTP ${response.status}` };
            }
        } catch (error) {
            console.error(`ðŸ”— Webhook error for ${webhook.name}:`, error.message);
            webhook.lastDelivery = { success: false, timestamp: new Date().toISOString(), error: error.message };
        }
    }
    saveWebhooks();
}

/**
 * Add an audit log entry
 * @param {string} userId - User who performed the action
 * @param {string} username - Username for display
 * @param {string} action - Action type (login, logout, host_add, host_edit, host_delete, ticket_update, etc.)
 * @param {string} details - Human readable details
 * @param {Object} metadata - Additional data (optional)
 */
function addAuditLog(userId, username, action, details, metadata = {}) {
    const logEntry = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        userId,
        username,
        action,
        details,
        metadata,
        ip: metadata.ip || null
    };

    auditLogs.unshift(logEntry);

    // Trim to max size
    if (auditLogs.length > MAX_AUDIT_LOGS) {
        auditLogs = auditLogs.slice(0, MAX_AUDIT_LOGS);
    }

    saveAuditLogs();
    console.log(`ðŸ“ Audit: [${action}] ${username} - ${details}`);
}

function generateTicketId(source, incidentDate = null) {
    // Use incident date if provided (for manual tickets with custom createdAt), otherwise use current date
    const date = incidentDate ? new Date(incidentDate) : new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    ticketCounters[source]++;
    const counter = ticketCounters[source].toString().padStart(4, '0');
    const prefix = source === 'auto' ? 'AUTO' : 'TKT';
    return `${prefix}-${dateStr}-${counter}`;
}

function createTicket(hostId, hostName, hostCid, title, description, source, priority = 'medium', attachments = [], picId = null, picName = null, submitterId = null, submitterName = null, incidentDate = null) {
    // For ticket ID, use incident date if provided (manual tickets with custom time)
    const ticketIdDate = incidentDate || null;
    // For createdAt, use incident date if provided, otherwise current time
    const ticketCreatedAt = incidentDate || new Date().toISOString();

    const ticket = {
        id: Date.now().toString(),
        ticketId: generateTicketId(source, ticketIdDate),
        source,
        hostId,
        hostName,
        hostCid: hostCid || null,
        title,
        description,
        status: 'open',
        priority,
        picId: picId || null,       // Person In Charge ID
        picName: picName || null,   // Person In Charge Name
        submitterId: submitterId || null,
        submitterName: submitterName || null,
        attachments: attachments, // Array of image paths
        comments: [], // Activity log/comments
        createdAt: ticketCreatedAt,
        updatedAt: new Date().toISOString(),
        firstResponseAt: null,      // Waktu respon pertama NOC
        resolvedAt: null
    };
    tickets.unshift(ticket);
    saveTickets();
    broadcastSSE('ticket-created', ticket);
    return ticket;
}


function createDefaultAdmin() {
    // Default admin with forced password change
    // SECURITY: Use unique random ID instead of predictable 'admin'
    const adminId = crypto.randomUUID();
    const salt = bcrypt.genSaltSync(10);
    const password = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    const hash = bcrypt.hashSync(password, salt);
    users = [{
        id: adminId,
        username: 'admin',
        password: hash,
        role: 'admin',
        name: 'Super Admin',
        mustChangePassword: true // Force admin to change password on first login
    }];
    saveUsers();
    console.log(`âš ï¸ Created default admin user (ID: ${adminId}) - MUST CHANGE PASSWORD ON FIRST LOGIN`);
}

// ========================================
// Middleware
// ========================================

const requireAuth = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
};

const requireAdmin = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    // SECURITY: Check session role first (faster), fallback to user lookup
    if (req.session.userRole === 'admin') {
        return next();
    }
    // Fallback: lookup user if session role not set (legacy sessions)
    const user = users.find(u => u.id === req.session.userId);
    if (user && user.role === 'admin') {
        return next();
    }
    return res.status(403).json({ error: 'Forbidden' });
};

// SECURITY: Block all API access if user must change password
const requirePasswordChanged = (req, res, next) => {
    // Allow these endpoints even if password change is required
    // NOTE: Paths are relative to /api since middleware is mounted there
    const allowedPaths = ['/me', '/change-password', '/logout', '/login', '/events', '/host-groups', '/hosts/export', '/hosts/import', '/audit-logs'];

    if (allowedPaths.some(path => req.path === path || req.path.startsWith(path))) {
        return next();
    }

    if (!req.session || !req.session.userId) {
        return next(); // Not logged in, let other middleware handle
    }

    const user = users.find(u => u.id === req.session.userId);
    if (user && user.mustChangePassword === true) {
        return res.status(403).json({
            error: 'Anda harus mengganti password terlebih dahulu',
            mustChangePassword: true
        });
    }

    return next();
};

// Apply password change check to all API routes
app.use('/api', requirePasswordChanged);

// Load data on startup
loadData();

// ========================================
// Mount Modular Routes (Phase 3 Refactoring)
// ========================================
// Create middleware with dependency injection
const authMiddleware = createAuthMiddleware(() => users);

// Create route factories with dependencies
const authRoutes = createAuthRoutes({
    getUsers: () => users,
    saveUsers,
    addAuditLog,
    isStrongPassword,
    getPasswordStrengthError,
    middleware: authMiddleware
});

const userRoutes = createUserRoutes({
    getUsers: () => users,
    setUsers: (newUsers) => { users = newUsers; },
    saveUsers,
    isStrongPassword,
    getPasswordStrengthError,
    middleware: authMiddleware
});

// Mount routes
app.use('/api', authRoutes);  // /api/login, /api/logout, /api/me, /api/change-password
app.use('/api/users', userRoutes);  // /api/users/*, profile moved to /api/users/profile

const hostRoutes = createHostRoutes({
    getHosts: () => monitoredHosts,
    getPingHistory: () => pingHistory,
    saveHosts,
    isValidHost,
    getUsers: () => users,
    addAuditLog,
    broadcastSSE,
    middleware: authMiddleware
});
app.use('/api/hosts', hostRoutes);  // /api/hosts/*

const ticketRoutes = createTicketRoutes({
    getTickets: () => tickets,
    getHosts: () => monitoredHosts,
    getUsers: () => users,
    saveTickets,
    createTicket,
    addAuditLog,
    broadcastSSE,
    upload,
    middleware: authMiddleware
});
app.use('/api/tickets', ticketRoutes);  // /api/tickets/*

const snmpRoutes = createSnmpRoutes({
    getHosts: () => monitoredHosts,
    snmpService,
    databaseService,
    middleware: authMiddleware
});
app.use('/api/hosts', snmpRoutes);  // /api/hosts/:id/snmp/scan, /api/hosts/:id/snmp/history

const settingsRoutes = createSettingsRoutes({
    getTelegramConfig: () => telegramConfig,
    setTelegramConfig: (config) => { telegramConfig = config; },
    getProbeInterval: () => PROBE_INTERVAL,
    setProbeInterval: (interval) => { PROBE_INTERVAL = interval; },
    saveSettings,
    stopAutoPing,
    startAutoPing,
    getWafStats,
    middleware: authMiddleware
});
app.use('/api/settings', settingsRoutes);  // /api/settings, /api/settings/test-telegram
app.use('/api', settingsRoutes);  // /api/waf/stats (nested in settingsRoutes)

// Ping a single host
async function pingHost(host) {
    // SECURITY: Prevent Command Injection
    if (!isValidHost(host)) {
        return {
            host: host,
            alive: false,
            time: null,
            timestamp: new Date().toISOString(),
            error: 'Invalid Hostname/IP'
        };
    }

    try {
        const result = await ping.promise.probe(host, {
            timeout: PROBE_TIMEOUT,
            extra: ['-n', '1'] // Windows-specific: send 1 ping
        });

        return {
            host: host,
            alive: result.alive,
            time: result.time === 'unknown' ? null : parseFloat(result.time),
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            host: host,
            alive: false,
            time: null,
            timestamp: new Date().toISOString(),
            error: error.message
        };
    }
}

// Telegram Notification Queue Service with Rate Limiting
// Rate Limit: Max 20 messages per minute (Telegram API limit)
const telegramService = {
    queue: [],
    isProcessing: false,

    // Rate Limiting Configuration (20 messages per minute = 3 seconds between messages)
    maxMessagesPerMinute: 20,
    messageTimestamps: [],  // Track when messages were sent
    delayBetweenMessages: 3000, // 3 seconds between messages (60s / 20 = 3s)

    // Minimal Retry Configuration (avoid excessive retries)
    maxRetries: 2,          // Only 2 retries max to avoid spamming
    baseDelay: 5000,        // 5 seconds base delay for retry

    /**
     * Check if we can send a message (rate limit check)
     * @returns {boolean} true if within rate limit
     */
    canSendMessage: function () {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        // Clean up old timestamps
        this.messageTimestamps = this.messageTimestamps.filter(ts => ts > oneMinuteAgo);

        // Check if within limit
        return this.messageTimestamps.length < this.maxMessagesPerMinute;
    },

    /**
     * Get wait time before next message can be sent
     * @returns {number} Milliseconds to wait
     */
    getWaitTime: function () {
        if (this.messageTimestamps.length === 0) return 0;

        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        // Clean up old timestamps
        this.messageTimestamps = this.messageTimestamps.filter(ts => ts > oneMinuteAgo);

        if (this.messageTimestamps.length < this.maxMessagesPerMinute) {
            return this.delayBetweenMessages;
        }

        // Calculate when the oldest message will expire from the window
        const oldestTimestamp = Math.min(...this.messageTimestamps);
        const waitTime = (oldestTimestamp + 60000) - now + 1000; // Add 1s buffer

        return Math.max(waitTime, this.delayBetweenMessages);
    },

    enqueue: function (message) {
        // Prevent duplicate messages in queue to avoid spamming during flapping
        const isDuplicate = this.queue.some(item => item.message === message);
        if (!isDuplicate) {
            // Limit queue size to prevent memory issues during outages
            if (this.queue.length >= 50) {
                console.warn('âš ï¸ Telegram queue full (50), dropping oldest message');
                this.queue.shift(); // Remove oldest
            }
            this.queue.push({ message, retries: 0, addedAt: Date.now() });
            console.log(`ðŸ“¬ Telegram queue: ${this.queue.length} message(s) pending`);
            this.processQueue();
        } else {
            console.log('ðŸ“¬ Duplicate message skipped');
        }
    },

    processQueue: async function () {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;

        // Check rate limit before processing
        if (!this.canSendMessage()) {
            const waitTime = this.getWaitTime();
            console.log(`â³ Rate limit: waiting ${Math.round(waitTime / 1000)}s before sending (${this.messageTimestamps.length}/${this.maxMessagesPerMinute} in last minute)`);

            setTimeout(() => {
                this.isProcessing = false;
                this.processQueue();
            }, waitTime);
            return;
        }

        const currentItem = this.queue[0]; // Peek

        // Skip stale messages (older than 5 minutes)
        if (Date.now() - currentItem.addedAt > 300000) {
            console.warn('âš ï¸ Dropping stale message (>5 min old)');
            this.queue.shift();
            this.isProcessing = false;
            this.processQueue();
            return;
        }

        try {
            await this.sendRequest(currentItem.message);

            // Success: Record timestamp and remove from queue
            this.messageTimestamps.push(Date.now());
            this.queue.shift();

            if (this.queue.length > 0) {
                console.log(`ðŸ“¬ Telegram queue: ${this.queue.length} message(s) remaining`);
            }

            // Wait before next message
            setTimeout(() => {
                this.isProcessing = false;
                this.processQueue();
            }, this.delayBetweenMessages);

        } catch (error) {
            console.error('Telegram Send Error:', error.message);

            if (error.status === 429) {
                // Rate limited by Telegram - Use their retry_after value, NO retry increment
                const retryAfter = (error.retryAfter || 60) * 1000;
                console.warn(`âš ï¸ Telegram Rate Limit (429)! Pausing for ${retryAfter / 1000}s`);

                setTimeout(() => {
                    this.isProcessing = false;
                    this.processQueue(); // Retry same item without incrementing retry count
                }, retryAfter + 2000); // Add 2s buffer

            } else {
                // Other error - Limited retry
                currentItem.retries++;

                if (currentItem.retries >= this.maxRetries) {
                    console.error(`âŒ Max retries (${this.maxRetries}) reached, dropping notification`);
                    this.queue.shift(); // Drop it immediately
                    this.isProcessing = false;

                    // Short delay before next
                    setTimeout(() => {
                        this.processQueue();
                    }, 1000);
                } else {
                    // Simple fixed delay retry (no exponential to avoid long waits)
                    console.warn(`ðŸ”„ Retry ${currentItem.retries}/${this.maxRetries} in ${this.baseDelay / 1000}s`);

                    setTimeout(() => {
                        this.isProcessing = false;
                        this.processQueue();
                    }, this.baseDelay);
                }
            }
        }
    },

    sendRequest: function (message) {
        if (!telegramConfig.botToken || !telegramConfig.chatId) {
            return Promise.resolve(); // Not configured
        }

        return new Promise((resolve, reject) => {
            // Use GET with URL-encoded parameters (like MikroTik The Dude)
            const params = new URLSearchParams({
                chat_id: telegramConfig.chatId,
                text: message,
                parse_mode: 'Markdown'
            });

            const options = {
                hostname: 'api.telegram.org',
                port: 443,
                path: `/bot${telegramConfig.botToken}/sendMessage?${params.toString()}`,
                method: 'GET',
                timeout: 10000 // 10 second timeout
            };

            const req = https.request(options, (res) => {
                let responseBody = '';

                res.on('data', chunk => responseBody += chunk);

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        console.log('âœ… Telegram notification sent');
                        resolve();
                    } else {
                        const error = new Error(`Telegram API: ${res.statusCode}`);
                        error.status = res.statusCode;

                        // Parse retry_after if available
                        try {
                            const body = JSON.parse(responseBody);
                            if (body.parameters && body.parameters.retry_after) {
                                error.retryAfter = body.parameters.retry_after;
                            }
                            console.error('Telegram error:', body.description);
                        } catch (e) { /* ignore parse error */ }

                        reject(error);
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.on('error', (err) => reject(err));
            req.end();
        });
    },

    // Get queue status for debugging
    getStatus: function () {
        return {
            queueLength: this.queue.length,
            isProcessing: this.isProcessing,
            messagesLastMinute: this.messageTimestamps.filter(ts => ts > Date.now() - 60000).length,
            maxPerMinute: this.maxMessagesPerMinute
        };
    }
};

// Wrapper for backward compatibility with existing code
function sendTelegramNotification(message) {
    telegramService.enqueue(message);
    return Promise.resolve(); // Return promise to satisfy existing await calls, though it's fire-and-forget now
}

// ... (other code) ...

// Start auto ping (Recursive setTimeout pattern)
function startAutoPing() {
    if (autoPingInterval) {
        clearTimeout(autoPingInterval); // Clear any existing timeout
    }

    // Initial call
    const runPingLoop = async () => {
        if (!autoPingEnabled) return;

        try {
            await autoPingAllHosts();
        } catch (err) {
            console.error('Error in auto-ping loop:', err);
        }

        // Schedule next run only after current one finishes
        if (autoPingEnabled) {
            autoPingInterval = setTimeout(runPingLoop, PROBE_INTERVAL);
        }
    };

    runPingLoop();
    console.log(`ðŸ”„ Auto-ping started (every ${PROBE_INTERVAL / 1000} seconds, ${PROBE_DOWN_COUNT} failures to mark offline)`);
}

// Stop auto ping
function stopAutoPing() {
    if (autoPingInterval) {
        clearTimeout(autoPingInterval); // Change clearInterval to clearTimeout
        autoPingInterval = null;
    }
    console.log('â¹ï¸ Auto-ping stopped');
}

// Send SSE event to all connected clients
function broadcastSSE(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => {
        client.write(message);
    });
}

// Process SNMP Traffic Data - Now uses SQLite via databaseService
function processTrafficData(hostId, data) {
    // Get previous entry from database for rate calculation
    const prev = databaseService.getLastTrafficEntry(hostId);

    let traffic_in = 0;
    let traffic_out = 0;

    if (prev) {
        const timeDiff = (data.timestamp - prev.timestamp) / 1000; // seconds

        // Only calculate if time diff is reasonable (between 0 and 5 minutes)
        if (timeDiff > 0 && timeDiff < 300) {
            let inDiff = data.inOctets - prev.inOctets;
            let outDiff = data.outOctets - prev.outOctets;

            // Handle counter wrap-around
            const wrapValue = data.inOctets > 4294967296 ? Number.MAX_SAFE_INTEGER : 4294967296;

            if (inDiff < 0) inDiff += wrapValue;
            if (outDiff < 0) outDiff += wrapValue;

            // Calculate Mbps
            traffic_in = parseFloat(((inDiff * 8) / timeDiff / 1000000).toFixed(4));
            traffic_out = parseFloat(((outDiff * 8) / timeDiff / 1000000).toFixed(4));

            // Sanity check - cap at realistic maximum (10 Gbps = 10000 Mbps)
            const MAX_REALISTIC_MBPS = 10000;
            if (traffic_in < 0) traffic_in = 0;
            if (traffic_out < 0) traffic_out = 0;

            if (traffic_in > MAX_REALISTIC_MBPS) traffic_in = MAX_REALISTIC_MBPS;
            if (traffic_out > MAX_REALISTIC_MBPS) traffic_out = MAX_REALISTIC_MBPS;
        }
    }

    const entry = {
        timestamp: data.timestamp,
        inOctets: data.inOctets,
        outOctets: data.outOctets,
        traffic_in,
        traffic_out
    };

    // Store in SQLite database
    databaseService.storeTrafficEntry(hostId, entry);

    // Return the entry for immediate use
    return entry;
}

// Auto ping all hosts
async function autoPingAllHosts() {
    if (monitoredHosts.length === 0) return;

    const alerts = [];

    for (const hostData of monitoredHosts) {
        const previousStatus = hostData.status;
        const result = await pingHost(hostData.host);

        // Initialize failure counter if not exists
        if (hostFailureCount[hostData.id] === undefined) {
            hostFailureCount[hostData.id] = 0;
        }

        // Track consecutive failures
        if (!result.alive) {
            hostFailureCount[hostData.id]++;
        } else {
            hostFailureCount[hostData.id] = 0; // Reset on success
        }

        // Determine status: only mark offline after PROBE_DOWN_COUNT failures
        let newStatus;
        if (result.alive) {
            newStatus = 'online';
        } else if (hostFailureCount[hostData.id] >= PROBE_DOWN_COUNT) {
            newStatus = 'offline';
        } else {
            // Keep previous status during failure accumulation
            newStatus = previousStatus === 'offline' ? 'offline' : 'online';
        }

        hostData.status = newStatus;
        hostData.latency = result.time;
        hostData.lastCheck = result.timestamp;
        hostData.failureCount = hostFailureCount[hostData.id];

        // Store in history (keep last 100 entries)
        if (!pingHistory[hostData.id]) {
            pingHistory[hostData.id] = [];
        }
        pingHistory[hostData.id].unshift(result);
        if (pingHistory[hostData.id].length > 100) pingHistory[hostData.id].pop();

        // POLL SNMP if enabled and online
        if (hostData.snmpEnabled && newStatus === 'online' && hostData.snmpInterface) {
            try {
                const traffic = await snmpService.getInterfaceTraffic(
                    hostData.host,
                    hostData.snmpCommunity || 'public',
                    hostData.snmpInterface,
                    hostData.snmpVersion || '2c'
                );
                const trafficEntry = processTrafficData(hostData.id, traffic);

                // Update realtime status on host object for UI
                if (trafficEntry) {
                    hostData.traffic = {
                        traffic_in: trafficEntry.traffic_in,   // Mbps
                        traffic_out: trafficEntry.traffic_out, // Mbps
                        lastUpdate: trafficEntry.timestamp
                    };
                }
            } catch (err) {
                // Log only warning to avoid clutter
                console.warn(`SNMP Warning for ${hostData.name}:`, err.message);
            }
        }
        if (pingHistory[hostData.id].length > 8640) {
            pingHistory[hostData.id].pop();
        }

        // Check for status change - Host went DOWN
        if (previousStatus === 'online' && newStatus === 'offline') {
            const logEntry = {
                id: `${Date.now()}-${hostData.id}`,
                timestamp: result.timestamp,
                hostId: hostData.id,
                hostName: hostData.name,
                host: hostData.host,
                type: 'down'
            };
            statusLogs.unshift(logEntry);
            if (statusLogs.length > MAX_LOGS) statusLogs.pop();
            saveLogs(); // Persist to file

            // Track when host first went down
            hostDownSince[hostData.id] = Date.now();
            hostTicketCreated[hostData.id] = false;
            console.log(`â±ï¸ Host ${hostData.name} went down, waiting 2 minutes before creating ticket...`);

            // Send Telegram Notification immediately (unless in maintenance)
            const maintenanceDown = isHostInMaintenance(hostData.id);
            if (maintenanceDown) {
                console.log(`ðŸ”§ Host ${hostData.name} is in maintenance - suppressing down notification`);
            } else {
                await sendTelegramNotification(`ðŸ”´ Host Offline\n\nHost: ${hostData.name} (CID: ${hostData.cid})\nIP: ${hostData.host}\nTime: ${new Date(result.timestamp).toLocaleString()}`);
                // Also send push notification with unique tag
                await sendPushNotificationToAll({
                    title: 'ðŸ”´ Host Offline',
                    body: `${hostData.name} (${hostData.host}) is down`,
                    tag: `host-down-${hostData.id}-${Date.now()}`
                });
                // Send webhook event
                await sendWebhookEvent('host_down', {
                    hostId: hostData.id,
                    hostName: hostData.name,
                    host: hostData.host,
                    cid: hostData.cid || null,
                    timestamp: result.timestamp
                });
            }

            alerts.push({
                type: 'down',
                host: hostData.host,
                name: hostData.name,
                timestamp: result.timestamp,
                inMaintenance: maintenanceDown !== null
            });
        }

        // Check if host has been down for 2 minutes and ticket not yet created
        if (newStatus === 'offline' && hostDownSince[hostData.id] && !hostTicketCreated[hostData.id]) {
            const downDuration = Date.now() - hostDownSince[hostData.id];
            if (downDuration >= TICKET_DELAY) {
                // Check maintenance status before creating ticket
                const maintenanceTicket = isHostInMaintenance(hostData.id);
                if (maintenanceTicket) {
                    console.log(`ðŸ”§ Host ${hostData.name} is in maintenance - skipping auto-ticket creation`);
                    hostTicketCreated[hostData.id] = true; // Mark as "handled" to avoid repeated checks
                } else {
                    // Host has been down for 2 minutes, create ticket now
                    console.log(`ðŸŽ« Host ${hostData.name} still down after 2 minutes - creating ticket`);
                    createTicket(
                        hostData.id,
                        hostData.name,
                        hostData.cid,
                        `Host Down - ${hostData.name}`, // Title
                        `Host ${hostData.name} (${hostData.host}) has been offline for more than 2 minutes. Auto-ticket created.`, // Description
                        'auto', // Source
                        'high' // Priority
                    );
                    hostTicketCreated[hostData.id] = true;

                    // Send additional Telegram notification about ticket creation
                    await sendTelegramNotification(`ðŸŽ« Tiket Otomatis Dibuat\n\nHost: ${hostData.name} (CID: ${hostData.cid})\nAlasan: Host down lebih dari 2 menit`);
                }
            }
        }

        // Check for status change - Host came back UP
        if (previousStatus === 'offline' && newStatus === 'online') {
            const logEntry = {
                id: `${Date.now()}-${hostData.id}`,
                timestamp: result.timestamp,
                hostId: hostData.id,
                hostName: hostData.name,
                host: hostData.host,
                type: 'up'
            };
            statusLogs.unshift(logEntry);
            if (statusLogs.length > MAX_LOGS) statusLogs.pop();
            saveLogs(); // Persist to file

            // Reset down tracking - host is back online
            const wasTicketCreated = hostTicketCreated[hostData.id];
            delete hostDownSince[hostData.id];
            delete hostTicketCreated[hostData.id];

            if (!wasTicketCreated) {
                console.log(`âœ… Host ${hostData.name} recovered before 2 minutes - no ticket created`);
            }

            // Send Telegram Notification (unless in maintenance)
            const maintenanceUp = isHostInMaintenance(hostData.id);
            if (maintenanceUp) {
                console.log(`ðŸ”§ Host ${hostData.name} is in maintenance - suppressing up notification`);
            } else {
                await sendTelegramNotification(`ðŸŸ¢ Host Online\n\nHost: ${hostData.name} (CID: ${hostData.cid})\nIP: ${hostData.host}\nLatency: ${result.time}ms`);
                // Also send push notification with unique tag
                await sendPushNotificationToAll({
                    title: 'ðŸŸ¢ Host Online',
                    body: `${hostData.name} is back online (${result.time}ms)`,
                    tag: `host-up-${hostData.id}-${Date.now()}`
                });
                // Send webhook event
                await sendWebhookEvent('host_up', {
                    hostId: hostData.id,
                    hostName: hostData.name,
                    host: hostData.host,
                    cid: hostData.cid || null,
                    latency: result.time,
                    timestamp: result.timestamp
                });
            }

            alerts.push({
                type: 'up',
                host: hostData.host,
                name: hostData.name,
                latency: result.time,
                timestamp: result.timestamp,
                inMaintenance: maintenanceUp !== null
            });
        }
    }

    // Broadcast updates to all clients
    broadcastSSE('hosts-update', monitoredHosts);

    // Send alerts if any
    if (alerts.length > 0) {
        broadcastSSE('alerts', alerts);
    }

    // SQLite handles traffic persistence automatically via databaseService
    // saveSnmpTraffic(); // DEPRECATED
}

// Start auto ping
// Start auto ping (Recursive setTimeout pattern)
function startAutoPing() {
    if (autoPingInterval) {
        clearTimeout(autoPingInterval);
        autoPingInterval = null;
    }

    // Definition of the recursive loop
    const runPingLoop = async () => {
        if (!autoPingEnabled) return;

        try {
            await autoPingAllHosts();
        } catch (err) {
            console.error('Error in auto-ping loop:', err);
        }

        // Schedule next run only after current one finishes
        if (autoPingEnabled) {
            autoPingInterval = setTimeout(runPingLoop, PROBE_INTERVAL);
        }
    };

    // Start immediately
    runPingLoop();
    console.log(`ðŸ”„ Auto-ping started (every ${PROBE_INTERVAL / 1000} seconds, ${PROBE_DOWN_COUNT} failures to mark offline)`);
}

// Stop auto ping
function stopAutoPing() {
    if (autoPingInterval) {
        clearTimeout(autoPingInterval); // Change to clearTimeout
        autoPingInterval = null;
    }
    console.log('â¹ï¸ Auto-ping stopped');
}

// SSE endpoint for real-time updates (SECURED)
app.get('/api/events', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // SECURITY: Don't set Access-Control-Allow-Origin manually, let CORS middleware handle it

    // Send initial data
    res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to server' })}\n\n`);
    res.write(`event: hosts-update\ndata: ${JSON.stringify(monitoredHosts)}\n\n`);
    res.write(`event: auto-ping-status\ndata: ${JSON.stringify({ enabled: autoPingEnabled })}\n\n`);

    // Add client to list
    sseClients.push(res);
    console.log(`ðŸ“¡ Client connected (User: ${req.session.userId}). Total clients: ${sseClients.length}`);

    // Remove client on disconnect
    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
        console.log(`ðŸ“¡ Client disconnected. Total clients: ${sseClients.length}`);
    });
});

// Protect API Routes
app.use('/api/auto-ping', requireAuth);
app.use('/api/hosts', requireAuth);
app.use('/api/logs', requireAuth);

// API: Toggle auto-ping
app.post('/api/auto-ping/toggle', (req, res) => {
    autoPingEnabled = !autoPingEnabled;

    if (autoPingEnabled) {
        startAutoPing();
    } else {
        stopAutoPing();
    }

    broadcastSSE('auto-ping-status', { enabled: autoPingEnabled });
    res.json({ enabled: autoPingEnabled });
});

// API: Get auto-ping status
app.get('/api/auto-ping/status', (req, res) => {
    res.json({ enabled: autoPingEnabled });
});

// ========================================
// Host Routes - DEPRECATED: Moved to routes/hostRoutes.js
// ========================================
/*
/* START DEPRECATED HOST CRUD ROUTES - Preserved for reference

app.get('/api/hosts', (req, res) => {
    res.json(monitoredHosts);
});

// API: Add a new host to monitor
app.post('/api/hosts', (req, res) => {
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

    // NOTE: IP/Hostname duplicates are ALLOWED to support multiple locations with same public IP
    // Each location is differentiated by unique Name and CID

    // Check if name already exists
    if (name && name.trim()) {
        const existingName = monitoredHosts.find(h => h.name.toLowerCase() === name.toLowerCase().trim());
        if (existingName) {
            return res.status(400).json({ error: `Nama host '${name}' sudah digunakan (IP: ${existingName.host})` });
        }
    }

    // Check if CID already exists (if provided)
    if (cid && cid.trim()) {
        const existingCid = monitoredHosts.find(h => h.cid === cid);
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
        // SNMP Configuration
        snmpEnabled: snmpEnabled || false,
        snmpCommunity: snmpCommunity || 'public',
        snmpVersion: snmpVersion || '2c',
        snmpInterface: snmpInterface || null,
        snmpInterfaceName: snmpInterfaceName || null,
        traffic: null
    };

    monitoredHosts.push(newHost);
    pingHistory[newHost.id] = [];
    saveHosts(); // Persist to file

    // Audit log for host creation
    const user = users.find(u => u.id === req.session?.userId);
    addAuditLog(req.session?.userId || 'system', user?.username || 'anonymous', 'host_add', `Added host: ${newHost.name} (${newHost.host})`, { hostId: newHost.id });

    // Broadcast new host to all clients
    broadcastSSE('host-added', newHost);

    res.status(201).json(newHost);
});

// API: Update host location
app.put('/api/hosts/:id/location', (req, res) => {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    const hostData = monitoredHosts.find(h => h.id === id);
    if (!hostData) {
        return res.status(404).json({ error: 'Host not found' });
    }

    hostData.latitude = latitude;
    hostData.longitude = longitude;
    saveHosts(); // Persist to file

    // Broadcast update to all clients
    broadcastSSE('hosts-update', monitoredHosts);

    res.json(hostData);
});

// API: Update host details
app.put('/api/hosts/:id', (req, res) => {
    const { id } = req.params;
    const {
        name, host, cid, groupId, latitude, longitude,
        snmpEnabled, snmpCommunity, snmpVersion, snmpInterface, snmpInterfaceName
    } = req.body;

    console.log(`[DEBUG] Update Host Request for ${id}: Name=${name}, SNMP Enabled=${snmpEnabled}, Interface=${snmpInterface}`);

    const hostData = monitoredHosts.find(h => h.id === id);
    if (!hostData) {
        return res.status(404).json({ error: 'Host not found' });
    }

    // Update fields
    // Check if name is being changed to an existing name
    if (name !== undefined && name.trim() && name.toLowerCase().trim() !== hostData.name.toLowerCase()) {
        const existingName = monitoredHosts.find(h => h.id !== id && h.name.toLowerCase() === name.toLowerCase().trim());
        if (existingName) {
            return res.status(400).json({ error: `Nama host '${name}' sudah digunakan (IP: ${existingName.host})` });
        }
        hostData.name = name;
    } else if (name !== undefined) {
        hostData.name = name;
    }

    // NOTE: IP/Hostname duplicates are ALLOWED to support multiple locations with same public IP
    if (host !== undefined && host !== hostData.host) {
        hostData.host = host;
    }

    // Check if CID is being changed to an existing one
    if (cid !== undefined && cid !== hostData.cid) {
        if (cid && cid.trim()) {
            const existingCid = monitoredHosts.find(h => h.id !== id && h.cid === cid);
            if (existingCid) {
                return res.status(400).json({ error: `CID '${cid}' sudah terdaftar untuk host '${existingCid.name}'` });
            }
        }
        hostData.cid = cid;
    }

    // Update group assignment
    if (groupId !== undefined) {
        hostData.groupId = groupId || null;
    }

    // Update coordinates
    if (latitude !== undefined) hostData.latitude = latitude;
    if (longitude !== undefined) hostData.longitude = longitude;

    // Update SNMP Configuration
    if (snmpEnabled !== undefined) hostData.snmpEnabled = snmpEnabled;
    if (snmpCommunity !== undefined) hostData.snmpCommunity = snmpCommunity;
    if (snmpVersion !== undefined) hostData.snmpVersion = snmpVersion;
    if (snmpInterface !== undefined) hostData.snmpInterface = snmpInterface;
    if (snmpInterfaceName !== undefined) hostData.snmpInterfaceName = snmpInterfaceName;

    saveHosts(); // Persist to file

    // Audit log for host edit
    const user = users.find(u => u.id === req.session?.userId);
    addAuditLog(req.session?.userId || 'system', user?.username || 'anonymous', 'host_edit', `Edited host: ${hostData.name}`, { hostId: id });

    // Broadcast update to all clients
    broadcastSSE('hosts-update', monitoredHosts);

    res.json(hostData);
});

END DEPRECATED HOST CRUD ROUTES */

// DEPRECATED: SNMP routes moved to routes/snmpRoutes.js
/*
app.post('/api/hosts/:id/snmp/scan', requireAuth, async (req, res) => {
    try {
        const hostData = monitoredHosts.find(h => h.id === req.params.id);
        if (!hostData) return res.status(404).json({ error: 'Host not found' });

        const community = req.body.community || hostData.snmpCommunity || 'public';
        const version = req.body.version || hostData.snmpVersion || '2c';

        console.log(`ðŸ” Scanning interfaces for ${hostData.name} (${hostData.host})...`);
        const interfaces = await snmpService.getInterfaces(hostData.host, community, version);
        res.json(interfaces);
    } catch (error) {
        console.error('SNMP Scan Error:', error.message);
        res.status(500).json({ error: 'Failed to scan interfaces: ' + error.message });
    }
});

app.get('/api/hosts/:id/snmp/history', requireAuth, (req, res) => {
    const hostId = req.params.id;
    const history = databaseService.getTrafficHistory(hostId, 500);
    res.json({ history });
});
END DEPRECATED SNMP ROUTES */

// API: Get status change logs
app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json(statusLogs.slice(0, limit));
});

// ========================================
// WAF & Settings Routes - DEPRECATED: Moved to routes/settingsRoutes.js
// ========================================
/*
/* START DEPRECATED WAF/SETTINGS ROUTES - Preserved for reference

app.get('/api/waf/stats', requireAdmin, (req, res) => {
    res.json(getWafStats());
});

app.get('/api/settings', requireAdmin, (req, res) => {
    // Hide token for security if needed, but for now sending it back so user can see what's set
    res.json({
        telegram: telegramConfig,
        pingInterval: PROBE_INTERVAL / 1000 // Send in seconds
    });
});

app.post('/api/settings', requireAdmin, (req, res) => {
    const { telegram, pingInterval } = req.body;

    if (telegram) {
        telegramConfig = {
            botToken: telegram.botToken || '',
            chatId: telegram.chatId || ''
        };
    }

    if (pingInterval) {
        const newInterval = parseInt(pingInterval) * 1000;
        if (newInterval >= 1000 && newInterval !== PROBE_INTERVAL) {
            PROBE_INTERVAL = newInterval;
            // Restart auto ping with new interval
            stopAutoPing();
            startAutoPing();
        }
    }

    saveSettings();
    res.json({
        message: 'Settings saved',
        telegram: telegramConfig,
        pingInterval: PROBE_INTERVAL / 1000
    });
});

// API: Test Telegram Notification
app.post('/api/settings/test-telegram', requireAdmin, (req, res) => {
    const { botToken, chatId } = req.body;

    // Use provided credentials or stored ones
    const tokenToUse = botToken || telegramConfig.botToken;
    const chatToUse = chatId || telegramConfig.chatId;

    if (!tokenToUse || !chatToUse) {
        return res.status(400).json({ error: 'Bot Token and Chat ID are required' });
    }

    // Use GET with URL-encoded parameters (like MikroTik The Dude)
    const params = new URLSearchParams({
        chat_id: chatToUse,
        text: 'ðŸ”” *Network Monitor Test Notification*\n\nThis is a test message from your Network Monitor.',
        parse_mode: 'Markdown'
    });

    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${tokenToUse}/sendMessage?${params.toString()}`,
        method: 'GET'
    };

    const request = https.request(options, (response) => {
        let responseBody = '';

        response.on('data', (chunk) => {
            responseBody += chunk;
        });

        response.on('end', () => {
            if (response.statusCode === 200) {
                res.json({ success: true, message: 'Test message sent successfully' });
            } else {
                try {
                    const errorData = JSON.parse(responseBody);
                    res.status(400).json({ error: `Telegram API Error: ${errorData.description}` });
                } catch (e) {
                    res.status(400).json({ error: `Telegram API Error: Status ${response.statusCode}` });
                }
            }
        });
    });

    request.on('error', (error) => {
        res.status(500).json({ error: 'Network error connecting to Telegram API' });
    });

    request.end(); // No body for GET request
});

END DEPRECATED WAF/SETTINGS ROUTES */

// ========================================
// Ticket API Routes - DEPRECATED: Moved to routes/ticketRoutes.js
// ========================================
/*
/* START DEPRECATED TICKET ROUTES - Preserved for reference

app.get('/api/tickets', requireAuth, (req, res) => {
    res.json(tickets);
});

// API: Export tickets to Excel
app.get('/api/tickets/export', requireAuth, (req, res) => {
    try {
        // Filter tickets if needed (defaults to all)
        // You can add query params for date filtering here if requested later
        const dataToExport = tickets.map(t => {
            // Calculate durations
            const start = new Date(t.createdAt);
            const end = t.resolvedAt ? new Date(t.resolvedAt) : null;
            const firstResp = t.firstResponseAt ? new Date(t.firstResponseAt) : null;

            let duration = '-';
            if (end) {
                const diffMs = end - start;
                const diffMins = Math.floor(diffMs / 60000);
                const hrs = Math.floor(diffMins / 60);
                const mins = diffMins % 60;
                duration = `${hrs}h ${mins}m`;
            }

            let responseTime = '-';
            if (firstResp) {
                const diffMs = firstResp - start;
                const diffMins = Math.floor(diffMs / 60000);
                const hrs = Math.floor(diffMins / 60);
                const mins = diffMins % 60;
                responseTime = `${hrs}h ${mins}m`;
            }

            // Format comments
            const actionResolution = t.comments && t.comments.length > 0
                ? t.comments.map(c => `[${new Date(c.createdAt).toLocaleString()}] ${c.authorName}: ${c.text}`).join('\n')
                : '';

            return {
                'No': t.ticketId || t.id,
                'Issue / Task': t.title,
                'Customer Name': t.hostName || 'Unknown',
                'Date / Start Time': new Date(t.createdAt).toLocaleString(),
                'Ticket': t.id,
                'Status': t.status.toUpperCase(),
                'Date / Respond Time': t.firstResponseAt ? new Date(t.firstResponseAt).toLocaleString() : '-',
                'Date / End Time': t.resolvedAt ? new Date(t.resolvedAt).toLocaleString() : '-',
                'Duration': duration,
                'Respond Time': responseTime,
                'On Duty': t.submitterName || 'System',
                'Resolved By': t.resolverName || '-',
                'Information / Root Cause': t.description,
                'Action / Resolution': actionResolution
            };
        });

        // Create workbook
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.json_to_sheet(dataToExport);

        // Adjust column widths (approximate)
        const wscols = [
            { wch: 15 }, // No
            { wch: 30 }, // Issue
            { wch: 20 }, // Customer
            { wch: 20 }, // Start
            { wch: 15 }, // Ticket
            { wch: 10 }, // Status
            { wch: 20 }, // Date Resp
            { wch: 20 }, // Date End
            { wch: 10 }, // Duration
            { wch: 10 }, // Resp Time
            { wch: 15 }, // On Duty
            { wch: 15 }, // Resolved By
            { wch: 40 }, // Info
            { wch: 50 }, // Action
        ];
        ws['!cols'] = wscols;

        xlsx.utils.book_append_sheet(wb, ws, 'Tickets');

        // Write to buffer
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // Send headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Tickets_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);
        res.send(buffer);

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Failed to export tickets' });
    }
});

// API: Create ticket manually (with optional image uploads)
app.post('/api/tickets', requireAuth, upload.array('images', 5), (req, res) => {
    const { hostId, title, description, priority, picName, createdAt, firstResponseAt } = req.body;

    if (!title) {
        return res.status(400).json({ error: 'Title is required' });
    }

    let hostName = 'Unknown';
    let hostCid = null;

    if (hostId) {
        const host = monitoredHosts.find(h => h.id === hostId);
        if (host) {
            hostName = host.name;
            hostCid = host.cid;
        }
    }

    // Get uploaded file paths
    const attachments = req.files ? req.files.map(f => '/uploads/' + f.filename) : [];

    // Get submitter info
    let submitterId = null;
    let submitterName = null;
    if (req.session && req.session.userId) {
        const user = users.find(u => u.id === req.session.userId);
        if (user) {
            submitterId = user.id;
            submitterName = user.name;
        }
    }

    const ticket = createTicket(
        hostId || null,
        hostName,
        hostCid,
        title,
        description || '',
        'manual',
        priority || 'medium',
        attachments,
        null, // picId not used anymore
        picName || null,
        submitterId,
        submitterName,
        createdAt || null // Pass incident date for ticket ID generation
    );

    // Update firstResponseAt if provided (for manual entry)
    if (firstResponseAt) {
        ticket.firstResponseAt = firstResponseAt;
        saveTickets();
        broadcastSSE('ticket-updated', ticket);
    }

    // Audit log for ticket creation
    const user = users.find(u => u.id === req.session?.userId);
    addAuditLog(req.session?.userId || 'system', user?.username || 'anonymous', 'ticket_create', `Created ticket: ${ticket.ticketId}`, { ticketId: ticket.id });

    res.status(201).json(ticket);
});


// API: Update ticket
app.put('/api/tickets/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    console.log(`[DEBUG] Update Ticket ${id} Payload:`, req.body);
    const { status, priority, description, picName, createdAt, firstResponseAt } = req.body;

    const ticket = tickets.find(t => t.id === id);
    if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
    }

    const previousStatus = ticket.status; // Capture previous status before potential change

    if (status !== undefined) {
        ticket.status = status;

        // Set firstResponseAt saat pertama kali ada respon (status berubah dari open)
        // Hanya jika firstResponseAt belum diset secara manual
        if (previousStatus === 'open' && (status === 'in_progress' || status === 'resolved')) {
            if (!ticket.firstResponseAt && !firstResponseAt) {
                ticket.firstResponseAt = new Date().toISOString();
            }
        }

        if (status === 'resolved') {
            // Jika langsung resolve tanpa pernah in_progress, set firstResponseAt juga
            if (!ticket.firstResponseAt && !firstResponseAt) {
                ticket.firstResponseAt = new Date().toISOString();
            }
            // Set default resolvedAt if not present and not provided manually
            if (!ticket.resolvedAt && !req.body.resolvedAt) {
                ticket.resolvedAt = new Date().toISOString();
            }
        }
    }
    if (priority !== undefined) ticket.priority = priority;
    if (description !== undefined) ticket.description = description;

    // Update PIC name if provided
    if (picName !== undefined) {
        ticket.picName = picName || null;
    }

    // Update createdAt hanya untuk tiket manual (bukan auto-generated)
    if (createdAt !== undefined && ticket.source !== 'auto') {
        ticket.createdAt = createdAt;
    }

    // Update firstResponseAt jika disediakan (manual input)
    if (firstResponseAt !== undefined) {
        ticket.firstResponseAt = firstResponseAt || null;
    }

    // Update resolvedAt jika disediakan (manual input) - HANYA jika status resolved
    if (req.body.resolvedAt !== undefined && ticket.status === 'resolved') {
        ticket.resolvedAt = req.body.resolvedAt || null;
    }

    // Capture Resolver Info if status changed to resolved
    if (status === 'resolved' && previousStatus !== 'resolved') {
        if (req.session && req.session.userId) {
            const user = users.find(u => u.id === req.session.userId);
            if (user) {
                ticket.resolverId = user.id;
                ticket.resolverName = user.name;
            }
        }
    } else if (status !== undefined && status !== 'resolved') {
        // If status changed back from resolved, clear resolver info?
        // Optional: keep it or clear it. Usually clear it if reopened.
        if (ticket.status !== 'resolved') {
            ticket.resolverId = null;
            ticket.resolverName = null;
        }
    }

    ticket.updatedAt = new Date().toISOString();

    saveTickets();
    broadcastSSE('ticket-updated', ticket);

    // Audit log for ticket update
    const actionUser = users.find(u => u.id === req.session?.userId);
    addAuditLog(req.session?.userId || 'system', actionUser?.username || 'anonymous', 'ticket_update', `Updated ticket: ${ticket.ticketId} (status: ${ticket.status})`, { ticketId: id });

    res.json(ticket);
});



// API: Delete ticket
app.delete('/api/tickets/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const index = tickets.findIndex(t => t.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Ticket not found' });
    }

    const deleted = tickets.splice(index, 1)[0];
    saveTickets();
    broadcastSSE('ticket-deleted', { id });

    res.json({ message: 'Ticket deleted', ticket: deleted });
});

// API: Add comment to ticket (with optional image upload)
app.post('/api/tickets/:id/comments', requireAuth, upload.single('image'), (req, res) => {
    const { id } = req.params;
    const { text } = req.body;
    const hasImage = req.file ? true : false;

    // Allow comment with only image OR only text OR both
    if ((!text || !text.trim()) && !hasImage) {
        return res.status(400).json({ error: 'Comment text or image is required' });
    }

    const ticket = tickets.find(t => t.id === id);
    if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
    }

    // Initialize comments array if doesn't exist (for old tickets)
    if (!ticket.comments) {
        ticket.comments = [];
    }

    const user = users.find(u => u.id === req.session.userId);
    const comment = {
        id: Date.now().toString(),
        text: text ? text.trim() : '',
        image: hasImage ? '/uploads/' + req.file.filename : null,
        author: user ? user.name : 'Unknown',
        authorId: req.session.userId,
        createdAt: new Date().toISOString()
    };

    // Set firstResponseAt jika ini adalah respon pertama dari NOC (bukan submitter)
    // Response dianggap valid jika komentar bukan dari submitter tiket
    if (!ticket.firstResponseAt && req.session.userId !== ticket.submitterId) {
        ticket.firstResponseAt = new Date().toISOString();
    }

    ticket.comments.push(comment);
    ticket.updatedAt = new Date().toISOString();
    saveTickets();

    broadcastSSE('ticket-updated', ticket);
    res.status(201).json(comment);
});

// API: Delete a comment from a ticket
app.delete('/api/tickets/:ticketId/comments/:commentId', requireAuth, (req, res) => {
    const { ticketId, commentId } = req.params;
    const userId = req.session.userId;
    const userRole = req.session.userRole;

    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
    }

    if (!ticket.comments) {
        return res.status(404).json({ error: 'Comment not found' });
    }

    const commentIndex = ticket.comments.findIndex(c => c.id === commentId);
    if (commentIndex === -1) {
        return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = ticket.comments[commentIndex];

    // Authorization: Only author or admin can delete
    if (comment.authorId !== userId && userRole !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    // Remove comment
    ticket.comments.splice(commentIndex, 1);
    saveTickets();

    broadcastSSE('ticket-updated', ticket);
    res.json({ success: true });
});


END DEPRECATED TICKET ROUTES */

// DEPRECATED: DELETE /api/hosts/:id moved to routes/hostRoutes.js
/*
app.delete('/api/hosts/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const index = monitoredHosts.findIndex(h => h.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Host not found' });
    }

    const removed = monitoredHosts.splice(index, 1)[0];
    delete pingHistory[id];
    saveHosts(); // Persist to file

    // Audit log for host deletion
    const user = users.find(u => u.id === req.session?.userId);
    addAuditLog(req.session?.userId || 'system', user?.username || 'anonymous', 'host_delete', `Deleted host: ${removed.name} (${removed.host})`, { hostId: id });

    // Broadcast removal to all clients
    broadcastSSE('host-removed', { id });

    res.json({ success: true });
});
*/

// API: Ping a specific host
app.post('/api/ping/:id', async (req, res) => {
    const { id } = req.params;
    const hostData = monitoredHosts.find(h => h.id === id);

    if (!hostData) {
        return res.status(404).json({ error: 'Host not found' });
    }

    const result = await pingHost(hostData.host);

    // Update host status
    hostData.status = result.alive ? 'online' : 'offline';
    hostData.latency = result.time;
    hostData.lastCheck = result.timestamp;

    // Store in history (keep last 100 entries)
    if (!pingHistory[id]) {
        pingHistory[id] = [];
    }
    pingHistory[id].unshift(result);
    if (pingHistory[id].length > 8640) {
        pingHistory[id].pop();
    }

    res.json({ ...hostData, pingResult: result });
});

// API: Ping all hosts
app.post('/api/ping-all', async (req, res) => {
    const results = [];

    for (const hostData of monitoredHosts) {
        const result = await pingHost(hostData.host);

        hostData.status = result.alive ? 'online' : 'offline';
        hostData.latency = result.time;
        hostData.lastCheck = result.timestamp;

        if (!pingHistory[hostData.id]) {
            pingHistory[hostData.id] = [];
        }
        pingHistory[hostData.id].unshift(result);
        if (pingHistory[hostData.id].length > 8640) {
            pingHistory[hostData.id].pop();
        }

        results.push({ ...hostData, pingResult: result });
    }

    res.json(results);
});

// API: Get ping history for a host
app.get('/api/history/:id', (req, res) => {
    const { id } = req.params;
    const history = pingHistory[id] || [];
    res.json(history);
});

// API: Quick ping (without storing)
app.post('/api/quick-ping', async (req, res) => {
    const { host } = req.body;

    if (!host) {
        return res.status(400).json({ error: 'Host/IP is required' });
    }

    const result = await pingHost(host);
    res.json(result);
});

// Helper: Execute Traceroute
const { spawn } = require('child_process');

// API: Traceroute (Streaming) - Using PowerShell for line-by-line output on Windows
app.post('/api/traceroute', (req, res) => {
    const { host } = req.body;
    if (!host) {
        return res.status(400).json({ error: 'Host is required' });
    }

    // SECURITY: Validate host format
    if (!isValidHost(host)) {
        return res.status(400).json({ error: 'Invalid Hostname or IP Address' });
    }

    // Set headers for streaming
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Use PowerShell for better streaming on Windows
    // -d: Do not resolve addresses, -w 500: Timeout, -h 30: Max hops
    console.log('[DEBUG] Running tracert via PowerShell...');
    const tracertProcess = spawn('powershell', [
        '-NoProfile',
        '-Command',
        `tracert -d -w 500 -h 30 ${host}`
    ], {
        windowsHide: true
    });

    let hasOutput = false;

    tracertProcess.stdout.on('data', (data) => {
        hasOutput = true;
        const text = data.toString();
        console.log('[DEBUG] Tracert stdout:', text);
        res.write(text);
    });

    tracertProcess.stderr.on('data', (data) => {
        const text = data.toString();
        console.log('[DEBUG] Tracert stderr:', text);
        res.write(text);
    });

    tracertProcess.on('close', (code) => {
        console.log('[DEBUG] Tracert closed with code:', code);
        if (!hasOutput) {
            res.write('No output received from tracert command\n');
        }
        res.write(`\n--- Traceroute completed ---`);
        res.end();
    });

    tracertProcess.on('error', (err) => {
        console.error('[DEBUG] Tracert error:', err);
        res.write(`Error: ${err.message}\n`);
        res.end();
    });

    // Handle client disconnect
    res.on('close', () => {
        console.log('[DEBUG] Response closed, cleaning up');
        if (!tracertProcess.killed) {
            tracertProcess.kill();
        }
    });
});

// API: Ping (Streaming) - Using PowerShell for line-by-line output on Windows
app.post('/api/ping-stream', (req, res) => {
    console.log('[DEBUG] /api/ping-stream called');
    const { host } = req.body;
    console.log('[DEBUG] Host:', host);

    if (!host) {
        return res.status(400).json({ error: 'Host is required' });
    }

    // SECURITY: Validate host format
    if (!isValidHost(host)) {
        return res.status(400).json({ error: 'Invalid Hostname or IP Address' });
    }

    // Set headers for streaming
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Use PowerShell for better streaming on Windows
    console.log('[DEBUG] Running ping via PowerShell...');
    const pingProcess = spawn('powershell', [
        '-NoProfile',
        '-Command',
        `ping -n 4 ${host}`
    ], {
        windowsHide: true
    });

    let hasOutput = false;

    pingProcess.stdout.on('data', (data) => {
        hasOutput = true;
        const text = data.toString();
        console.log('[DEBUG] Ping stdout:', text);
        res.write(text);
    });

    pingProcess.stderr.on('data', (data) => {
        const text = data.toString();
        console.log('[DEBUG] Ping stderr:', text);
        res.write(text);
    });

    pingProcess.on('close', (code) => {
        console.log('[DEBUG] Ping closed with code:', code);
        if (!hasOutput) {
            res.write('No output received from ping command\n');
        }
        res.write(`\n--- Ping completed ---`);
        res.end();
    });

    pingProcess.on('error', (err) => {
        console.error('[DEBUG] Ping error:', err);
        res.write(`Error: ${err.message}\n`);
        res.end();
    });

    // Handle client disconnect
    res.on('close', () => {
        console.log('[DEBUG] Response closed, cleaning up');
        if (!pingProcess.killed) {
            pingProcess.kill();
        }
    });
});

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// Phase 1: Host Groups API
// ========================================

// Get all host groups
app.get('/api/host-groups', requireAuth, (req, res) => {
    res.json(hostGroups);
});

// Create a new host group
app.post('/api/host-groups', requireAuth, (req, res) => {
    const { name, description, color } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Nama grup diperlukan' });
    }

    // Check for duplicate
    if (hostGroups.some(g => g.name.toLowerCase() === name.trim().toLowerCase())) {
        return res.status(400).json({ error: 'Nama grup sudah ada' });
    }

    const newGroup = {
        id: Date.now().toString(),
        name: name.trim(),
        description: description || '',
        color: color || '#6366f1',
        createdAt: new Date().toISOString()
    };

    hostGroups.push(newGroup);
    saveHostGroups();

    // Audit log
    const user = users.find(u => u.id === req.session.userId);
    addAuditLog(req.session.userId, user?.username || 'unknown', 'group_create', `Created host group: ${name}`, { groupId: newGroup.id });

    res.status(201).json(newGroup);
});

// Update a host group
app.put('/api/host-groups/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const { name, description, color } = req.body;

    const group = hostGroups.find(g => g.id === id);
    if (!group) {
        return res.status(404).json({ error: 'Grup tidak ditemukan' });
    }

    if (name) group.name = name.trim();
    if (description !== undefined) group.description = description;
    if (color) group.color = color;
    group.updatedAt = new Date().toISOString();

    saveHostGroups();

    const user = users.find(u => u.id === req.session.userId);
    addAuditLog(req.session.userId, user?.username || 'unknown', 'group_update', `Updated host group: ${group.name}`, { groupId: id });

    res.json(group);
});

// Delete a host group
app.delete('/api/host-groups/:id', requireAuth, (req, res) => {
    const { id } = req.params;

    const groupIndex = hostGroups.findIndex(g => g.id === id);
    if (groupIndex === -1) {
        return res.status(404).json({ error: 'Grup tidak ditemukan' });
    }

    const groupName = hostGroups[groupIndex].name;
    hostGroups.splice(groupIndex, 1);

    // Remove group from all hosts
    monitoredHosts.forEach(host => {
        if (host.groupId === id) {
            host.groupId = null;
        }
    });
    saveHosts();
    saveHostGroups();

    const user = users.find(u => u.id === req.session.userId);
    addAuditLog(req.session.userId, user?.username || 'unknown', 'group_delete', `Deleted host group: ${groupName}`, { groupId: id });

    res.json({ message: 'Grup berhasil dihapus' });
});

// ========================================
// Phase 1: Audit Logs API
// ========================================

// Get audit logs (admin only)
app.get('/api/audit-logs', requireAdmin, (req, res) => {
    const { page = 1, limit = 50, action, userId, startDate, endDate } = req.query;

    let filteredLogs = [...auditLogs];

    // Filter by action type
    if (action) {
        filteredLogs = filteredLogs.filter(log => log.action === action);
    }

    // Filter by user
    if (userId) {
        filteredLogs = filteredLogs.filter(log => log.userId === userId);
    }

    // Filter by date range
    if (startDate) {
        filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= new Date(startDate));
    }
    if (endDate) {
        filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= new Date(endDate));
    }

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedLogs = filteredLogs.slice(startIndex, endIndex);

    res.json({
        logs: paginatedLogs,
        total: filteredLogs.length,
        page: parseInt(page),
        totalPages: Math.ceil(filteredLogs.length / limit)
    });
});

// Get audit log action types (for filter dropdown)
app.get('/api/audit-logs/actions', requireAdmin, (req, res) => {
    const actions = [...new Set(auditLogs.map(log => log.action))];
    res.json(actions);
});

// ========================================
// Phase 2: Statistics API
// ========================================

/**
 * Calculate uptime percentage for a host based on ping history
 */
function calculateUptime(hostId, hoursBack = 24) {
    const history = pingHistory[hostId] || [];
    if (history.length === 0) return null;

    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    const recentPings = history.filter(p => new Date(p.timestamp).getTime() >= cutoff);

    if (recentPings.length === 0) return null;

    const successfulPings = recentPings.filter(p => p.alive).length;
    return (successfulPings / recentPings.length) * 100;
}

/**
 * GET /api/stats/summary - Overall system health summary
 */
app.get('/api/stats/summary', requireAuth, (req, res) => {
    const now = Date.now();
    const last24h = now - (24 * 60 * 60 * 1000);

    // Calculate online/offline counts
    const onlineHosts = monitoredHosts.filter(h => h.status === 'online');
    const offlineHosts = monitoredHosts.filter(h => h.status === 'offline');
    const totalHosts = monitoredHosts.length;

    // Calculate average latency (from online hosts only)
    const latencies = onlineHosts.map(h => h.latency).filter(l => l !== null && l !== undefined);
    const avgLatency = latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null;

    // Count incidents in last 24h (from status logs)
    const incidents24h = statusLogs.filter(log =>
        log.type === 'down' && new Date(log.timestamp).getTime() >= last24h
    ).length;

    // Calculate overall uptime (average of all hosts' 24h uptime)
    let totalUptime = 0;
    let hostsWithData = 0;
    monitoredHosts.forEach(host => {
        const uptime = calculateUptime(host.id, 24);
        if (uptime !== null) {
            totalUptime += uptime;
            hostsWithData++;
        }
    });
    const overallUptime = hostsWithData > 0 ? (totalUptime / hostsWithData).toFixed(2) : null;

    res.json({
        totalHosts,
        onlineCount: onlineHosts.length,
        offlineCount: offlineHosts.length,
        onlinePercentage: totalHosts > 0 ? ((onlineHosts.length / totalHosts) * 100).toFixed(1) : 0,
        avgLatency,
        incidents24h,
        overallUptime24h: overallUptime,
        lastUpdated: new Date().toISOString()
    });
});

/**
 * GET /api/stats/uptime - Uptime statistics per host
 */
app.get('/api/stats/uptime', requireAuth, (req, res) => {
    const { hostId, period = '24h' } = req.query;

    // Convert period to hours
    const periodHours = {
        '1h': 1,
        '6h': 6,
        '12h': 12,
        '24h': 24,
        '7d': 168,
        '30d': 720
    }[period] || 24;

    // If specific host requested
    if (hostId) {
        const host = monitoredHosts.find(h => h.id === hostId);
        if (!host) {
            return res.status(404).json({ error: 'Host not found' });
        }

        const uptime = calculateUptime(hostId, periodHours);
        return res.json({
            hostId,
            hostName: host.name,
            period,
            uptime: uptime !== null ? uptime.toFixed(2) : null,
            dataPoints: (pingHistory[hostId] || []).length
        });
    }

    // Return uptime for all hosts
    const uptimeData = monitoredHosts.map(host => ({
        hostId: host.id,
        hostName: host.name,
        host: host.host,
        status: host.status,
        uptime: calculateUptime(host.id, periodHours)?.toFixed(2) || null
    }));

    // Sort by uptime ascending (worst first)
    uptimeData.sort((a, b) => {
        if (a.uptime === null) return 1;
        if (b.uptime === null) return -1;
        return parseFloat(a.uptime) - parseFloat(b.uptime);
    });

    res.json({
        period,
        hosts: uptimeData
    });
});

/**
 * GET /api/stats/latency-trend - Latency trends for charting
 */
app.get('/api/stats/latency-trend', requireAuth, (req, res) => {
    const { hostId, period = '24h', interval = 'hourly' } = req.query;

    // Convert period to hours
    const periodHours = {
        '1h': 1,
        '6h': 6,
        '12h': 12,
        '24h': 24,
        '7d': 168
    }[period] || 24;

    const cutoff = Date.now() - (periodHours * 60 * 60 * 1000);

    // Get hosts to analyze
    const hostsToAnalyze = hostId
        ? monitoredHosts.filter(h => h.id === hostId)
        : monitoredHosts.slice(0, 10); // Limit to 10 hosts for performance

    // Aggregate data by interval
    const intervalMs = interval === 'hourly' ? 60 * 60 * 1000 : 60 * 1000; // hourly or minute
    const dataPoints = [];

    // For overall trend (when no specific host)
    if (!hostId) {
        const buckets = {};

        hostsToAnalyze.forEach(host => {
            const history = pingHistory[host.id] || [];
            history.forEach(ping => {
                const ts = new Date(ping.timestamp).getTime();
                if (ts >= cutoff && ping.time !== null) {
                    const bucketKey = Math.floor(ts / intervalMs) * intervalMs;
                    if (!buckets[bucketKey]) {
                        buckets[bucketKey] = { total: 0, count: 0 };
                    }
                    buckets[bucketKey].total += ping.time;
                    buckets[bucketKey].count++;
                }
            });
        });

        Object.keys(buckets).sort().forEach(key => {
            dataPoints.push({
                timestamp: new Date(parseInt(key)).toISOString(),
                avgLatency: Math.round(buckets[key].total / buckets[key].count)
            });
        });
    } else {
        // For specific host
        const host = hostsToAnalyze[0];
        if (host) {
            const history = pingHistory[host.id] || [];
            const buckets = {};

            history.forEach(ping => {
                const ts = new Date(ping.timestamp).getTime();
                if (ts >= cutoff && ping.time !== null) {
                    const bucketKey = Math.floor(ts / intervalMs) * intervalMs;
                    if (!buckets[bucketKey]) {
                        buckets[bucketKey] = { total: 0, count: 0, min: Infinity, max: -Infinity };
                    }
                    buckets[bucketKey].total += ping.time;
                    buckets[bucketKey].count++;
                    buckets[bucketKey].min = Math.min(buckets[bucketKey].min, ping.time);
                    buckets[bucketKey].max = Math.max(buckets[bucketKey].max, ping.time);
                }
            });

            Object.keys(buckets).sort().forEach(key => {
                dataPoints.push({
                    timestamp: new Date(parseInt(key)).toISOString(),
                    avgLatency: Math.round(buckets[key].total / buckets[key].count),
                    minLatency: buckets[key].min,
                    maxLatency: buckets[key].max
                });
            });
        }
    }

    res.json({
        hostId: hostId || 'all',
        period,
        interval,
        dataPoints
    });
});

// ========================================
// Phase 2: Scheduled Maintenance API
// ========================================

// GET: List all maintenance windows
app.get('/api/maintenance', requireAuth, (req, res) => {
    // Clean up expired maintenance windows (auto-cleanup)
    const now = new Date();
    maintenanceWindows.forEach(mw => {
        const end = new Date(mw.endTime);
        if (now > end) {
            mw.active = false;
        }
    });

    res.json(maintenanceWindows);
});

// POST: Create a new maintenance window
app.post('/api/maintenance', requireAuth, (req, res) => {
    const { hostIds, startTime, endTime, reason, allHosts } = req.body;

    if (!startTime || !endTime) {
        return res.status(400).json({ error: 'Start time and end time are required' });
    }

    if (!allHosts && (!hostIds || !Array.isArray(hostIds) || hostIds.length === 0)) {
        return res.status(400).json({ error: 'At least one host must be selected' });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (end <= start) {
        return res.status(400).json({ error: 'End time must be after start time' });
    }

    const newMaintenance = {
        id: Date.now().toString(),
        hostIds: allHosts ? ['all'] : hostIds,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        reason: reason || 'Scheduled Maintenance',
        active: true,
        createdBy: req.session.userId,
        createdAt: new Date().toISOString()
    };

    maintenanceWindows.push(newMaintenance);
    saveMaintenanceWindows();

    // Audit log
    const user = users.find(u => u.id === req.session.userId);
    const hostNameList = allHosts
        ? 'All Hosts'
        : hostIds.map(id => monitoredHosts.find(h => h.id === id)?.name || id).slice(0, 3).join(', ');
    addAuditLog(
        req.session.userId,
        user?.username || 'unknown',
        'maintenance_create',
        `Created maintenance window for ${hostNameList} from ${start.toLocaleString()} to ${end.toLocaleString()}`
    );

    broadcastSSE('maintenance-update', maintenanceWindows);
    res.status(201).json(newMaintenance);
});

// PUT: Update a maintenance window
app.put('/api/maintenance/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const { hostIds, startTime, endTime, reason, active, allHosts } = req.body;

    const maintenance = maintenanceWindows.find(m => m.id === id);
    if (!maintenance) {
        return res.status(404).json({ error: 'Maintenance window not found' });
    }

    if (startTime) maintenance.startTime = new Date(startTime).toISOString();
    if (endTime) maintenance.endTime = new Date(endTime).toISOString();
    if (reason !== undefined) maintenance.reason = reason;
    if (active !== undefined) maintenance.active = active;
    if (hostIds && Array.isArray(hostIds)) {
        maintenance.hostIds = allHosts ? ['all'] : hostIds;
    }

    maintenance.updatedAt = new Date().toISOString();
    saveMaintenanceWindows();

    // Audit log
    const user = users.find(u => u.id === req.session.userId);
    addAuditLog(
        req.session.userId,
        user?.username || 'unknown',
        'maintenance_update',
        `Updated maintenance window ${id}`
    );

    broadcastSSE('maintenance-update', maintenanceWindows);
    res.json(maintenance);
});

// DELETE: Cancel/delete a maintenance window
app.delete('/api/maintenance/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const index = maintenanceWindows.findIndex(m => m.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Maintenance window not found' });
    }

    const removed = maintenanceWindows.splice(index, 1)[0];
    saveMaintenanceWindows();

    // Audit log
    const user = users.find(u => u.id === req.session.userId);
    addAuditLog(
        req.session.userId,
        user?.username || 'unknown',
        'maintenance_delete',
        `Deleted maintenance window: ${removed.reason}`
    );

    broadcastSSE('maintenance-update', maintenanceWindows);
    res.json({ success: true });
});

// GET: Check if a specific host is in maintenance
app.get('/api/maintenance/check/:hostId', requireAuth, (req, res) => {
    const { hostId } = req.params;
    const maintenance = isHostInMaintenance(hostId);
    res.json({
        inMaintenance: maintenance !== null,
        maintenance
    });
});

// ========================================
// Phase 3: Push Notification API
// ========================================

// GET: Get VAPID public key for push subscription
app.get('/api/push/vapid-public-key', (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});

// POST: Subscribe to push notifications
app.post('/api/push/subscribe', requireAuth, (req, res) => {
    try {
        const subscription = req.body;

        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ error: 'Invalid subscription' });
        }

        // Check if subscription already exists
        const exists = pushSubscriptions.some(
            sub => sub.endpoint === subscription.endpoint
        );

        if (!exists) {
            pushSubscriptions.push({
                ...subscription,
                userId: req.session.userId,
                createdAt: new Date().toISOString()
            });
            savePushSubscriptions();
            console.log(`ðŸ“± New push subscription added. Total: ${pushSubscriptions.length}`);
        }

        res.json({ success: true, message: 'Subscribed to push notifications' });
    } catch (error) {
        console.error('Push subscription error:', error);
        res.status(500).json({ error: 'Failed to subscribe' });
    }
});

// POST: Unsubscribe from push notifications
app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
    try {
        const { endpoint } = req.body;

        if (!endpoint) {
            return res.status(400).json({ error: 'Endpoint required' });
        }

        const initialLength = pushSubscriptions.length;
        pushSubscriptions = pushSubscriptions.filter(
            sub => sub.endpoint !== endpoint
        );

        if (pushSubscriptions.length < initialLength) {
            savePushSubscriptions();
            console.log(`ðŸ“± Push subscription removed. Total: ${pushSubscriptions.length}`);
        }

        res.json({ success: true, message: 'Unsubscribed from push notifications' });
    } catch (error) {
        console.error('Push unsubscribe error:', error);
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
});

// GET: Get push subscription status for current user
app.get('/api/push/status', requireAuth, (req, res) => {
    const userSubscriptions = pushSubscriptions.filter(
        sub => sub.userId === req.session.userId
    );
    res.json({
        subscribed: userSubscriptions.length > 0,
        count: userSubscriptions.length
    });
});

// POST: Send test push notification (admin only)
app.post('/api/push/test', requireAuth, async (req, res) => {
    try {
        const user = users.find(u => u.id === req.session.userId);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        await sendPushNotificationToAll({
            title: 'ðŸ”” Test Notification',
            body: 'Push notifications are working!',
            tag: 'test-notification'
        });

        res.json({ success: true, message: 'Test notification sent' });
    } catch (error) {
        console.error('Test push error:', error);
        res.status(500).json({ error: 'Failed to send test notification' });
    }
});

// ========================================
// Phase 3: API Key Management
// ========================================

// GET: List all API keys (admin only)
app.get('/api/keys', requireAuth, (req, res) => {
    const user = users.find(u => u.id === req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    // Return keys with masked values
    const maskedKeys = apiKeys.map(k => ({
        ...k,
        key: k.key.substring(0, 8) + '...' + k.key.substring(k.key.length - 4)
    }));

    res.json(maskedKeys);
});

// POST: Create new API key (admin only)
app.post('/api/keys', requireAuth, (req, res) => {
    const user = users.find(u => u.id === req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { name, permissions } = req.body;

    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Name is required' });
    }

    const newKey = {
        id: crypto.randomUUID(),
        name: name.trim(),
        key: generateApiKey(),
        permissions: permissions || ['read'],
        enabled: true,
        createdAt: new Date().toISOString(),
        createdBy: user.username,
        lastUsed: null
    };

    apiKeys.push(newKey);
    saveApiKeys();

    addAuditLog(req.session.userId, user.username, 'api_key_create', `Created API key: ${name}`);

    // Return the full key only on creation
    res.status(201).json(newKey);
});

// DELETE: Revoke API key (admin only)
app.delete('/api/keys/:id', requireAuth, (req, res) => {
    const user = users.find(u => u.id === req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;
    const keyIndex = apiKeys.findIndex(k => k.id === id);

    if (keyIndex === -1) {
        return res.status(404).json({ error: 'API key not found' });
    }

    const deletedKey = apiKeys.splice(keyIndex, 1)[0];
    saveApiKeys();

    addAuditLog(req.session.userId, user.username, 'api_key_delete', `Revoked API key: ${deletedKey.name}`);

    res.json({ success: true });
});

// PUT: Toggle API key enabled/disabled (admin only)
app.put('/api/keys/:id/toggle', requireAuth, (req, res) => {
    const user = users.find(u => u.id === req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;
    const apiKey = apiKeys.find(k => k.id === id);

    if (!apiKey) {
        return res.status(404).json({ error: 'API key not found' });
    }

    apiKey.enabled = !apiKey.enabled;
    saveApiKeys();

    addAuditLog(req.session.userId, user.username, 'api_key_update',
        `${apiKey.enabled ? 'Enabled' : 'Disabled'} API key: ${apiKey.name}`);

    res.json({ success: true, enabled: apiKey.enabled });
});

// ========================================
// Phase 3: Webhook Management
// ========================================

// GET: List all webhooks (admin only)
app.get('/api/webhooks', requireAuth, (req, res) => {
    const user = users.find(u => u.id === req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    // Mask secrets
    const maskedWebhooks = webhooks.map(w => ({
        ...w,
        secret: w.secret ? '********' : null
    }));

    res.json(maskedWebhooks);
});

// POST: Create new webhook (admin only)
app.post('/api/webhooks', requireAuth, (req, res) => {
    const user = users.find(u => u.id === req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { name, url, events, secret } = req.body;

    if (!name || !url) {
        return res.status(400).json({ error: 'Name and URL are required' });
    }

    const newWebhook = {
        id: crypto.randomUUID(),
        name: name.trim(),
        url: url.trim(),
        events: events || ['host_down', 'host_up'],
        secret: secret || null,
        enabled: true,
        createdAt: new Date().toISOString(),
        createdBy: user.username,
        lastDelivery: null
    };

    webhooks.push(newWebhook);
    saveWebhooks();

    addAuditLog(req.session.userId, user.username, 'webhook_create', `Created webhook: ${name}`);

    res.status(201).json({ ...newWebhook, secret: newWebhook.secret ? '********' : null });
});

// DELETE: Delete webhook (admin only)
app.delete('/api/webhooks/:id', requireAuth, (req, res) => {
    const user = users.find(u => u.id === req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;
    const webhookIndex = webhooks.findIndex(w => w.id === id);

    if (webhookIndex === -1) {
        return res.status(404).json({ error: 'Webhook not found' });
    }

    const deletedWebhook = webhooks.splice(webhookIndex, 1)[0];
    saveWebhooks();

    addAuditLog(req.session.userId, user.username, 'webhook_delete', `Deleted webhook: ${deletedWebhook.name}`);

    res.json({ success: true });
});

// PUT: Toggle webhook enabled/disabled (admin only)
app.put('/api/webhooks/:id/toggle', requireAuth, (req, res) => {
    const user = users.find(u => u.id === req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;
    const webhook = webhooks.find(w => w.id === id);

    if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
    }

    webhook.enabled = !webhook.enabled;
    saveWebhooks();

    addAuditLog(req.session.userId, user.username, 'webhook_update',
        `${webhook.enabled ? 'Enabled' : 'Disabled'} webhook: ${webhook.name}`);

    res.json({ success: true, enabled: webhook.enabled });
});

// POST: Test webhook (admin only)
app.post('/api/webhooks/:id/test', requireAuth, async (req, res) => {
    const user = users.find(u => u.id === req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;
    const webhook = webhooks.find(w => w.id === id);

    if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
    }

    try {
        const testData = {
            event: 'test',
            timestamp: new Date().toISOString(),
            data: { message: 'This is a test webhook from Network Monitor' }
        };

        let headers = { 'Content-Type': 'application/json' };
        if (webhook.secret) {
            const signature = crypto
                .createHmac('sha256', webhook.secret)
                .update(JSON.stringify(testData))
                .digest('hex');
            headers['X-Webhook-Signature'] = `sha256=${signature}`;
        }

        const response = await fetch(webhook.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(testData)
        });

        if (response.ok) {
            res.json({ success: true, message: 'Test webhook sent successfully' });
        } else {
            res.status(400).json({ error: `Webhook returned ${response.status}` });
        }
    } catch (error) {
        res.status(500).json({ error: `Failed to send test: ${error.message}` });
    }
});

// ========================================
// Phase 3: Public API v1 (API Key Auth)
// ========================================

// GET: Public status summary
app.get('/api/v1/status', requireApiKey, (req, res) => {
    const online = monitoredHosts.filter(h => h.status === 'online').length;
    const offline = monitoredHosts.filter(h => h.status === 'offline').length;
    const unknown = monitoredHosts.filter(h => !h.status || h.status === 'unknown').length;

    res.json({
        status: offline > 0 ? 'degraded' : 'operational',
        summary: {
            total: monitoredHosts.length,
            online,
            offline,
            unknown
        },
        timestamp: new Date().toISOString()
    });
});

// GET: List all hosts with status
app.get('/api/v1/hosts', requireApiKey, (req, res) => {
    const hosts = monitoredHosts.map(h => ({
        id: h.id,
        name: h.name,
        host: h.host,
        cid: h.cid || null,
        status: h.status || 'unknown',
        latency: h.latency,
        lastCheck: h.lastCheck,
        groupId: h.groupId || null
    }));

    res.json({ hosts, count: hosts.length, timestamp: new Date().toISOString() });
});

// GET: Single host details
app.get('/api/v1/hosts/:id', requireApiKey, (req, res) => {
    const { id } = req.params;
    const host = monitoredHosts.find(h => h.id === id);

    if (!host) {
        return res.status(404).json({ error: 'Host not found' });
    }

    // Get recent history
    const history = (hostLatencyHistory[id] || []).slice(-50);

    res.json({
        id: host.id,
        name: host.name,
        host: host.host,
        cid: host.cid || null,
        status: host.status || 'unknown',
        latency: host.latency,
        lastCheck: host.lastCheck,
        groupId: host.groupId || null,
        history: history,
        timestamp: new Date().toISOString()
    });
});

// ========================================
// Phase 1: Bulk Import/Export API
// ========================================

// Export hosts to JSON
app.get('/api/hosts/export', requireAuth, (req, res) => {
    const exportData = {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        hosts: monitoredHosts.map(h => ({
            name: h.name,
            host: h.host,
            cid: h.cid || null,
            latitude: h.latitude || null,
            longitude: h.longitude || null,
            groupId: h.groupId || null
        })),
        groups: hostGroups
    };

    const user = users.find(u => u.id === req.session.userId);
    addAuditLog(req.session.userId, user?.username || 'unknown', 'hosts_export', `Exported ${monitoredHosts.length} hosts`);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=nms-hosts-${new Date().toISOString().slice(0, 10)}.json`);
    res.json(exportData);
});

// Export hosts to CSV
app.get('/api/hosts/export/csv', requireAuth, (req, res) => {
    const headers = ['name', 'host', 'cid', 'latitude', 'longitude', 'status', 'latency', 'groupId'];
    const csvRows = [headers.join(',')];

    monitoredHosts.forEach(h => {
        const row = [
            `"${(h.name || '').replace(/"/g, '""')}"`,
            `"${h.host}"`,
            `"${h.cid || ''}"`,
            h.latitude || '',
            h.longitude || '',
            h.status || 'unknown',
            h.latency || '',
            h.groupId || ''
        ];
        csvRows.push(row.join(','));
    });

    const user = users.find(u => u.id === req.session.userId);
    addAuditLog(req.session.userId, user?.username || 'unknown', 'hosts_export_csv', `Exported ${monitoredHosts.length} hosts to CSV`);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=nms-hosts-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csvRows.join('\n'));
});

// Import hosts from JSON
app.post('/api/hosts/import', requireAuth, (req, res) => {
    const { hosts, skipDuplicates = true } = req.body;

    if (!Array.isArray(hosts)) {
        return res.status(400).json({ error: 'Data host tidak valid' });
    }

    let imported = 0;
    let skipped = 0;
    let errors = [];

    hosts.forEach((hostData, index) => {
        try {
            // Validate required fields
            if (!hostData.host || !isValidHost(hostData.host)) {
                errors.push(`Baris ${index + 1}: Host tidak valid`);
                return;
            }

            // Check for duplicates
            const exists = monitoredHosts.some(h => h.host === hostData.host);
            if (exists) {
                if (skipDuplicates) {
                    skipped++;
                    return;
                } else {
                    errors.push(`Baris ${index + 1}: Host ${hostData.host} sudah ada`);
                    return;
                }
            }

            // Create new host
            const newHost = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                host: hostData.host,
                name: hostData.name || hostData.host,
                cid: hostData.cid || null,
                latitude: hostData.latitude || null,
                longitude: hostData.longitude || null,
                groupId: hostData.groupId || null,
                status: 'unknown',
                latency: null,
                lastChecked: null,
                history: []
            };

            monitoredHosts.push(newHost);
            imported++;
        } catch (err) {
            errors.push(`Baris ${index + 1}: ${err.message}`);
        }
    });

    if (imported > 0) {
        saveHosts();
        broadcastSSE('hosts-update', monitoredHosts);
    }

    const user = users.find(u => u.id === req.session.userId);
    addAuditLog(req.session.userId, user?.username || 'unknown', 'hosts_import', `Imported ${imported} hosts, skipped ${skipped}, errors: ${errors.length}`);

    res.json({
        message: `Import selesai: ${imported} ditambahkan, ${skipped} dilewati`,
        imported,
        skipped,
        errors
    });
});

// Import hosts from CSV (expects multipart form data)
app.post('/api/hosts/import/csv', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'File CSV diperlukan' });
    }

    try {
        const csvContent = fs.readFileSync(req.file.path, 'utf-8');
        const lines = csvContent.split('\n').filter(line => line.trim());

        if (lines.length < 2) {
            return res.status(400).json({ error: 'File CSV kosong atau tidak valid' });
        }

        const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
        const hostIndex = headers.indexOf('host');
        const nameIndex = headers.indexOf('name');
        const cidIndex = headers.indexOf('cid');
        const latIndex = headers.indexOf('latitude');
        const lonIndex = headers.indexOf('longitude');
        const groupIndex = headers.indexOf('groupid');

        if (hostIndex === -1) {
            return res.status(400).json({ error: 'Kolom "host" diperlukan dalam CSV' });
        }

        let imported = 0;
        let skipped = 0;
        let errors = [];

        for (let i = 1; i < lines.length; i++) {
            try {
                // Simple CSV parsing (handles quoted values)
                const values = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
                const cleanValues = values.map(v => v.replace(/^"|"$/g, '').trim());

                const host = cleanValues[hostIndex];
                if (!host || !isValidHost(host)) {
                    errors.push(`Baris ${i + 1}: Host tidak valid`);
                    continue;
                }

                // Check duplicate
                if (monitoredHosts.some(h => h.host === host)) {
                    skipped++;
                    continue;
                }

                const newHost = {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                    host: host,
                    name: (nameIndex !== -1 && cleanValues[nameIndex]) || host,
                    cid: (cidIndex !== -1 && cleanValues[cidIndex]) || null,
                    latitude: (latIndex !== -1 && cleanValues[latIndex]) ? parseFloat(cleanValues[latIndex]) : null,
                    longitude: (lonIndex !== -1 && cleanValues[lonIndex]) ? parseFloat(cleanValues[lonIndex]) : null,
                    groupId: (groupIndex !== -1 && cleanValues[groupIndex]) || null,
                    status: 'unknown',
                    latency: null,
                    lastChecked: null,
                    history: []
                };

                monitoredHosts.push(newHost);
                imported++;
            } catch (err) {
                errors.push(`Baris ${i + 1}: ${err.message}`);
            }
        }

        // Cleanup uploaded file
        fs.unlinkSync(req.file.path);

        if (imported > 0) {
            saveHosts();
            broadcastSSE('hosts-update', monitoredHosts);
        }

        const user = users.find(u => u.id === req.session.userId);
        addAuditLog(req.session.userId, user?.username || 'unknown', 'hosts_import_csv', `Imported ${imported} hosts from CSV`);

        res.json({
            message: `Import CSV selesai: ${imported} ditambahkan, ${skipped} dilewati`,
            imported,
            skipped,
            errors
        });

    } catch (error) {
        console.error('CSV import error:', error);
        res.status(500).json({ error: 'Gagal memproses file CSV' });
    }
});

app.post('/api/hosts/:id/snmp/scan', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { community, version } = req.body;

    const host = monitoredHosts.find(h => h.id === id);
    if (!host) return res.status(404).json({ error: 'Host not found' });

    try {
        const interfaces = await snmpService.getInterfaces(host.host, community || 'public', version || '2c');
        res.json(interfaces);
    } catch (error) {
        console.error('SNMP Scan Error:', error.message);
        res.status(500).json({ error: 'SNMP Scan failed: ' + error.message });
    }
});

// DUPLICATE ENDPOINT REMOVED - See line 1960 for /api/hosts/:id/snmp/history

// Simplified SNMP Traffic Polling - uses processTrafficData for consistency
async function pollSnmpTraffic() {
    for (const host of monitoredHosts) {
        if (host.snmpEnabled && host.snmpInterface) {
            try {
                const traffic = await snmpService.getInterfaceTraffic(
                    host.host,
                    host.snmpCommunity || 'public',
                    host.snmpInterface,
                    host.snmpVersion || '2c'
                );

                // Use centralized processTrafficData for SQLite storage
                const entry = processTrafficData(host.id, traffic);

                // Update host object for realtime UI
                if (entry) {
                    host.traffic = {
                        traffic_in: entry.traffic_in,
                        traffic_out: entry.traffic_out,
                        lastUpdate: entry.timestamp
                    };
                }
            } catch (err) {
                // Squelch errors to avoid log spam
            }
        }
    }
    // No need to save to JSON - database handles persistence
}

function startSnmpPolling() {
    setInterval(pollSnmpTraffic, 5000); // 5 seconds
    console.log('ðŸ“¡ SNMP Polling started (SQLite storage)');
}

app.listen(PORT, () => {
    console.log(`ðŸŒ Network Monitor running at http://localhost:${PORT}`);
    // Start auto-ping by default
    startAutoPing();

    // Start Backup Service
    backupService.init();

    // Start SNMP Polling
    startSnmpPolling();
});
