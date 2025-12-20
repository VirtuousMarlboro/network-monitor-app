/**
 * Settings Routes
 * Handles application settings, WAF stats, and admin configuration
 */
const express = require('express');
const https = require('https');

/**
 * Factory function to create settings routes
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getTelegramConfig - Get telegram config object
 * @param {Function} deps.setTelegramConfig - Set telegram config
 * @param {Function} deps.getProbeInterval - Get current probe interval
 * @param {Function} deps.setProbeInterval - Set probe interval
 * @param {Function} deps.saveSettings - Save settings to file
 * @param {Function} deps.stopAutoPing - Stop auto ping function
 * @param {Function} deps.startAutoPing - Start auto ping function
 * @param {Function} deps.getWafStats - Get WAF statistics
 * @param {Object} deps.middleware - { requireAdmin }
 * @returns {express.Router}
 */
function createSettingsRoutes(deps) {
    const router = express.Router();
    const {
        getTelegramConfig, setTelegramConfig,
        getProbeInterval, setProbeInterval,
        saveSettings, stopAutoPing, startAutoPing,
        getWafStats, middleware
    } = deps;

    // GET /api/settings - Get current settings
    router.get('/', middleware.requireAdmin, (req, res) => {
        res.json({
            telegram: getTelegramConfig(),
            pingInterval: getProbeInterval() / 1000 // Send in seconds
        });
    });

    // POST /api/settings - Update settings
    router.post('/', middleware.requireAdmin, (req, res) => {
        const { telegram, pingInterval } = req.body;

        if (telegram) {
            setTelegramConfig({
                botToken: telegram.botToken || '',
                chatId: telegram.chatId || ''
            });
        }

        if (pingInterval) {
            const newInterval = parseInt(pingInterval) * 1000;
            const currentInterval = getProbeInterval();
            if (newInterval >= 1000 && newInterval !== currentInterval) {
                setProbeInterval(newInterval);
                // Restart auto ping with new interval
                stopAutoPing();
                startAutoPing();
            }
        }

        saveSettings();
        res.json({
            message: 'Settings saved',
            telegram: getTelegramConfig(),
            pingInterval: getProbeInterval() / 1000
        });
    });

    // POST /api/settings/test-telegram - Test Telegram notification
    router.post('/test-telegram', middleware.requireAdmin, (req, res) => {
        const { botToken, chatId } = req.body;
        const telegramConfig = getTelegramConfig();

        // Use provided credentials or stored ones
        const tokenToUse = botToken || telegramConfig.botToken;
        const chatToUse = chatId || telegramConfig.chatId;

        if (!tokenToUse || !chatToUse) {
            return res.status(400).json({ error: 'Bot Token and Chat ID are required' });
        }

        // Use GET with URL-encoded parameters
        const params = new URLSearchParams({
            chat_id: chatToUse,
            text: '🔔 *Network Monitor Test Notification*\n\nThis is a test message from your Network Monitor.',
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

        request.end();
    });

    // GET /api/waf/stats - Get WAF statistics (mounted separately at /api/waf)
    // This is a separate router for WAF-related endpoints
    router.get('/waf/stats', middleware.requireAdmin, (req, res) => {
        res.json(getWafStats());
    });

    return router;
}

module.exports = { createSettingsRoutes };
