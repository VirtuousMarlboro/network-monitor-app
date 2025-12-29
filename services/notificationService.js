/**
 * Notification Service - Telegram and Push Notifications
 * Extracted from server.js for better modularity
 */

const https = require('https');

// ========================================
// Configuration (injected from server.js)
// ========================================
let telegramConfig = {
    botToken: '',
    chatId: ''
};

let webpushInstance = null;
let pushSubscriptions = [];

/**
 * Configure Telegram settings
 */
function configureTelegram(config) {
    telegramConfig = { ...telegramConfig, ...config };
}

/**
 * Configure push notifications
 */
function configurePush(webpush, subscriptions) {
    webpushInstance = webpush;
    pushSubscriptions = subscriptions;
}

/**
 * Get current configuration status
 */
function getConfigStatus() {
    return {
        telegram: {
            configured: !!(telegramConfig.botToken && telegramConfig.chatId)
        },
        push: {
            configured: !!webpushInstance,
            subscriptions: pushSubscriptions.length
        }
    };
}

// ========================================
// Telegram Service with Rate Limiting
// ========================================
const telegramQueue = {
    queue: [],
    isProcessing: false,
    maxMessagesPerMinute: 20,
    messageTimestamps: [],
    delayBetweenMessages: 3000,
    maxRetries: 2,
    baseDelay: 5000,

    canSendMessage: function () {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        this.messageTimestamps = this.messageTimestamps.filter(ts => ts > oneMinuteAgo);
        return this.messageTimestamps.length < this.maxMessagesPerMinute;
    },

    getWaitTime: function () {
        if (this.messageTimestamps.length === 0) return 0;

        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        this.messageTimestamps = this.messageTimestamps.filter(ts => ts > oneMinuteAgo);

        if (this.messageTimestamps.length < this.maxMessagesPerMinute) {
            return this.delayBetweenMessages;
        }

        const oldestTimestamp = Math.min(...this.messageTimestamps);
        const waitTime = (oldestTimestamp + 60000) - now + 1000;
        return Math.max(waitTime, this.delayBetweenMessages);
    },

    enqueue: function (message) {
        const isDuplicate = this.queue.some(item => item.message === message);
        if (!isDuplicate) {
            if (this.queue.length >= 50) {
                console.warn('⚠️ Telegram queue full (50), dropping oldest message');
                this.queue.shift();
            }
            this.queue.push({ message, retries: 0, addedAt: Date.now() });
            console.log(`📬 Telegram queue: ${this.queue.length} message(s) pending`);
            this.processQueue();
        } else {
            console.log('📬 Duplicate message skipped');
        }
    },

    processQueue: async function () {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;

        while (this.queue.length > 0) {
            const item = this.queue[0];

            // Wait for rate limit if needed
            if (!this.canSendMessage()) {
                const waitTime = this.getWaitTime();
                console.log(`⏳ Rate limited, waiting ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            try {
                await this.sendRequest(item.message);
                this.messageTimestamps.push(Date.now());
                this.queue.shift(); // Remove successful message
            } catch (error) {
                console.error('❌ Telegram send failed:', error.message);

                // Handle rate limiting from Telegram API
                if (error.retryAfter) {
                    console.log(`⏳ Telegram rate limited, waiting ${error.retryAfter}s...`);
                    await new Promise(resolve => setTimeout(resolve, error.retryAfter * 1000));
                    continue;
                }

                // Retry logic
                if (item.retries < this.maxRetries) {
                    item.retries++;
                    console.log(`🔄 Retrying (${item.retries}/${this.maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, this.baseDelay));
                } else {
                    console.error('❌ Max retries reached, dropping message');
                    this.queue.shift();
                }
            }

            // Small delay between messages
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        this.isProcessing = false;
    },

    sendRequest: function (message) {
        if (!telegramConfig.botToken || !telegramConfig.chatId) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
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
                timeout: 10000
            };

            const req = https.request(options, (res) => {
                let responseBody = '';
                res.on('data', chunk => responseBody += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        console.log('✅ Telegram notification sent');
                        resolve();
                    } else {
                        const error = new Error(`Telegram API: ${res.statusCode}`);
                        error.status = res.statusCode;
                        try {
                            const body = JSON.parse(responseBody);
                            if (body.parameters && body.parameters.retry_after) {
                                error.retryAfter = body.parameters.retry_after;
                            }
                        } catch (e) { /* ignore */ }
                        reject(error);
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            req.on('error', reject);
            req.end();
        });
    },

    getStatus: function () {
        return {
            queueLength: this.queue.length,
            isProcessing: this.isProcessing,
            messagesLastMinute: this.messageTimestamps.filter(ts => ts > Date.now() - 60000).length,
            maxPerMinute: this.maxMessagesPerMinute
        };
    }
};

// ========================================
// Public API
// ========================================

/**
 * Send Telegram notification (queued with rate limiting)
 */
function sendTelegram(message) {
    telegramQueue.enqueue(message);
    return Promise.resolve();
}

/**
 * Send push notification to all subscribers
 */
async function sendPushToAll(payload) {
    if (!webpushInstance || pushSubscriptions.length === 0) {
        return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const sub of pushSubscriptions) {
        try {
            await webpushInstance.sendNotification(sub, JSON.stringify(payload));
            sent++;
        } catch (error) {
            console.error('Push notification failed:', error.message);
            failed++;
        }
    }

    return { sent, failed };
}

/**
 * Get queue status for debugging
 */
function getTelegramStatus() {
    return telegramQueue.getStatus();
}

// ========================================
// Exports
// ========================================
module.exports = {
    // Configuration
    configureTelegram,
    configurePush,
    getConfigStatus,

    // Telegram
    sendTelegram,
    getTelegramStatus,

    // Push
    sendPushToAll
};
