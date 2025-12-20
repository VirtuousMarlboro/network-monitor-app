/**
 * Simple Web Application Firewall (WAF) Middleware
 * Protects against common web attacks:
 * - SQL Injection
 * - XSS (Cross-Site Scripting)
 * - Path Traversal
 * - Command Injection
 * - Protocol Attacks
 * - Common Exploit Patterns
 */

const fs = require('fs');
const path = require('path');

// WAF Configuration
const WAF_CONFIG = {
    enabled: true,
    logAttacks: true,
    blockOnDetection: true,
    logFile: path.join(__dirname, '../data/waf-logs.json'),

    // Whitelist paths that should not be checked (e.g., for specific APIs)
    whitelistPaths: [
        '/api/hosts',        // Host management - may contain IPs and names that trigger patterns
        '/api/host-groups',  // Phase 1: Host groups - color values contain #
        '/api/hosts/import', // Phase 1: Bulk import may contain legitimate data
        '/api/hosts/export', // Phase 1: Bulk export
        '/api/maintenance',  // Phase 2: Scheduled maintenance - datetime values
        '/api/push',         // Phase 3: Push notification subscription data
        '/api/keys',         // Phase 3: API key management
        '/api/webhooks',     // Phase 3: Webhook management
        '/api/v1',           // Phase 3: Public API v1
    ],

    // Whitelist IPs (e.g., internal monitoring)
    whitelistIPs: ['127.0.0.1', '::1'],
};

// Attack pattern definitions
const ATTACK_PATTERNS = {
    // SQL Injection patterns
    sqlInjection: [
        /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
        /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/i,
        /\w*((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))/i,
        /((\%27)|(\'))union/i,
        /union(.*)select/i,
        /select(.*)from/i,
        /insert(.*)into/i,
        /drop(.*)table/i,
        /delete(.*)from/i,
        /update(.*)set/i,
        /exec(\s|\+)+(s|x)p\w+/i,
        /UNION\s+ALL\s+SELECT/i,
        /ORDER\s+BY\s+\d+/i,
        /BENCHMARK\s*\(/i,
        /SLEEP\s*\(/i,
        /WAITFOR\s+DELAY/i,
        /LOAD_FILE\s*\(/i,
        /INTO\s+(OUT|DUMP)FILE/i,
    ],

    // XSS (Cross-Site Scripting) patterns
    xss: [
        /<script[^>]*>[\s\S]*?<\/script>/i,
        /<script[^>]*>/i,
        /javascript\s*:/i,
        /on\w+\s*=\s*["'][^"']*["']/i,
        /on(load|error|click|mouse|focus|blur|change|submit|key|touch)\s*=/i,
        /<iframe[^>]*>/i,
        /<object[^>]*>/i,
        /<embed[^>]*>/i,
        /<img[^>]+onerror/i,
        /<svg[^>]+onload/i,
        /expression\s*\(/i,
        /vbscript\s*:/i,
        /data\s*:\s*text\/html/i,
        /<\s*meta[^>]+http-equiv/i,
        /document\.(cookie|location|write)/i,
        /window\.(location|open)/i,
        /eval\s*\(/i,
        /setTimeout\s*\(/i,
        /setInterval\s*\(/i,
        /new\s+Function\s*\(/i,
    ],

    // Path Traversal patterns
    pathTraversal: [
        /\.\.\//g,
        /\.\.\\+/g,
        /%2e%2e%2f/i,
        /%2e%2e\//i,
        /\.\.%2f/i,
        /%2e%2e%5c/i,
        /etc\/passwd/i,
        /etc\/shadow/i,
        /windows\/system32/i,
        /boot\.ini/i,
        /win\.ini/i,
    ],

    // Command Injection patterns
    commandInjection: [
        /;\s*(ls|cat|rm|mv|cp|wget|curl|nc|bash|sh|python|perl|php|ruby)/i,
        /\|\s*(ls|cat|rm|mv|cp|wget|curl|nc|bash|sh|python|perl|php|ruby)/i,
        /`[^`]*`/,
        /\$\([^)]*\)/,
        /\$\{[^}]*\}/,
        /&&\s*(ls|cat|rm|mv|cp|wget|curl)/i,
        /\|\|\s*(ls|cat|rm|mv|cp|wget|curl)/i,
        />>\s*\/\w+/,
        />\s*\/\w+/,
    ],

    // Protocol attacks
    protocolAttack: [
        /^(file|gopher|dict|ldap|php|jar|netdoc)\:/i,
        /data\:text\/html/i,
        /expect\:/i,
    ],

    // Common exploit patterns
    exploits: [
        /\{[\s]*\$[\s]*\{/,  // Log4j style
        /\$\{jndi:/i,        // Log4j JNDI
        /\$\{env:/i,         // Environment variable injection
        /\$\{sys:/i,         // System property injection
        /<\?php/i,           // PHP code injection
        /<%.*%>/,            // ASP/JSP code injection
        /phpinfo\s*\(\s*\)/i,
        /base64_decode\s*\(/i,
        /system\s*\(/i,
        /passthru\s*\(/i,
        /shell_exec\s*\(/i,
        /proc_open\s*\(/i,
    ],

    // Malicious User-Agent patterns
    maliciousUserAgents: [
        /sqlmap/i,
        /nikto/i,
        /nessus/i,
        /nmap/i,
        /masscan/i,
        /zgrab/i,
        /gobuster/i,
        /dirbuster/i,
        /wpscan/i,
        /havij/i,
        /acunetix/i,
        /burpsuite/i,
        /owasp/i,
        /netsparker/i,
    ],
};

// Store for attack logs
let attackLogs = [];
const MAX_ATTACK_LOGS = 1000;

// Load existing attack logs
function loadAttackLogs() {
    try {
        if (fs.existsSync(WAF_CONFIG.logFile)) {
            const data = fs.readFileSync(WAF_CONFIG.logFile, 'utf-8');
            attackLogs = JSON.parse(data);
        }
    } catch (error) {
        console.error('WAF: Error loading attack logs:', error.message);
        attackLogs = [];
    }
}

// Save attack logs
function saveAttackLogs() {
    try {
        fs.writeFileSync(WAF_CONFIG.logFile, JSON.stringify(attackLogs.slice(-MAX_ATTACK_LOGS), null, 2));
    } catch (error) {
        console.error('WAF: Error saving attack logs:', error.message);
    }
}

// Log an attack attempt
function logAttack(req, attackType, pattern, matchedValue) {
    const logEntry = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        ip: req.ip || req.connection.remoteAddress,
        method: req.method,
        path: req.path,
        attackType,
        pattern: pattern.toString(),
        matchedValue: matchedValue?.substring(0, 200), // Truncate long values
        userAgent: req.headers['user-agent'],
        referer: req.headers['referer'],
        body: req.method !== 'GET' ? JSON.stringify(req.body)?.substring(0, 500) : undefined,
    };

    attackLogs.push(logEntry);

    // Keep logs under limit
    if (attackLogs.length > MAX_ATTACK_LOGS) {
        attackLogs = attackLogs.slice(-MAX_ATTACK_LOGS);
    }

    // Async save
    setImmediate(saveAttackLogs);

    console.warn(`🛡️ WAF BLOCKED [${attackType}] from ${logEntry.ip}: ${req.method} ${req.path}`);

    return logEntry;
}

// Check a value against patterns
function checkPatterns(value, patterns, patternName) {
    if (!value || typeof value !== 'string') return null;

    for (const pattern of patterns) {
        if (pattern.test(value)) {
            return { pattern, patternName, value };
        }
    }
    return null;
}

// Recursively check object for attack patterns
function deepCheck(obj, patterns, patternName, results = []) {
    if (!obj) return results;

    if (typeof obj === 'string') {
        const match = checkPatterns(obj, patterns, patternName);
        if (match) results.push(match);
    } else if (Array.isArray(obj)) {
        for (const item of obj) {
            deepCheck(item, patterns, patternName, results);
        }
    } else if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            // Check both key and value
            const keyMatch = checkPatterns(key, patterns, patternName);
            if (keyMatch) results.push(keyMatch);
            deepCheck(obj[key], patterns, patternName, results);
        }
    }

    return results;
}

// Main WAF middleware
function wafMiddleware(req, res, next) {
    if (!WAF_CONFIG.enabled) {
        return next();
    }

    // Check whitelist
    if (WAF_CONFIG.whitelistPaths.some(p => req.path.startsWith(p))) {
        return next();
    }

    const clientIP = req.ip || req.connection.remoteAddress;
    if (WAF_CONFIG.whitelistIPs.includes(clientIP)) {
        return next();
    }

    const toCheck = [];

    // Collect all inputs to check
    // 1. URL path
    toCheck.push({ source: 'path', value: req.path });

    // 2. Query parameters
    if (req.query) {
        for (const [key, value] of Object.entries(req.query)) {
            toCheck.push({ source: 'query', key, value: String(value) });
        }
    }

    // 3. Request body
    if (req.body && typeof req.body === 'object') {
        toCheck.push({ source: 'body', value: JSON.stringify(req.body) });
    }

    // 4. Headers (selected)
    const headersToCheck = ['referer', 'origin', 'x-forwarded-for', 'x-forwarded-host'];
    for (const header of headersToCheck) {
        if (req.headers[header]) {
            toCheck.push({ source: 'header', key: header, value: req.headers[header] });
        }
    }

    // 5. Check User-Agent for malicious scanners
    const userAgent = req.headers['user-agent'] || '';
    const uaMatch = checkPatterns(userAgent, ATTACK_PATTERNS.maliciousUserAgents, 'maliciousUserAgent');
    if (uaMatch) {
        if (WAF_CONFIG.logAttacks) {
            logAttack(req, 'Malicious Scanner', uaMatch.pattern, userAgent);
        }
        if (WAF_CONFIG.blockOnDetection) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Request blocked by security policy'
            });
        }
    }

    // Check all collected values against all pattern categories
    for (const item of toCheck) {
        const value = item.value;
        if (!value) continue;

        // SQL Injection
        const sqlMatch = checkPatterns(value, ATTACK_PATTERNS.sqlInjection, 'SQL Injection');
        if (sqlMatch) {
            if (WAF_CONFIG.logAttacks) {
                logAttack(req, 'SQL Injection', sqlMatch.pattern, value);
            }
            if (WAF_CONFIG.blockOnDetection) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Request blocked by security policy'
                });
            }
        }

        // XSS
        const xssMatch = checkPatterns(value, ATTACK_PATTERNS.xss, 'XSS');
        if (xssMatch) {
            if (WAF_CONFIG.logAttacks) {
                logAttack(req, 'XSS', xssMatch.pattern, value);
            }
            if (WAF_CONFIG.blockOnDetection) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Request blocked by security policy'
                });
            }
        }

        // Path Traversal
        const pathMatch = checkPatterns(value, ATTACK_PATTERNS.pathTraversal, 'Path Traversal');
        if (pathMatch) {
            if (WAF_CONFIG.logAttacks) {
                logAttack(req, 'Path Traversal', pathMatch.pattern, value);
            }
            if (WAF_CONFIG.blockOnDetection) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Request blocked by security policy'
                });
            }
        }

        // Command Injection
        const cmdMatch = checkPatterns(value, ATTACK_PATTERNS.commandInjection, 'Command Injection');
        if (cmdMatch) {
            if (WAF_CONFIG.logAttacks) {
                logAttack(req, 'Command Injection', cmdMatch.pattern, value);
            }
            if (WAF_CONFIG.blockOnDetection) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Request blocked by security policy'
                });
            }
        }

        // Protocol Attack
        const protoMatch = checkPatterns(value, ATTACK_PATTERNS.protocolAttack, 'Protocol Attack');
        if (protoMatch) {
            if (WAF_CONFIG.logAttacks) {
                logAttack(req, 'Protocol Attack', protoMatch.pattern, value);
            }
            if (WAF_CONFIG.blockOnDetection) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Request blocked by security policy'
                });
            }
        }

        // Common Exploits
        const exploitMatch = checkPatterns(value, ATTACK_PATTERNS.exploits, 'Exploit Attempt');
        if (exploitMatch) {
            if (WAF_CONFIG.logAttacks) {
                logAttack(req, 'Exploit Attempt', exploitMatch.pattern, value);
            }
            if (WAF_CONFIG.blockOnDetection) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Request blocked by security policy'
                });
            }
        }
    }

    // All checks passed
    next();
}

// Get WAF statistics
function getWafStats() {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;

    const recentLogs = attackLogs.filter(log => new Date(log.timestamp).getTime() > oneHourAgo);
    const dailyLogs = attackLogs.filter(log => new Date(log.timestamp).getTime() > oneDayAgo);

    const attackTypes = {};
    for (const log of dailyLogs) {
        attackTypes[log.attackType] = (attackTypes[log.attackType] || 0) + 1;
    }

    return {
        totalBlocked: attackLogs.length,
        blockedLastHour: recentLogs.length,
        blockedLast24Hours: dailyLogs.length,
        attackTypes,
        recentAttacks: attackLogs.slice(-10).reverse(),
    };
}

// Initialize
loadAttackLogs();

module.exports = {
    wafMiddleware,
    getWafStats,
    WAF_CONFIG,
    ATTACK_PATTERNS,
};
