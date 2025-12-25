// ========================================
// Network Monitor - Frontend Application
// ========================================

const API_BASE = '';
let autoRefreshInterval = null;
let currentHistoryHostId = null;
let eventSource = null;
let notificationSound = null;

// Map variables
let networkMap = null;
let hostMarkers = {};
let markerCluster = null;
let locationPickerMap = null;
let locationPickerMarker = null;
let currentLocationHostId = null;
let cachedHosts = [];
let currentSearchQuery = '';
let currentStatusFilter = 'all'; // 'all', 'online', 'offline'
let currentUser = null;
let cachedTickets = [];
let currentTicketStatusFilter = '';
let currentTicketSearchQuery = '';
let currentTicketPage = 1;
let ticketsPerPage = 10;
let cachedUsers = []; // For PIC selection
let statusLogs = []; // Cache for status change logs

// Abort Controllers for streams
let currentPingController = null;
let currentTracerouteController = null;
let currentSnmpScanController = null; // For canceling SNMP scans when modal closes

// System Notification Permission State
let systemNotificationsEnabled = false;

// Host Groups State
let cachedHostGroups = [];
let currentGroupFilter = '';

// PWA & Push Notification State
let swRegistration = null;
let pushSubscription = null;

// ========================================
// Theme Toggle (Dark/Light Mode)
// ========================================

/**
 * Initialize theme from localStorage or system preference
 */
function initTheme() {
    const savedTheme = localStorage.getItem('nms-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    } else if (!prefersDark) {
        document.documentElement.setAttribute('data-theme', 'light');
    }
    // Default is dark (no attribute needed as CSS defaults to dark)

    updateThemeIcon();
}

/**
 * Toggle between dark and light themes
 */
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    if (newTheme === 'dark') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', newTheme);
    }

    localStorage.setItem('nms-theme', newTheme);
    updateThemeIcon();
    showNotification(`Tema diubah ke ${newTheme === 'dark' ? 'gelap' : 'terang'}`, 'info');
}

/**
 * Update theme toggle button icon
 */
function updateThemeIcon() {
    const sunIcon = document.querySelector('.theme-icon-sun');
    const moonIcon = document.querySelector('.theme-icon-moon');
    const currentTheme = document.documentElement.getAttribute('data-theme');

    if (sunIcon && moonIcon) {
        if (currentTheme === 'light') {
            sunIcon.classList.add('hidden');
            moonIcon.classList.remove('hidden');
        } else {
            sunIcon.classList.remove('hidden');
            moonIcon.classList.add('hidden');
        }
    }
}

// ========================================
// System Notifications (Web Notifications API)
// ========================================

/**
 * Request permission for system notifications
 */
function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log('This browser does not support system notifications');
        return;
    }

    if (Notification.permission === 'granted') {
        systemNotificationsEnabled = true;
        console.log('✅ System notifications enabled');
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                systemNotificationsEnabled = true;
                console.log('✅ System notifications enabled');
                showNotification('Notifikasi sistem diaktifkan!', 'success');
            }
        });
    }
}

/**
 * Send a native system notification
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @param {string} type - 'up' or 'down' for icon selection
 */
function sendSystemNotification(title, body, type = 'info') {
    // Check permission directly (more reliable than variable after page refresh)
    if (!('Notification' in window)) {
        return;
    }

    if (Notification.permission !== 'granted') {
        return;
    }

    const icon = type === 'down'
        ? 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="%23ef4444"/></svg>'
        : type === 'up'
            ? 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="%2310b981"/></svg>'
            : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="%233b82f6"/></svg>';

    try {
        const notification = new Notification(title, {
            body: body,
            icon: icon,
            tag: `nms-${type}-${Date.now()}`, // Unique tag to allow multiple notifications
            requireInteraction: type === 'down', // Keep down notifications until clicked
            silent: false // Allow system sound
        });

        // Auto-close after 10 seconds (for non-critical)
        if (type !== 'down') {
            setTimeout(() => notification.close(), 10000);
        }

        // Focus window when notification is clicked
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    } catch (error) {
        console.error('[DEBUG] Failed to send system notification:', error);
    }
}

// DOM Elements
const elements = {
    // Auth
    logoutBtn: document.getElementById('logoutBtn'),
    editProfileBtn: document.getElementById('editProfileBtn'),
    currentUserName: document.getElementById('currentUserName'),

    // Edit Profile Modal
    editProfileModal: document.getElementById('editProfileModal'),
    closeEditProfileBtn: document.getElementById('closeEditProfileBtn'),
    cancelEditProfileBtn: document.getElementById('cancelEditProfileBtn'),
    saveProfileBtn: document.getElementById('saveProfileBtn'),
    profileUsernameInput: document.getElementById('profileUsernameInput'),
    profileNameInput: document.getElementById('profileNameInput'),
    profilePasswordInput: document.getElementById('profilePasswordInput'),

    // Header
    pingAllBtn: document.getElementById('pingAllBtn'),
    offlineCount: document.getElementById('offlineCount'),
    totalCount: document.getElementById('totalCount'),
    avgLatency: document.getElementById('avgLatency'),

    // Stats
    onlineCount: document.getElementById('onlineCount'),
    statCardOnline: document.getElementById('statCardOnline'),
    statCardOffline: document.getElementById('statCardOffline'),
    statCardTotal: document.getElementById('statCardTotal'),

    // Buttons
    pingAllBtn: document.getElementById('pingAllBtn'),
    addHostBtn: document.getElementById('addHostBtn'),
    addFirstHostBtn: document.getElementById('addFirstHostBtn'),
    restoreMapBtn: document.getElementById('restoreMapBtn'),

    // Quick Ping
    quickPingInput: document.getElementById('quickPingInput'),
    quickPingBtn: document.getElementById('quickPingBtn'),
    quickPingResult: document.getElementById('quickPingResult'),

    // Hosts
    hostSearchInput: document.getElementById('hostSearchInput'),
    hostsGrid: document.getElementById('hostsGrid'),
    emptyState: document.getElementById('emptyState'),
    autoRefreshToggle: document.getElementById('autoRefreshToggle'),

    // Auto Ping
    autoPingToggle: document.getElementById('autoPingToggle'),
    autoPingStatus: document.getElementById('autoPingStatus'),

    // Notifications
    notificationsContainer: document.getElementById('notificationsContainer'),

    // Add Host Modal
    addHostModal: document.getElementById('addHostModal'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    cancelModalBtn: document.getElementById('cancelModalBtn'),
    saveHostBtn: document.getElementById('saveHostBtn'),
    hostInput: document.getElementById('hostInput'),
    nameInput: document.getElementById('nameInput'),
    cidInput: document.getElementById('cidInput'),
    addLocationToggle: document.getElementById('addLocationToggle'),
    addHostLocationFields: document.getElementById('addHostLocationFields'),
    addHostAddressInput: document.getElementById('addHostAddressInput'),
    searchAddHostAddressBtn: document.getElementById('searchAddHostAddressBtn'),
    addHostSearchResults: document.getElementById('addHostSearchResults'),
    addHostCoordinatesInput: document.getElementById('addHostCoordinatesInput'),

    // Traceroute
    tracerouteModal: document.getElementById('tracerouteModal'),
    tracerouteHostName: document.getElementById('tracerouteHostName'),
    tracerouteOutput: document.getElementById('tracerouteOutput'),
    closeTracerouteBtn: document.getElementById('closeTracerouteBtn'),
    closeTracerouteModalBtn: document.getElementById('closeTracerouteModalBtn'),

    // Ping Modal (New)
    pingModal: document.getElementById('pingModal'),
    pingHostName: document.getElementById('pingHostName'),
    pingOutput: document.getElementById('pingOutput'),
    closePingBtn: document.getElementById('closePingBtn'),
    closePingModalBtn: document.getElementById('closePingModalBtn'),

    // Edit Host Modal
    editHostModal: document.getElementById('editHostModal'),
    closeEditHostModalBtn: document.getElementById('closeEditHostModalBtn'),
    cancelEditHostModalBtn: document.getElementById('cancelEditHostModalBtn'),
    saveEditHostBtn: document.getElementById('saveEditHostBtn'),
    editHostId: document.getElementById('editHostId'),
    editHostInput: document.getElementById('editHostInput'),
    editNameInput: document.getElementById('editNameInput'),
    editCidInput: document.getElementById('editCidInput'),
    editCoordinatesInput: document.getElementById('editCoordinatesInput'),
    editAddressSearchInput: document.getElementById('editAddressSearchInput'),
    editSearchAddressBtn: document.getElementById('editSearchAddressBtn'),
    editAddressSearchResults: document.getElementById('editAddressSearchResults'),

    // History Modal
    historyModal: document.getElementById('historyModal'),
    closeHistoryBtn: document.getElementById('closeHistoryBtn'),
    historyHostName: document.getElementById('historyHostName'),
    historyChart: document.getElementById('historyChart'),
    historyList: document.getElementById('historyList'),

    // View Tabs
    hostsTabBtn: document.getElementById('hostsTabBtn'),
    mapTabBtn: document.getElementById('mapTabBtn'),
    logsTabBtn: document.getElementById('logsTabBtn'),

    // Sections
    hostsSection: document.querySelector('.hosts-section'),
    mapSection: document.getElementById('mapSection'),
    logsSection: document.getElementById('logsSection'),
    networkMap: document.getElementById('networkMap'),

    // Logs
    logsList: document.getElementById('logsList'),
    refreshLogsBtn: document.getElementById('refreshLogsBtn'),
    logHostFilter: document.getElementById('logHostFilter'),

    // Location Modal
    locationModal: document.getElementById('locationModal'),
    closeLocationBtn: document.getElementById('closeLocationBtn'),
    cancelLocationBtn: document.getElementById('cancelLocationBtn'),
    saveLocationBtn: document.getElementById('saveLocationBtn'),
    locationHostName: document.getElementById('locationHostName'),
    coordinatesInput: document.getElementById('coordinatesInput'),
    locationPickerMap: document.getElementById('locationPickerMap'),

    // Address Search
    addressSearchInput: document.getElementById('addressSearchInput'),
    searchAddressBtn: document.getElementById('searchAddressBtn'),
    addressSearchInput: document.getElementById('addressSearchInput'),
    searchAddressBtn: document.getElementById('searchAddressBtn'),
    addressSearchResults: document.getElementById('addressSearchResults'),

    // Users Management
    usersTabBtn: document.getElementById('usersTabBtn'),
    usersSection: document.getElementById('usersSection'),
    usersTableBody: document.getElementById('usersTableBody'),
    addUserBtn: document.getElementById('addUserBtn'),

    // Add User Modal
    addUserModal: document.getElementById('addUserModal'),
    closeAddUserModalBtn: document.getElementById('closeAddUserModalBtn'),
    cancelAddUserModalBtn: document.getElementById('cancelAddUserModalBtn'),
    saveUserBtn: document.getElementById('saveUserBtn'),
    newUsernameInput: document.getElementById('newUsernameInput'),
    newPasswordInput: document.getElementById('newPasswordInput'),
    newNameInput: document.getElementById('newNameInput'),
    newRoleInput: document.getElementById('newRoleInput'),

    // Edit User Modal
    editUserModal: document.getElementById('editUserModal'),
    closeEditUserModalBtn: document.getElementById('closeEditUserModalBtn'),
    cancelEditUserModalBtn: document.getElementById('cancelEditUserModalBtn'),
    saveEditUserBtn: document.getElementById('saveEditUserBtn'),
    editUserId: document.getElementById('editUserId'),
    editUsernameInput: document.getElementById('editUsernameInput'),
    editPasswordInput: document.getElementById('editPasswordInput'),
    editUserRealNameInput: document.getElementById('editUserRealNameInput'),
    editUserRoleInput: document.getElementById('editUserRoleInput'),

    // Tickets
    ticketsTabBtn: document.getElementById('ticketsTabBtn'),
    // Tickets
    ticketsSection: document.getElementById('ticketsSection'),
    ticketsList: document.getElementById('ticketsList'),
    ticketSearchInput: document.getElementById('ticketSearchInput'),
    ticketStatusFilter: document.getElementById('ticketStatusFilter'),
    ticketHostFilter: document.getElementById('ticketHostFilter'),
    ticketSubmitterFilter: document.getElementById('ticketSubmitterFilter'),
    ticketDateFilter: document.getElementById('ticketDateFilter'),
    openCreateTicketModalBtn: document.getElementById('openCreateTicketModalBtn'),

    // Create Ticket Modal
    createTicketModal: document.getElementById('createTicketModal'),
    closeCreateTicketBtn: document.getElementById('closeCreateTicketBtn'),
    cancelCreateTicketBtn: document.getElementById('cancelCreateTicketBtn'),
    saveTicketBtn: document.getElementById('saveTicketBtn'),
    ticketHostSearchInput: document.getElementById('ticketHostSearchInput'),
    ticketHostId: document.getElementById('ticketHostId'),
    ticketHostSearchResults: document.getElementById('ticketHostSearchResults'),
    exportTicketsBtn: document.getElementById('exportTicketsBtn'),
    ticketTitleInput: document.getElementById('ticketTitleInput'),
    ticketDescInput: document.getElementById('ticketDescInput'),
    ticketPrioritySelect: document.getElementById('ticketPrioritySelect'),

    // Edit Ticket Modal
    editTicketModal: document.getElementById('editTicketModal'),
    closeEditTicketBtn: document.getElementById('closeEditTicketBtn'),
    cancelEditTicketBtn: document.getElementById('cancelEditTicketBtn'),
    saveEditTicketBtn: document.getElementById('saveEditTicketBtn'),
    deleteTicketBtn: document.getElementById('deleteTicketBtn'),
    editTicketId: document.getElementById('editTicketId'),
    editTicketIdDisplay: document.getElementById('editTicketIdDisplay'),
    editTicketHost: document.getElementById('editTicketHost'),
    editTicketCid: document.getElementById('editTicketCid'),
    editTicketSource: document.getElementById('editTicketSource'),
    editTicketCreated: document.getElementById('editTicketCreated'),
    editTicketCreatedDisplay: document.getElementById('editTicketCreatedDisplay'),
    editTicketStatus: document.getElementById('editTicketStatus'),
    editTicketStatusDisplay: document.getElementById('editTicketStatusDisplay'),
    editTicketPriority: document.getElementById('editTicketPriority'),
    editTicketDesc: document.getElementById('editTicketDesc'),

    // Ticket Search
    // ticketSearchInput: document.getElementById('ticketSearchInput'), // Duplicate, already defined above

    // Ticket Comments
    ticketCommentsList: document.getElementById('ticketCommentsList'),
    newCommentInput: document.getElementById('newCommentInput'),
    addCommentBtn: document.getElementById('addCommentBtn'),

    // Ticket Attachments & Images
    ticketImageInput: document.getElementById('ticketImageInput'),
    ticketImagePreview: document.getElementById('ticketImagePreview'),
    commentImageInput: document.getElementById('commentImageInput'),
    commentImagePreview: document.getElementById('commentImagePreview'),
    ticketAttachmentsList: document.getElementById('ticketAttachmentsList'),

    // Ticket PIC
    ticketPicInput: document.getElementById('ticketPicInput'),
    editTicketPic: document.getElementById('editTicketPic'),

    // Settings
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsModalBtn: document.getElementById('closeSettingsModalBtn'),
    cancelSettingsModalBtn: document.getElementById('cancelSettingsModalBtn'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    telegramBotToken: document.getElementById('telegramBotToken'),
    telegramChatId: document.getElementById('telegramChatId'),
    testTelegramBtn: document.getElementById('testTelegramBtn'),

    // Change Password Modal (Forced)
    changePasswordModal: document.getElementById('changePasswordModal'),
    newPasswordInput: document.getElementById('newPasswordInput'),
    confirmPasswordInput: document.getElementById('confirmPasswordInput'),
    saveNewPasswordBtn: document.getElementById('saveNewPasswordBtn'),

    // Phase 1: Host Groups
    hostGroupFilter: document.getElementById('hostGroupFilter'),
    hostActionsBtn: document.getElementById('hostActionsBtn'),
    hostActionsMenu: document.getElementById('hostActionsMenu'),
    exportHostsJsonBtn: document.getElementById('exportHostsJsonBtn'),
    exportHostsCsvBtn: document.getElementById('exportHostsCsvBtn'),
    importHostsBtn: document.getElementById('importHostsBtn'),
    manageGroupsBtn: document.getElementById('manageGroupsBtn'),
    hostGroupSelect: document.getElementById('hostGroupSelect'),
    editHostGroupSelect: document.getElementById('editHostGroupSelect'),

    // Phase 1: Audit Log Tab
    auditTabBtn: document.getElementById('auditTabBtn'),
    auditSection: document.getElementById('auditSection'),

    // Phase 2: Statistics Tab
    statsTabBtn: document.getElementById('statsTabBtn'),
    statsSection: document.getElementById('statsSection'),

    // Phase 2: Scheduled Maintenance
    maintenanceBtn: document.getElementById('maintenanceBtn'),
    maintenanceModal: document.getElementById('maintenanceModal'),
    closeMaintenanceModalBtn: document.getElementById('closeMaintenanceModalBtn'),
    maintenanceAllHosts: document.getElementById('maintenanceAllHosts'),
    maintenanceHostSelectGroup: document.getElementById('maintenanceHostSelectGroup'),
    maintenanceHostSelect: document.getElementById('maintenanceHostSelect'),
    maintenanceStartTime: document.getElementById('maintenanceStartTime'),
    maintenanceEndTime: document.getElementById('maintenanceEndTime'),
    maintenanceReason: document.getElementById('maintenanceReason'),
    createMaintenanceBtn: document.getElementById('createMaintenanceBtn'),
    maintenanceList: document.getElementById('maintenanceList')
};

// ========================================
// Audio System (Web Audio API)
// ========================================
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playHostDownSound() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Alert sound: Dual descending sine (Softer warning)
    oscillator.type = 'sine';

    // First beep
    oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
    oscillator.frequency.linearRampToValueAtTime(300, audioCtx.currentTime + 0.2);

    gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.25);

    // Optional: Second beep for urgency feel without harshness (Uncomment if needed)
    /*
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(440, audioCtx.currentTime + 0.3);
    osc2.frequency.linearRampToValueAtTime(300, audioCtx.currentTime + 0.5);
    gain2.gain.setValueAtTime(0.2, audioCtx.currentTime + 0.3);
    gain2.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    osc2.start(audioCtx.currentTime + 0.3);
    osc2.stop(audioCtx.currentTime + 0.55);
    */
}

function playHostUpSound() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Success sound: High pitch sine (Ding)
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(500, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1000, audioCtx.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.5);
}

// ========================================
// Server-Sent Events (SSE) Connection
// ========================================

function connectSSE() {
    if (eventSource) {
        eventSource.close();
    }

    eventSource = new EventSource(`${API_BASE}/api/events`);

    eventSource.addEventListener('connected', (e) => {
        console.log('✅ Connected to server:', JSON.parse(e.data));
        showNotification('Terhubung ke server', 'info');
    });

    eventSource.addEventListener('hosts-update', (e) => {
        const hosts = JSON.parse(e.data);
        cachedHosts = hosts;
        renderFilteredHosts();
        updateStats(hosts);
        updateMapMarkers(hosts);

        // Sync with Alpine Store
        if (window.Alpine && Alpine.store('app')) {
            Alpine.store('app').setHosts(hosts);
        }
    });

    eventSource.addEventListener('alerts', (e) => {
        const alerts = JSON.parse(e.data);
        alerts.forEach(alert => {
            if (alert.type === 'down') {
                showNotification(
                    `⚠️ HOST DOWN: ${alert.name} (${alert.host})`,
                    'danger'
                );
                // System notification disabled - using push notifications instead
                // sendSystemNotification(
                //     '⚠️ HOST DOWN',
                //     `${alert.name} (${alert.host}) tidak dapat dijangkau`,
                //     'down'
                // );
                playHostDownSound();
            } else if (alert.type === 'up') {
                showNotification(
                    `✅ HOST UP: ${alert.name} (${alert.host}) - ${alert.latency}ms`,
                    'success'
                );
                // System notification disabled - using push notifications instead
                // sendSystemNotification(
                //     '✅ HOST UP',
                //     `${alert.name} (${alert.host}) kembali online - ${alert.latency}ms`,
                //     'up'
                // );
                playHostUpSound();
            }
        });
    });

    // Auto-ping is always enabled now - no need to track status changes

    eventSource.addEventListener('host-added', (e) => {
        // Host added - UI will update via hosts-update event
        console.log('Host added:', JSON.parse(e.data));
    });

    eventSource.addEventListener('host-removed', (e) => {
        // Host removed - UI will update via hosts-update event
        console.log('Host removed:', JSON.parse(e.data));
    });

    // Realtime log updates (status changes)
    eventSource.addEventListener('log-update', (e) => {
        try {
            const logEntry = JSON.parse(e.data);
            console.log('📋 Log update received:', logEntry);

            // Add to cached logs
            statusLogs.unshift(logEntry);
            if (statusLogs.length > 1000) statusLogs.pop();

            // Re-render logs if on logs tab
            if (!elements.logsSection?.classList.contains('hidden')) {
                loadAndRenderLogs();
            }
        } catch (err) {
            console.error('Failed to parse log-update:', err);
        }
    });

    eventSource.onerror = (e) => {
        console.error('SSE connection error:', e);
        showNotification('Koneksi terputus, mencoba menghubungkan ulang...', 'warning');

        // Reconnect after 3 seconds
        setTimeout(connectSSE, 3000);
    };
}

// ========================================
// Notification System
// ========================================

function showNotification(message, type = 'info', persistent = false) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${getNotificationIcon(type)}</span>
            <span class="notification-message"></span>
        </div>
        <button class="notification-close">&times;</button>
    `;
    notification.querySelector('.notification-message').textContent = message;

    // Add click handler to close button
    notification.querySelector('.notification-close').addEventListener('click', () => {
        closeNotification(notification);
    });

    elements.notificationsContainer.appendChild(notification);

    // Trigger animation
    requestAnimationFrame(() => {
        notification.classList.add('show');
    });

    // Auto-remove after timeout (unless persistent)
    if (!persistent) {
        setTimeout(() => {
            closeNotification(notification);
        }, 5000);
    }

    // Keep max 5 notifications
    const notifications = elements.notificationsContainer.querySelectorAll('.notification');
    if (notifications.length > 5) {
        closeNotification(notifications[0]);
    }
}

function closeNotification(notification) {
    notification.classList.remove('show');
    notification.classList.add('hiding');
    setTimeout(() => {
        notification.remove();
    }, 300);
}

function getNotificationIcon(type) {
    switch (type) {
        case 'success': return '✅';
        case 'danger': return '🚨';
        case 'warning': return '⚠️';
        default: return 'ℹ️';
    }
}

function playHostDownSound() {
    // Alarm/Siren sound for Host Down
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = 'sawtooth';
        oscillator.frequency.value = 800; // Start high
        gainNode.gain.value = 0.3;

        // Descending pitch (Siren effect)
        oscillator.frequency.linearRampToValueAtTime(300, audioContext.currentTime + 0.5);
        gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.5);

        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.6);

        // Cleanup
        setTimeout(() => audioContext.close(), 700);
    } catch (e) {
        console.log('Could not play host down sound:', e);
    }
}

function playHostUpSound() {
    // Positive Chime for Host Up
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const gainNode = audioContext.createGain();
        gainNode.connect(audioContext.destination);
        gainNode.gain.value = 0.2;

        const now = audioContext.currentTime;

        // Simple Major Triad (C - E - G)
        const notes = [523.25, 659.25, 783.99]; // C5, E5, G5

        notes.forEach((freq, i) => {
            const osc = audioContext.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq;
            osc.connect(gainNode);
            osc.start(now + i * 0.1);
            osc.stop(now + i * 0.1 + 0.3);
        });

        // Cleanup
        setTimeout(() => audioContext.close(), 1000);
    } catch (e) {
        console.log('Could not play host up sound:', e);
    }
}

// ========================================
// Image Preview Functions
// ========================================

function showImagePreview(files, previewContainer, allowMultiple = false) {
    if (!previewContainer) return;

    previewContainer.innerHTML = '';

    if (!files || files.length === 0) return;

    const maxFiles = allowMultiple ? 5 : 1;
    const filesToShow = Array.from(files).slice(0, maxFiles);

    filesToShow.forEach((file, index) => {
        if (!file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const previewItem = document.createElement('div');
            previewItem.className = 'preview-item';
            previewItem.innerHTML = `
                <img src="${e.target.result}" alt="Preview ${index + 1}">
                <button type="button" class="remove-preview-btn" data-index="${index}" title="Hapus">&times;</button>
            `;
            previewContainer.appendChild(previewItem);

            // Add remove button handler
            const removeBtn = previewItem.querySelector('.remove-preview-btn');
            removeBtn.addEventListener('click', () => {
                previewItem.remove();
                // Note: Can't programmatically remove from FileList, 
                // but the preview is removed for UX
            });
        };
        reader.readAsDataURL(file);
    });
}

// ========================================
// API Functions
// ========================================

async function fetchHosts() {
    try {
        const response = await fetch(`${API_BASE}/api/hosts`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching hosts:', error);
        return [];
    }
}

async function addHost(host, name, latitude = null, longitude = null, cid = null, groupId = null, snmpEnabled = false, snmpCommunity = null, snmpVersion = null) {
    try {
        const response = await fetch(`${API_BASE}/api/hosts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, name, latitude, longitude, cid, groupId, snmpEnabled, snmpCommunity, snmpVersion })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Gagal menambahkan host');
        }
        return data;
    } catch (error) {
        console.error('Error adding host:', error);
        throw error;
    }
}

async function updateHost(id, host, name, cid = null, latitude = null, longitude = null, groupId = null, snmpEnabled = false, snmpCommunity = null, snmpVersion = null, snmpInterface = null) {
    try {
        const response = await fetch(`${API_BASE}/api/hosts/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, name, cid, latitude, longitude, groupId, snmpEnabled, snmpCommunity, snmpVersion, snmpInterface })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Gagal memperbarui host');
        }
        return data;
    } catch (error) {
        console.error('Error updating host:', error);
        throw error;
    }
}

async function deleteHost(id) {
    try {
        const response = await fetch(`${API_BASE}/api/hosts/${id}`, {
            method: 'DELETE'
        });
        return await response.json();
    } catch (error) {
        console.error('Error deleting host:', error);
        throw error;
    }
}

async function pingHost(id) {
    try {
        const response = await fetch(`${API_BASE}/api/ping/${id}`, {
            method: 'POST'
        });
        return await response.json();
    } catch (error) {
        console.error('Error pinging host:', error);
        throw error;
    }
}

async function pingAllHosts() {
    try {
        const response = await fetch(`${API_BASE}/api/ping-all`, {
            method: 'POST'
        });
        return await response.json();
    } catch (error) {
        console.error('Error pinging all hosts:', error);
        throw error;
    }
}

async function quickPing(host) {
    try {
        const response = await fetch(`${API_BASE}/api/quick-ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host })
        });
        return await response.json();
    } catch (error) {
        console.error('Error quick pinging:', error);
        throw error;
    }
}

async function fetchHistory(id) {
    try {
        const response = await fetch(`${API_BASE}/api/history/${id}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching history:', error);
        return [];
    }
}

/**
 * Refresh all data from the server
 * Called after adding/deleting hosts to ensure UI is up-to-date
 */
async function refreshData() {
    try {
        const hosts = await fetchHosts();
        cachedHosts = hosts;
        renderFilteredHosts();
        updateStats(hosts);
        updateMapMarkers(hosts);
    } catch (error) {
        console.error('Error refreshing data:', error);
    }
}

async function toggleAutoPing() {
    try {
        const response = await fetch(`${API_BASE}/api/auto-ping/toggle`, {
            method: 'POST'
        });
        return await response.json();
    } catch (error) {
        console.error('Error toggling auto-ping:', error);
        throw error;
    }
}

// ========================================
// Settings API Functions
// ========================================

async function fetchSettings() {
    try {
        const response = await fetch(`${API_BASE}/api/settings`);
        if (!response.ok) throw new Error('Failed to fetch settings');
        return await response.json();
    } catch (error) {
        console.error('Error fetching settings:', error);
        return {};
    }
}

async function saveSettingsApi(settings) {
    try {
        const response = await fetch(`${API_BASE}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        if (!response.ok) throw new Error('Failed to save settings');
        return await response.json();
    } catch (error) {
        console.error('Error saving settings:', error);
        throw error;
    }
}

async function testTelegramApi(botToken, chatId) {
    try {
        const response = await fetch(`${API_BASE}/api/settings/test-telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ botToken, chatId })
        });
        return await response.json();
    } catch (error) {
        console.error('Error testing telegram:', error);
        throw error;
    }
}

// ========================================
// Ticket API Functions
// ========================================

async function fetchTickets() {
    try {
        const response = await fetch(`${API_BASE}/api/tickets`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching tickets:', error);
        return [];
    }
}

async function createTicketApi(ticketData, imageFiles = []) {
    const formData = new FormData();
    formData.append('hostId', ticketData.hostId || '');
    formData.append('title', ticketData.title);
    formData.append('description', ticketData.description || '');
    formData.append('priority', ticketData.priority || 'medium');
    formData.append('picName', ticketData.picName || '');

    // Append datetime fields if provided
    if (ticketData.createdAt) {
        formData.append('createdAt', ticketData.createdAt);
    }
    if (ticketData.firstResponseAt) {
        formData.append('firstResponseAt', ticketData.firstResponseAt);
    }

    // Append image files
    if (imageFiles && imageFiles.length > 0) {
        for (let i = 0; i < imageFiles.length && i < 5; i++) {
            formData.append('images', imageFiles[i]);
        }
    }

    const response = await fetch(`${API_BASE}/api/tickets`, {
        method: 'POST',
        body: formData
    });
    if (!response.ok) throw new Error('Failed to create ticket');
    return await response.json();
}


async function updateTicketApi(id, updates) {
    const response = await fetch(`${API_BASE}/api/tickets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
    if (!response.ok) throw new Error('Failed to update ticket');
    return await response.json();
}

async function deleteTicketApi(id) {
    const response = await fetch(`${API_BASE}/api/tickets/${id}`, {
        method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete ticket');
    return await response.json();
}

async function loadAndRenderTickets() {
    cachedTickets = await fetchTickets();
    renderTickets();
}

async function fetchUsersForPic() {
    try {
        const response = await fetch(`${API_BASE}/api/users/list`);
        if (response.ok) {
            cachedUsers = await response.json();
            // Also update submitter filter when users are loaded
            populateTicketFilters();
        }
    } catch (error) {
        console.error('Error fetching users for PIC:', error);
        cachedUsers = [];
    }
}

function populateTicketFilters() {
    // Populate Host Filter
    const hostSelect = elements.ticketHostFilter;
    const currentHost = hostSelect.value;
    hostSelect.innerHTML = '<option value="">Semua Host</option>' +
        cachedHosts.map(h => `<option value="${h.id}">${escapeHtml(h.name)}</option>`).join('');
    hostSelect.value = currentHost;

    // Populate Submitter Filter
    const submitterSelect = elements.ticketSubmitterFilter;
    const currentSubmitter = submitterSelect.value;

    // Get unique submitter IDs from cached tickets + cachedUsers
    const submitters = new Map();

    // Add known users
    cachedUsers.forEach(u => submitters.set(u.id, u.name || u.username));

    // Add submitters from existing tickets (in case user was deleted)
    cachedTickets.forEach(t => {
        if (t.submitterId && t.submitterName) {
            submitters.set(t.submitterId, t.submitterName);
        }
    });

    let options = '<option value="">Semua Submitter</option>';
    submitters.forEach((name, id) => {
        options += `<option value="${id}">${escapeHtml(name)}</option>`;
    });

    submitterSelect.innerHTML = options;
    submitterSelect.value = currentSubmitter;
}

function renderTickets() {
    if (!elements.ticketsList) return;

    let filtered = cachedTickets;

    // Filter by status
    if (currentTicketStatusFilter) {
        filtered = filtered.filter(t => t.status === currentTicketStatusFilter);
    }

    // Filter by Host
    if (elements.ticketHostFilter.value) {
        filtered = filtered.filter(t => t.hostId === elements.ticketHostFilter.value);
    }

    // Filter by Submitter
    if (elements.ticketSubmitterFilter.value) {
        filtered = filtered.filter(t => t.submitterId === elements.ticketSubmitterFilter.value);
    }

    // Filter by Date
    if (elements.ticketDateFilter.value) {
        const filterDate = new Date(elements.ticketDateFilter.value).toDateString();
        filtered = filtered.filter(t => new Date(t.createdAt).toDateString() === filterDate);
    }



    // Filter by search query
    if (currentTicketSearchQuery) {
        const query = currentTicketSearchQuery.toLowerCase();
        filtered = filtered.filter(t =>
            t.ticketId.toLowerCase().includes(query) ||
            t.title.toLowerCase().includes(query) ||
            t.hostName.toLowerCase().includes(query) ||
            (t.hostCid && t.hostCid.toLowerCase().includes(query)) ||
            (t.description && t.description.toLowerCase().includes(query)) ||
            (t.picName && t.picName.toLowerCase().includes(query))
        );
    }

    // Sort by createdAt (incident/incoming time) - newest first
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination calculations
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / ticketsPerPage);

    // Ensure current page is valid
    if (currentTicketPage > totalPages) {
        currentTicketPage = Math.max(1, totalPages);
    }

    const startIndex = (currentTicketPage - 1) * ticketsPerPage;
    const endIndex = startIndex + ticketsPerPage;
    const paginatedTickets = filtered.slice(startIndex, endIndex);

    if (filtered.length === 0) {
        elements.ticketsList.innerHTML = `
            <div class="tickets-empty">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                </svg>
                <p>Tidak ada tiket</p>
            </div>
        `;
        // Hide pagination when no tickets
        const paginationEl = document.getElementById('ticketsPagination');
        if (paginationEl) paginationEl.style.display = 'none';
        return;
    }

    elements.ticketsList.innerHTML = paginatedTickets.map(ticket => `
        <div class="ticket-card ${ticket.status} priority-${ticket.priority}" data-id="${ticket.id}">
            <div class="ticket-header">
                <span class="ticket-id">${escapeHtml(ticket.ticketId)}</span>
                <span class="ticket-source ${ticket.source}">${ticket.source === 'auto' ? '🤖 Auto' : '✏️ Manual'}</span>
            </div>
            <div class="ticket-title">${escapeHtml(ticket.title)}</div>

            <div class="ticket-meta">
                <span class="ticket-host">
                    ${escapeHtml(ticket.hostName)}
                    ${(() => {
            // Use saved CID or fallback to current host CID
            let cid = ticket.hostCid;
            if (!cid && ticket.hostId) {
                const host = cachedHosts.find(h => h.id === ticket.hostId);
                if (host) cid = host.cid;
            }
            return cid ? ` (${escapeHtml(cid)})` : '';
        })()}
                </span>
                <span class="ticket-time">${formatDateTime(ticket.createdAt)}</span>
            </div>
            ${ticket.resolvedAt ? `<div class="ticket-resolved-at"><span class="resolved-label">🕐 Solved:</span> ${formatDateTime(ticket.resolvedAt)}</div>` : ''}
            ${ticket.picName ? `<div class="ticket-pic"><span class="pic-label">PIC:</span> ${escapeHtml(ticket.picName)}</div>` : ''}
            ${ticket.submitterName ? `<div class="ticket-submitter"><span class="submitter-label">Submitted by:</span> ${escapeHtml(ticket.submitterName)}</div>` : ''}
            ${ticket.status === 'resolved' && ticket.resolverName ? `<div class="ticket-submitter"><span class="submitter-label">Resolved by:</span> ${escapeHtml(ticket.resolverName)}</div>` : ''}
            
            <div class="ticket-response-times">
                ${ticket.firstResponseAt
            ? `<span class="response-time-badge" title="Response Time: waktu dari laporan masuk hingga direspon">⏱️ RT: ${formatDuration(ticket.createdAt, ticket.firstResponseAt)}</span>`
            : `<span class="response-time-badge pending" title="Belum ada respon">⏳ Waiting</span>`}
                ${ticket.resolvedAt && ticket.firstResponseAt
            ? `<span class="resolution-time-badge" title="Resolution Time: waktu dari respon hingga selesai">✅ Resolve: ${formatDuration(ticket.firstResponseAt, ticket.resolvedAt)}</span>`
            : ''}
            </div>

            <div class="ticket-footer">
                <span class="ticket-status-badge ${ticket.status}">${getTicketStatusLabel(ticket.status)}</span>
                <span class="ticket-priority-badge ${ticket.priority}">${ticket.priority.toUpperCase()}</span>
            </div>
        </div>
    `).join('');

    // Render pagination controls
    renderTicketsPagination(totalItems, totalPages);

    document.querySelectorAll('.ticket-card').forEach(card => {
        card.addEventListener('click', () => openEditTicketModal(card.dataset.id));
    });
}

/**
 * Render pagination controls for tickets
 */
function renderTicketsPagination(totalItems, totalPages) {
    let paginationEl = document.getElementById('ticketsPagination');

    if (!paginationEl) {
        // Create pagination element if it doesn't exist
        paginationEl = document.createElement('div');
        paginationEl.id = 'ticketsPagination';
        paginationEl.className = 'pagination-container';
        elements.ticketsList.after(paginationEl);
    }

    paginationEl.style.display = totalPages > 1 || totalItems > 0 ? 'flex' : 'none';

    // Generate page buttons
    let pageButtons = '';
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentTicketPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        pageButtons += `<button class="pagination-btn ${i === currentTicketPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    paginationEl.innerHTML = `
        <div class="pagination-info">
            <span>${totalItems} total</span>
        </div>
        <div class="pagination-controls">
            <button class="pagination-btn pagination-nav" data-page="prev" ${currentTicketPage === 1 ? 'disabled' : ''}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
            ${pageButtons}
            <button class="pagination-btn pagination-nav" data-page="next" ${currentTicketPage === totalPages ? 'disabled' : ''}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        </div>
        <div class="pagination-per-page">
            <select id="ticketsPerPageSelect">
                <option value="10" ${ticketsPerPage === 10 ? 'selected' : ''}>10 / page</option>
                <option value="20" ${ticketsPerPage === 20 ? 'selected' : ''}>20 / page</option>
                <option value="30" ${ticketsPerPage === 30 ? 'selected' : ''}>30 / page</option>
                <option value="40" ${ticketsPerPage === 40 ? 'selected' : ''}>40 / page</option>
                <option value="50" ${ticketsPerPage === 50 ? 'selected' : ''}>50 / page</option>
            </select>
        </div>
    `;

    // Add event listeners for pagination
    paginationEl.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const page = btn.dataset.page;
            if (page === 'prev') {
                if (currentTicketPage > 1) {
                    currentTicketPage--;
                    renderTickets();
                }
            } else if (page === 'next') {
                if (currentTicketPage < totalPages) {
                    currentTicketPage++;
                    renderTickets();
                }
            } else {
                currentTicketPage = parseInt(page);
                renderTickets();
            }
        });
    });

    // Per page selector
    const perPageSelect = document.getElementById('ticketsPerPageSelect');
    if (perPageSelect) {
        perPageSelect.addEventListener('change', (e) => {
            ticketsPerPage = parseInt(e.target.value);
            currentTicketPage = 1; // Reset to first page
            renderTickets();
        });
    }
}

function getTicketStatusLabel(status) {
    switch (status) {
        case 'open': return 'Open';
        case 'in_progress': return 'In Progress';
        case 'pending': return 'Pending';
        case 'resolved': return 'Resolved';
        default: return status;
    }
}

function exportTickets() {
    // Check auth first (optional, but good UX)
    if (!currentUser) {
        showNotification('Anda harus login untuk mengekspor tiket.', 'warning');
        return;
    }

    // Direct link trigger for download
    window.location.href = '/api/tickets/export';
}

function handleTicketHostSearch(e) {
    const query = e.target.value.trim().toLowerCase();
    const resultsContainer = elements.ticketHostSearchResults;
    const isHostSelected = elements.ticketHostId.value !== '';

    // If a host is selected and the event is focus/click, show all hosts
    // This allows user to see all options and change their selection
    let filteredHosts = cachedHosts;

    // If typing (not just focus/click with existing selection)
    if (e.type === 'input') {
        // When user types, clear the previously selected host
        if (isHostSelected) {
            elements.ticketHostId.value = '';
        }

        if (query) {
            filteredHosts = cachedHosts.filter(h =>
                h.name.toLowerCase().includes(query) ||
                h.host.toLowerCase().includes(query) ||
                (h.cid && h.cid.toLowerCase().includes(query))
            );
        }
    }
    // On focus/click - always show all hosts regardless of input value
    // This enables re-selection

    // Show all matching hosts (no limit)
    // filteredHosts = filteredHosts.slice(0, 10);

    if (filteredHosts.length === 0) {
        resultsContainer.innerHTML = '<div class="search-result-item no-result" style="cursor: default; color: var(--text-muted);">Tidak ada host ditemukan</div>';
    } else {
        resultsContainer.innerHTML = filteredHosts.map(h => `
            <div class="search-result-item" data-host-id="${h.id}" data-host-name="${escapeHtml(h.name)}" data-host-ip="${escapeHtml(h.host)}">
                <div class="host-name">${escapeHtml(h.name)}</div>
                <div class="host-ip">${escapeHtml(h.host)} ${h.cid ? `<span class="host-cid">${escapeHtml(h.cid)}</span>` : ''}</div>
            </div>
        `).join('');
    }

    resultsContainer.classList.remove('hidden');
}

function selectTicketHost(id, name, ip) {
    elements.ticketHostId.value = id;
    elements.ticketHostSearchInput.value = `${name} (${ip})`;
    elements.ticketHostSearchResults.classList.add('hidden');
}

// Make selectTicketHost accessible globally for the onclick handler
window.selectTicketHost = selectTicketHost;

function openCreateTicketModal() {
    // Reset Host Search
    elements.ticketHostId.value = '';
    elements.ticketHostSearchInput.value = '';
    elements.ticketHostSearchResults.innerHTML = '';
    elements.ticketHostSearchResults.classList.add('hidden');
    // Clear any inline styles from previous positioning
    elements.ticketHostSearchResults.style.cssText = '';
    elements.ticketTitleInput.value = '';
    elements.ticketDescInput.value = '';
    elements.ticketPrioritySelect.value = 'medium';

    // Reset PIC input
    if (elements.ticketPicInput) {
        elements.ticketPicInput.value = '';
    }

    // Reset file input and preview
    if (elements.ticketImageInput) {
        elements.ticketImageInput.value = '';
    }
    if (elements.ticketImagePreview) {
        elements.ticketImagePreview.innerHTML = '';
    }

    showModal(elements.createTicketModal);
}

async function handleCreateTicket() {
    const title = elements.ticketTitleInput.value.trim();
    if (!title) {
        alert('Judul tiket wajib diisi');
        return;
    }

    // Get selected image files
    const imageFiles = elements.ticketImageInput ? Array.from(elements.ticketImageInput.files) : [];

    // Get PIC name from input
    const picName = elements.ticketPicInput ? elements.ticketPicInput.value.trim() : '';

    // Get datetime values
    const createdAtInput = document.getElementById('createTicketCreatedAt');
    const firstResponseAtInput = document.getElementById('createTicketFirstResponseAt');

    const createdAt = createdAtInput && createdAtInput.value ? datetimeLocalToIso(createdAtInput.value) : null;
    const firstResponseAt = firstResponseAtInput && firstResponseAtInput.value ? datetimeLocalToIso(firstResponseAtInput.value) : null;

    try {
        await createTicketApi({
            hostId: elements.ticketHostId.value || null,
            title,
            description: elements.ticketDescInput.value.trim(),
            priority: elements.ticketPrioritySelect.value,
            picName,
            createdAt,
            firstResponseAt
        }, imageFiles);
        hideModal(elements.createTicketModal);
        showNotification('Tiket berhasil dibuat', 'success');
        loadAndRenderTickets();

        // Reset datetime inputs
        if (createdAtInput) createdAtInput.value = '';
        if (firstResponseAtInput) firstResponseAtInput.value = '';
    } catch (error) {
        alert('Gagal membuat tiket');
    }
}


function openEditTicketModal(ticketId) {
    const ticket = cachedTickets.find(t => t.id === ticketId);
    if (!ticket) return;
    elements.editTicketId.value = ticket.id;
    elements.editTicketIdDisplay.textContent = ticket.ticketId;
    elements.editTicketHost.textContent = ticket.hostName || '-';
    elements.editTicketCid.textContent = ticket.hostCid || '-';
    elements.editTicketSource.textContent = ticket.source === 'auto' ? 'Auto-generated' : 'Manual';
    elements.editTicketCreated.textContent = new Date(ticket.createdAt).toLocaleString('id-ID');
    if (elements.editTicketCreatedDisplay) elements.editTicketCreatedDisplay.textContent = new Date(ticket.createdAt).toLocaleString('id-ID');

    if (elements.editTicketStatusDisplay) elements.editTicketStatusDisplay.textContent = getTicketStatusLabel(ticket.status);

    elements.editTicketStatus.value = ticket.status;
    elements.editTicketPriority.value = ticket.priority;

    // Show/Hide Resolved By info
    const resolvedByContainer = document.getElementById('editTicketResolvedByContainer'); // Need to create this in HTML first or append dynamically
    if (ticket.status === 'resolved' && ticket.resolverName) {
        if (resolvedByContainer) {
            resolvedByContainer.classList.remove('hidden');
            document.getElementById('editTicketResolvedBy').textContent = ticket.resolverName;
        }
    } else {
        if (resolvedByContainer) {
            resolvedByContainer.classList.add('hidden');
        }
    }

    // Set form values
    elements.editTicketDesc.value = ticket.description || '';

    // Set PIC text input
    if (elements.editTicketPic) {
        elements.editTicketPic.value = ticket.picName || '';
    }

    // Populate datetime inputs
    const createdAtInput = document.getElementById('editTicketCreatedAt');
    const firstResponseAtInput = document.getElementById('editTicketFirstResponseAt');
    const responseTimeEl = document.getElementById('editTicketResponseTime');
    const resolvedAtRow = document.getElementById('resolvedAtRow');
    const resolvedAtEl = document.getElementById('editTicketResolvedAt');
    const resolutionTimeRow = document.getElementById('resolutionTimeRow');
    const resolutionTimeEl = document.getElementById('editTicketResolutionTime');

    // Set datetime-local values
    if (createdAtInput) {
        createdAtInput.value = isoToDatetimeLocal(ticket.createdAt);
        // Disable createdAt for auto-generated tickets (tidak bisa diedit)
        if (ticket.source === 'auto') {
            createdAtInput.disabled = true;
            createdAtInput.title = 'Waktu tiket auto-generated tidak dapat diubah';
        } else {
            createdAtInput.disabled = false;
            createdAtInput.title = '';
        }
    }
    if (firstResponseAtInput) {
        firstResponseAtInput.value = ticket.firstResponseAt ? isoToDatetimeLocal(ticket.firstResponseAt) : '';
    }

    // Calculate and display Response Time
    updateCalculatedResponseTime();

    // Display Resolved At timestamp
    if (resolvedAtRow && resolvedAtEl) {
        if (ticket.resolvedAt) {
            resolvedAtRow.style.display = 'flex';
            resolvedAtEl.textContent = formatDateTime(ticket.resolvedAt);
        } else {
            resolvedAtRow.style.display = 'none';
        }
    }

    // Manual Resolved At Input
    const resolvedAtInput = document.getElementById('editTicketResolvedAtInput');
    const manualResolvedAtGroup = document.getElementById('manualResolvedAtGroup');

    if (resolvedAtInput) {
        // Init value
        resolvedAtInput.value = ticket.resolvedAt ? isoToDatetimeLocal(ticket.resolvedAt) : '';

        // Toggle visibility based on status
        if (ticket.status === 'resolved') {
            manualResolvedAtGroup.style.display = 'block';
        } else {
            manualResolvedAtGroup.style.display = 'none';
        }
    }

    // Display Resolution Time if ticket is resolved
    if (resolutionTimeRow && resolutionTimeEl) {
        if (ticket.resolvedAt && ticket.firstResponseAt) {
            resolutionTimeRow.style.display = 'flex';
            resolutionTimeEl.textContent = formatDuration(ticket.firstResponseAt, ticket.resolvedAt);
        } else {
            resolutionTimeRow.style.display = 'none';
        }
    }


    // Add event listeners for real-time calculation
    if (createdAtInput) {
        createdAtInput.onchange = updateCalculatedResponseTime;
    }
    if (firstResponseAtInput) {
        firstResponseAtInput.onchange = (e) => {
            updateCalculatedResponseTime();

            // Auto-switch to "In Progress" if user sets First Response Time
            // and current status is Open or Pending
            if (e.target.value) {
                const currentStatus = elements.editTicketStatus.value;
                if (currentStatus === 'open' || currentStatus === 'pending') {
                    elements.editTicketStatus.value = 'in_progress';
                    // Trigger change event to handle any dependent logic (like Resolved At visibility)
                    elements.editTicketStatus.dispatchEvent(new Event('change'));
                    showNotification('Status otomatis diubah ke In Progress', 'info');
                }
            }
        };
    }


    // Render ticket attachments
    renderTicketAttachments(ticket.attachments || []);

    // Render comments
    renderTicketComments(ticket.comments || []);
    if (elements.newCommentInput) {
        elements.newCommentInput.value = '';
    }

    // Reset comment image input and preview
    if (elements.commentImageInput) {
        elements.commentImageInput.value = '';
    }
    if (elements.commentImagePreview) {
        elements.commentImagePreview.innerHTML = '';
    }

    showModal(elements.editTicketModal);
}

// Convert ISO date string to datetime-local format (YYYY-MM-DDTHH:mm)
function isoToDatetimeLocal(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    // Format: YYYY-MM-DDTHH:mm (local time)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Convert datetime-local format to ISO string
function datetimeLocalToIso(datetimeLocal) {
    if (!datetimeLocal) return null;
    const date = new Date(datetimeLocal);
    return date.toISOString();
}

// Update calculated Response Time based on input values
function updateCalculatedResponseTime() {
    const createdAtInput = document.getElementById('editTicketCreatedAt');
    const firstResponseAtInput = document.getElementById('editTicketFirstResponseAt');
    const responseTimeEl = document.getElementById('editTicketResponseTime');

    if (!responseTimeEl) return;

    const createdAt = createdAtInput ? createdAtInput.value : null;
    const firstResponseAt = firstResponseAtInput ? firstResponseAtInput.value : null;

    if (createdAt && firstResponseAt) {
        const duration = formatDuration(
            datetimeLocalToIso(createdAt),
            datetimeLocalToIso(firstResponseAt)
        );
        responseTimeEl.textContent = duration;
        responseTimeEl.className = 'value success';
    } else {
        responseTimeEl.textContent = '-';
        responseTimeEl.className = 'value pending';
    }
}



function renderTicketAttachments(attachments) {
    if (!elements.ticketAttachmentsList) return;

    if (!attachments || attachments.length === 0) {
        elements.ticketAttachmentsList.innerHTML = '<p class="no-attachments">Tidak ada lampiran</p>';
        return;
    }

    elements.ticketAttachmentsList.innerHTML = attachments.map(att => `
        <div class="attachment-item">
            <img src="${att}" alt="Attachment" data-image-url="${att}">
        </div>
    `).join('');

    // Add event listeners for attachment images
    elements.ticketAttachmentsList.querySelectorAll('.attachment-item img').forEach(img => {
        img.addEventListener('click', (e) => {
            window.open(e.target.dataset.imageUrl, '_blank');
        });
    });
}

function renderTicketComments(comments) {
    if (!elements.ticketCommentsList) return;

    if (!comments || comments.length === 0) {
        elements.ticketCommentsList.innerHTML = '<p class="no-comments">Belum ada catatan</p>';
        return;
    }

    const ticketId = elements.editTicketId.value;

    elements.ticketCommentsList.innerHTML = comments.map(c => `
        <div class="comment-item">
            <div class="comment-header">
                <div>
                    <span class="comment-author">${escapeHtml(c.author)}</span>
                    <span class="comment-time">${formatTime(c.createdAt)}</span>
                </div>
                ${currentUser && (c.authorId === currentUser.id || currentUser.role === 'admin') ? `
                    <button class="delete-comment-btn" data-ticket-id="${ticketId}" data-comment-id="${c.id}" title="Hapus Catatan">
                        &times;
                    </button>
                ` : ''}
            </div>
            ${c.text ? `<div class="comment-text">${escapeHtml(c.text)}</div>` : ''}
            ${c.image ? `<div class="comment-image"><img src="${c.image}" alt="Comment image" data-image-url="${c.image}"></div>` : ''}
        </div>
    `).join('');

    // Add event listeners for delete buttons
    elements.ticketCommentsList.querySelectorAll('.delete-comment-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ticketId = e.target.dataset.ticketId;
            const commentId = e.target.dataset.commentId;
            handleDeleteComment(ticketId, commentId);
        });
    });

    // Add event listeners for image click
    elements.ticketCommentsList.querySelectorAll('.comment-image img').forEach(img => {
        img.addEventListener('click', (e) => {
            window.open(e.target.dataset.imageUrl, '_blank');
        });
    });
}

async function addTicketComment(ticketId, text, imageFile = null) {
    const formData = new FormData();
    formData.append('text', text || '');
    if (imageFile) {
        formData.append('image', imageFile);
    }

    const response = await fetch(`${API_BASE}/api/tickets/${ticketId}/comments`, {
        method: 'POST',
        body: formData
    });
    if (!response.ok) throw new Error('Failed to add comment');
    return await response.json();
}

async function handleAddComment() {
    const ticketId = elements.editTicketId.value;
    const text = elements.newCommentInput.value.trim();
    const imageFile = elements.commentImageInput && elements.commentImageInput.files.length > 0
        ? elements.commentImageInput.files[0]
        : null;

    // Allow comment with text OR image OR both
    if (!text && !imageFile) {
        alert('Catatan atau gambar harus diisi');
        return;
    }
    try {
        await addTicketComment(ticketId, text, imageFile);
        elements.newCommentInput.value = '';

        // Reset image input and preview
        if (elements.commentImageInput) {
            elements.commentImageInput.value = '';
        }
        if (elements.commentImagePreview) {
            elements.commentImagePreview.innerHTML = '';
        }

        // Refresh ticket data and update modal
        cachedTickets = await fetchTickets();
        const ticket = cachedTickets.find(t => t.id === ticketId);
        if (ticket) {
            renderTicketComments(ticket.comments || []);
        }
        showNotification('Catatan ditambahkan', 'success');
    } catch (error) {
        alert('Gagal menambahkan catatan');
    }
}

// Handle Delete Comment
async function handleDeleteComment(ticketId, commentId) {
    if (!confirm('Hapus catatan ini?')) return;

    try {
        const response = await fetch(`/api/tickets/${ticketId}/comments/${commentId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const text = await response.text();
            let errorMsg = 'Gagal menghapus catatan';
            try {
                const data = JSON.parse(text);
                errorMsg = data.error || errorMsg;
            } catch (e) {
                // If not JSON, use the text body
                errorMsg = text || `Error ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMsg);
        }

        // Refresh ticket data
        cachedTickets = await fetchTickets();
        const ticket = cachedTickets.find(t => t.id === ticketId);
        if (ticket) {
            renderTicketComments(ticket.comments || []);
        }
        showNotification('Catatan dihapus', 'success');

    } catch (error) {
        console.error('Error deleting comment:', error);
        alert(error.message);
    }
}

async function handleUpdateTicket() {
    const id = elements.editTicketId.value;

    // Get datetime values from inputs
    const createdAtInput = document.getElementById('editTicketCreatedAt');
    const firstResponseAtInput = document.getElementById('editTicketFirstResponseAt');
    const resolvedAtInput = document.getElementById('editTicketResolvedAtInput');

    const createdAt = createdAtInput && createdAtInput.value ? datetimeLocalToIso(createdAtInput.value) : undefined;
    const firstResponseAt = firstResponseAtInput && firstResponseAtInput.value ? datetimeLocalToIso(firstResponseAtInput.value) : null;
    const resolvedAt = resolvedAtInput && resolvedAtInput.value ? datetimeLocalToIso(resolvedAtInput.value) : undefined;

    try {
        await updateTicketApi(id, {
            status: elements.editTicketStatus.value,
            priority: elements.editTicketPriority.value,
            description: elements.editTicketDesc.value.trim(),
            picName: elements.editTicketPic ? elements.editTicketPic.value.trim() : undefined,
            createdAt,
            firstResponseAt,
            resolvedAt
        });
        hideModal(elements.editTicketModal);
        showNotification('Tiket berhasil diperbarui', 'success');
        loadAndRenderTickets();
    } catch (error) {
        alert('Gagal memperbarui tiket');
    }
}


async function handleDeleteTicket() {
    const id = elements.editTicketId.value;
    if (!confirm('Apakah Anda yakin ingin menghapus tiket ini?')) return;
    try {
        await deleteTicketApi(id);
        hideModal(elements.editTicketModal);
        showNotification('Tiket berhasil dihapus', 'success');
        loadAndRenderTickets();
    } catch (error) {
        alert('Gagal menghapus tiket');
    }
}

// Rule 4 & 5: Error Prevention with Confirmation
window.handleDeleteHost = async function (id) {
    // Find host name for better context in confirmation
    const host = cachedHosts.find(h => h.id === id);
    const hostName = host ? host.name : 'Host ini';

    confirmDelete(`Apakah Anda yakin ingin menghapus "${hostName}"? Tindakan ini tidak dapat dibatalkan.`, async () => {
        try {
            await deleteHost(id);
            showNotification('Host berhasil dihapus', 'success');
            if (elements.editHostModal) {
                elements.editHostModal.classList.remove('show');
            }
            refreshData();
        } catch (error) {
            showNotification('Gagal menghapus host', 'danger');
        }
    });
};

// ========================================
// UI Functions
// ========================================

function updateStats(hosts) {
    const online = hosts.filter(h => h.status === 'online').length;
    const offline = hosts.filter(h => h.status === 'offline').length;
    const total = hosts.length;

    const latencies = hosts
        .filter(h => h.status === 'online' && h.latency !== null)
        .map(h => h.latency);

    const avgLat = latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null;

    elements.onlineCount.textContent = online;
    elements.offlineCount.textContent = offline;
    elements.totalCount.textContent = total;
    elements.avgLatency.textContent = avgLat !== null ? `${avgLat}ms` : '-';
}

function updateAutoPingUI(enabled) {
    if (elements.autoPingToggle) {
        elements.autoPingToggle.checked = enabled;
    }
    if (elements.autoPingStatus) {
        elements.autoPingStatus.textContent = enabled ? 'ON' : 'OFF';
        elements.autoPingStatus.className = `auto-ping-indicator ${enabled ? 'active' : ''}`;
    }
}

function renderHosts(hosts) {
    if (hosts.length === 0) {
        elements.hostsGrid.innerHTML = '';
        elements.emptyState.classList.remove('hidden');
        return;
    }

    elements.emptyState.classList.add('hidden');

    elements.hostsGrid.innerHTML = hosts.map(host => `
        <div class="host-card ${host.status}" data-id="${host.id}">
            <div class="host-card-header">
                <div class="host-info">
                    <span class="host-name">${escapeHtml(host.name)}</span>
                    <span class="host-ip">${escapeHtml(host.host)}</span>
                </div>
                <span class="status-badge ${host.status}">
                    <span class="status-dot"></span>
                    ${host.status === 'online' ? 'Online' : host.status === 'offline' ? 'Offline' : 'Unknown'}
                </span>
            </div>
            ${host.cid ? `<div class="host-cid">CID: ${escapeHtml(host.cid)}</div>` : ''}
            <div class="host-stats">
                <div class="host-stat">
                    <div class="host-stat-label">Latency</div>
                    <div class="host-stat-value ${host.status === 'online' ? 'success' : host.status === 'offline' ? 'danger' : ''}">
                        ${host.latency !== null ? `${host.latency}ms` : '-'}
                    </div>
                </div>
                <div class="host-stat">
                    <div class="host-stat-label">Last Check</div>
                    <div class="host-stat-value">
                        ${host.lastCheck ? formatTime(host.lastCheck) : '-'}
                    </div>
                </div>
            </div>
            <div class="host-card-actions">
                <button class="btn btn-secondary btn-sm ping-btn" data-id="${host.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                    </svg>
                    Ping
                </button>
                <button class="btn btn-secondary btn-sm traceroute-btn" data-id="${host.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                    </svg>
                    Traceroute
                </button>
                <button class="btn btn-ghost btn-icon history-btn" data-id="${host.id}" data-name="${escapeHtml(host.name)}" title="History">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                </button>
                <button class="btn btn-ghost btn-icon edit-host-btn" data-id="${host.id}" title="Edit Host">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                ${host.snmpEnabled ? `
                <button class="btn btn-ghost btn-icon traffic-btn" data-id="${host.id}" title="Traffic Monitor">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                    </svg>
                </button>
                ` : ''}
                <button class="btn btn-ghost btn-icon delete-btn" data-id="${host.id}" title="Hapus">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');

    // Add event listeners
    document.querySelectorAll('.ping-btn').forEach(btn => {
        btn.addEventListener('click', handlePingHost);
    });

    document.querySelectorAll('.traceroute-btn').forEach(btn => {
        btn.addEventListener('click', handleTraceroute);
    });

    document.querySelectorAll('.history-btn').forEach(btn => {
        btn.addEventListener('click', handleShowHistory);
    });

    document.querySelectorAll('.edit-host-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            openEditHostModal(e.currentTarget.dataset.id);
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => window.handleDeleteHost(e.currentTarget.dataset.id));
    });

    document.querySelectorAll('.traffic-btn').forEach(btn => {
        btn.addEventListener('click', (e) => openTrafficModal(e.currentTarget.dataset.id));
    });
}

function renderFilteredHosts() {
    let filtered = cachedHosts;

    // Filter by status
    if (currentStatusFilter !== 'all') {
        filtered = filtered.filter(h => h.status === currentStatusFilter);
    }

    // Filter by search query
    if (currentSearchQuery) {
        const lowerQuery = currentSearchQuery.toLowerCase();
        filtered = filtered.filter(h =>
            (h.name && h.name.toLowerCase().includes(lowerQuery)) ||
            (h.host && h.host.toLowerCase().includes(lowerQuery)) ||
            (h.cid && h.cid.toLowerCase().includes(lowerQuery))
        );
    }

    // Filter by host group
    if (currentGroupFilter) {
        filtered = filtered.filter(h => h.groupId === currentGroupFilter);
    }

    // Sort: offline first, then online, then unknown
    filtered = [...filtered].sort((a, b) => {
        const statusOrder = { offline: 0, unknown: 1, online: 2 };
        return (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1);
    });

    renderHosts(filtered);
}

function setStatusFilter(status) {
    currentStatusFilter = status;

    // Update active class
    elements.statCardOnline.classList.remove('active');
    elements.statCardOffline.classList.remove('active');
    elements.statCardTotal.classList.remove('active');

    if (status === 'online') elements.statCardOnline.classList.add('active');
    else if (status === 'offline') elements.statCardOffline.classList.add('active');
    else elements.statCardTotal.classList.add('active');

    // Switch to hosts tab when clicking stat cards
    switchTab('hosts');

    renderFilteredHosts();
}

function handleHostSearch(e) {
    currentSearchQuery = e.target.value.trim();
    renderFilteredHosts();
}

function renderHistory(history) {
    // Render chart (Show up to 24 hours of data = 8640 points)
    // We reverse it so the latest is on the right, but for flex-direction: row-reverse or standard flex we need to check CSS
    // Based on previous code: .reverse() suggests the array starts with [newest, ..., oldest]
    // If we want newest on right, we usually render left-to-right as oldest-to-newest.

    // Limit to 24h and reverse to have Oldest -> Newest order (for correct left-to-right rendering)
    const chartData = history.slice(0, 8640).reverse();

    // Calculate max latency for scale
    const maxLatency = Math.max(...chartData.filter(h => h.alive).map(h => h.time || 0), 100);

    // Calculate median latency (just for info, not drawn as line)
    const validLatencies = chartData.filter(h => h.alive && h.time).map(h => h.time).sort((a, b) => a - b);
    let medianLatency = 0;
    if (validLatencies.length > 0) {
        const mid = Math.floor(validLatencies.length / 2);
        medianLatency = validLatencies.length % 2 !== 0
            ? validLatencies[mid]
            : (validLatencies[mid - 1] + validLatencies[mid]) / 2;
    }

    // --- Generate Trend Line (Moving Average) ---
    // Window size (e.g., 6 points = 1 min, 30 points = 5 mins)
    const windowSize = 6;
    let pathD = '';
    const barWidth = 4;
    const gap = 1;
    const itemWidth = barWidth + gap;

    // Helper to get Y (0 is top)
    const getY = (val) => 100 - Math.min((val / maxLatency) * 100, 100);

    for (let i = 0; i < chartData.length; i++) {
        let sum = 0;
        let count = 0;

        // SMA window
        for (let j = 0; j < windowSize; j++) {
            const idx = i - j;
            if (idx >= 0 && chartData[idx].alive && chartData[idx].time) {
                sum += chartData[idx].time;
                count++;
            }
        }

        if (count > 0) {
            const avg = sum / count;
            // Center of bar = i * itemWidth + barWidth/2
            // We want line to start at 0 if i=0? Or center of bar. Center is better.
            const x = (i * itemWidth) + (barWidth / 2);
            const y = getY(avg);

            if (pathD === '') {
                pathD = `M${x},${y}`;
            } else {
                pathD += ` L${x},${y}`;
            }
        }
    }

    // Render bars
    const barsHtml = chartData.map(entry => {
        const height = entry.alive && entry.time
            ? Math.max(10, (entry.time / maxLatency) * 100)
            : 10;
        const timeStr = formatDateTime(entry.timestamp);
        const latencyStr = entry.alive ? `${entry.time}ms` : 'Offline';

        return `<div class="history-bar ${entry.alive ? 'online' : 'offline'}" 
                     style="height: ${height}%" 
                     data-time="${timeStr}"
                     data-latency="${latencyStr}"></div>`;
    }).join('');

    // Total width for SVG
    const totalWidth = chartData.length * itemWidth;

    elements.historyChart.innerHTML = `
        <svg class="trend-line-svg" width="${totalWidth}" height="100%" viewBox="0 0 ${totalWidth} 100" preserveAspectRatio="none">
            <path class="trend-line-path" d="${pathD}" />
        </svg>
        ${barsHtml}
    `;

    // Add event listeners for tooltip (CSP compliant)
    elements.historyChart.querySelectorAll('.history-bar').forEach(bar => {
        bar.addEventListener('mouseover', (e) => {
            showChartTooltip(e, bar.dataset.time, bar.dataset.latency);
        });
        bar.addEventListener('mouseout', () => {
            hideChartTooltip();
        });
    });

    // Render list (limit to 50 items for performance)
    elements.historyList.innerHTML = history.slice(0, 50).map(entry => `
        <div class="history-item">
            <span class="history-time">${formatDateTime(entry.timestamp)}</span>
            <span class="history-latency ${entry.alive ? 'online' : 'offline'}">
                ${entry.alive ? `${entry.time}ms` : 'Offline'}
            </span>
        </div>
    `).join('');
}

function showQuickPingResult(result, isLoading = false) {
    const el = elements.quickPingResult;
    el.classList.add('show');

    if (isLoading) {
        el.className = 'quick-ping-result show loading';
        el.innerHTML = '<span class="loading-spinner"></span> Pinging...';
        return;
    }

    if (result.alive) {
        el.className = 'quick-ping-result show success';
        el.innerHTML = `
            <strong>✓ ${result.host}</strong> is reachable<br>
            <span>Latency: <strong>${result.time}ms</strong></span>
        `;
    } else {
        el.className = 'quick-ping-result show error';
        el.innerHTML = `
            <strong>✗ ${result.host}</strong> is not reachable<br>
            <span>Host tidak merespons atau tidak dapat dijangkau</span>
        `;
    }
}

// ========================================
// Modal Functions
// ========================================

function showModal(modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function hideModal(modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';

    // Abort continuous ping if ping modal is closed
    if (modal === elements.pingModal && currentPingController) {
        currentPingController.abort();
        currentPingController = null;
    }

    // Abort traceroute if traceroute modal is closed
    if (modal === elements.tracerouteModal && currentTracerouteController) {
        currentTracerouteController.abort();
        currentTracerouteController = null;
    }
}

// ========================================
// Theme Functions
// ========================================

function initTheme() {
    // Check localStorage or system preference
    const savedTheme = localStorage.getItem('theme');
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;

    // Default to dark if no preference (or user previously selected dark)
    // Applying light theme only if explicitly saved as 'light'
    // (User requested: "dark seperti sekarang saja tidak perlu dirubah")

    if (savedTheme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        updateThemeIcon('light');
    } else {
        document.documentElement.removeAttribute('data-theme');
        updateThemeIcon('dark');
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    if (newTheme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }

    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const sunIcon = document.querySelector('.theme-icon-sun');
    const moonIcon = document.querySelector('.theme-icon-moon');

    if (theme === 'light') {
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
    } else {
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
    }
}

// ========================================
// Event Handlers
// ========================================

async function handlePingAll() {
    const btn = elements.pingAllBtn;
    const originalHTML = btn.innerHTML;

    btn.innerHTML = '<span class="loading-spinner"></span> Pinging...';
    btn.disabled = true;

    try {
        const results = await pingAllHosts();
        cachedHosts = results;
        renderFilteredHosts();
        updateStats(results);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}

async function handlePingHost(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.id;
    const hostData = cachedHosts.find(h => h.id === id);

    if (!hostData) {
        return;
    }

    // Abort any existing ping stream
    if (currentPingController) {
        currentPingController.abort();
    }
    currentPingController = new AbortController();
    const signal = currentPingController.signal;

    // Open Modal
    elements.pingHostName.textContent = hostData.host;
    elements.pingOutput.textContent = `Initializing ping to ${hostData.host}...\n`;
    showModal(elements.pingModal);

    try {
        const response = await fetch(`${API_BASE}/api/ping-stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host: hostData.host }),
            signal: signal,
            credentials: 'include' // Include session cookies
        });

        // Check if response is ok
        if (!response.ok) {
            const errorText = await response.text();
            elements.pingOutput.textContent += `\nError (${response.status}): ${errorText || response.statusText}`;
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            elements.pingOutput.textContent += text;
            // Use requestAnimationFrame for reliable auto-scroll after DOM update
            requestAnimationFrame(() => {
                elements.pingOutput.scrollTop = elements.pingOutput.scrollHeight;
            });
        }

    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Ping error:', error);
            elements.pingOutput.textContent += `\nError: ${error.message}`;
        }
    } finally {
        currentPingController = null;
    }
}

async function handleTraceroute(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.id;
    const host = cachedHosts.find(h => h.id === id);

    if (!host) return;

    // Abort any existing traceroute stream
    if (currentTracerouteController) {
        currentTracerouteController.abort();
    }
    currentTracerouteController = new AbortController();
    const signal = currentTracerouteController.signal;

    elements.tracerouteHostName.textContent = `${host.name} (${host.host})`;
    elements.tracerouteOutput.textContent = 'Initializing traceroute to ' + host.host + '...\n';
    elements.tracerouteOutput.classList.add('terminal-loading');

    showModal(elements.tracerouteModal);

    try {
        const response = await fetch(`${API_BASE}/api/traceroute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host: host.host }),
            signal: signal,
            credentials: 'include' // Include session cookies
        });

        elements.tracerouteOutput.classList.remove('terminal-loading');

        // Check if response is ok
        if (!response.ok) {
            const errorText = await response.text();
            elements.tracerouteOutput.textContent += `\nError (${response.status}): ${errorText || response.statusText}`;
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            elements.tracerouteOutput.textContent += text;
            elements.tracerouteOutput.scrollTop = elements.tracerouteOutput.scrollHeight;
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Traceroute stream aborted');
        } else {
            elements.tracerouteOutput.textContent += '\nError: ' + error.message;
        }
        elements.tracerouteOutput.classList.remove('terminal-loading');
    } finally {
        currentTracerouteController = null;
    }
}

function openEditHostModal(hostId) {
    const host = cachedHosts.find(h => h.id === hostId);
    if (!host) return;

    elements.editHostId.value = hostId;
    elements.editHostInput.value = host.host;
    elements.editNameInput.value = host.name;
    elements.editCidInput.value = host.cid || '';

    // Set location inputs
    elements.editCoordinatesInput.value = (host.latitude && host.longitude)
        ? `${host.latitude}, ${host.longitude}`
        : '';

    // Reset address search
    if (elements.editAddressSearchInput) elements.editAddressSearchInput.value = '';
    if (elements.editAddressSearchResults) elements.editAddressSearchResults.innerHTML = '';

    // Populate SNMP Fields
    const editSnmpEnabled = document.getElementById('editSnmpEnabled');
    const editSnmpCommunity = document.getElementById('editSnmpCommunity');
    const editSnmpVersion = document.getElementById('editSnmpVersion');
    const editSnmpFields = document.getElementById('editSnmpFields');
    const editSnmpInterface = document.getElementById('editSnmpInterface');

    if (editSnmpEnabled) {
        editSnmpEnabled.checked = host.snmpEnabled || false;
        editSnmpFields.style.display = host.snmpEnabled ? 'block' : 'none';

        if (editSnmpCommunity) editSnmpCommunity.value = host.snmpCommunity || 'public';
        if (editSnmpVersion) editSnmpVersion.value = host.snmpVersion || '2c';

        // Reset interface select
        if (editSnmpInterface) {
            editSnmpInterface.innerHTML = '<option value="">-- Pilih Interface --</option>';
            if (host.snmpInterface) {
                const opt = document.createElement('option');
                opt.value = host.snmpInterface;
                opt.textContent = host.snmpInterfaceName || host.snmpInterface; // Use name if available
                opt.selected = true;
                editSnmpInterface.appendChild(opt);
            }
        }
    }

    showModal(elements.editHostModal);

    // Initialize map after modal is shown
    setTimeout(() => {
        initEditLocationMap(host.latitude, host.longitude);
    }, 200);
}

// Map variable for edit modal
let editLocationMap = null;
let editLocationMarker = null;

function initEditLocationMap(lat, lng) {
    if (editLocationMap) {
        editLocationMap.remove();
        editLocationMap = null;
    }

    const defaultLat = lat || -2.5;
    const defaultLng = lng || 118.0;
    const zoom = lat && lng ? 10 : 5;

    editLocationMap = L.map('editLocationPickerMap').setView([defaultLat, defaultLng], zoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OSM © CARTO',
        maxZoom: 19
    }).addTo(editLocationMap);

    // Add marker if location exists
    if (lat && lng) {
        editLocationMarker = L.marker([lat, lng]).addTo(editLocationMap);
    }

    // Click on map to set location
    editLocationMap.on('click', (e) => {
        const { lat, lng } = e.latlng;
        elements.editCoordinatesInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

        if (editLocationMarker) {
            editLocationMarker.setLatLng([lat, lng]);
        } else {
            editLocationMarker = L.marker([lat, lng]).addTo(editLocationMap);
        }
    });
}

async function handleEditHost() {
    const id = elements.editHostId.value;
    const host = elements.editHostInput.value.trim();
    const name = elements.editNameInput.value.trim();
    const cid = elements.editCidInput.value.trim();
    const groupId = elements.editHostGroupSelect?.value || null;

    // Parse coordinates
    let latitude = null;
    let longitude = null;
    if (elements.editCoordinatesInput.value) {
        const coords = parseCoordinates(elements.editCoordinatesInput.value);
        if (coords) {
            latitude = coords.lat;
            longitude = coords.lng;
        } else {
            alert('Format koordinat tidak valid');
            return;
        }
    }

    if (!host) {
        alert('IP Address atau Hostname wajib diisi');
        return;
    }

    // Collect SNMP Data
    const snmpEnabled = document.getElementById('editSnmpEnabled')?.checked || false;
    let snmpCommunity = null;
    let snmpVersion = null;
    let snmpInterface = null;

    if (snmpEnabled) {
        snmpCommunity = document.getElementById('editSnmpCommunity')?.value.trim() || 'public';
        snmpVersion = document.getElementById('editSnmpVersion')?.value || '2c';
        snmpInterface = document.getElementById('editSnmpInterface')?.value || null;
    }

    try {
        await updateHost(id, host, name, cid, latitude, longitude, groupId, snmpEnabled, snmpCommunity, snmpVersion, snmpInterface);
        hideModal(elements.editHostModal);

        showNotification('Host berhasil diperbarui!', 'success');

        // Refresh hosts
        const hosts = await fetchHosts();
        cachedHosts = hosts;
        renderFilteredHosts();
        updateStats(hosts);
    } catch (error) {
        showNotification(error.message || 'Gagal memperbarui host', 'danger');
    }
}

async function handleShowHistory(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.id;
    const name = btn.dataset.name;

    currentHistoryHostId = id;
    elements.historyHostName.textContent = name;

    const history = await fetchHistory(id);
    renderHistory(history);
    showModal(elements.historyModal);
}

async function handleQuickPing() {
    const host = elements.quickPingInput.value.trim();

    if (!host) {
        alert('Masukkan IP atau hostname');
        return;
    }

    showQuickPingResult(null, true);

    try {
        const result = await quickPing(host);
        showQuickPingResult(result);
    } catch (error) {
        elements.quickPingResult.className = 'quick-ping-result show error';
        elements.quickPingResult.innerHTML = `<strong>Error:</strong> Gagal melakukan ping`;
    }
}

async function handleAddHost() {
    const host = elements.hostInput.value.trim();
    const name = elements.nameInput.value.trim();
    const cid = elements.cidInput?.value.trim();
    const coordinates = elements.coordinatesInput?.value.trim(); // "lat, lng"
    const groupId = elements.hostGroupSelect?.value || null;

    // Reset validation
    elements.hostInput.classList.remove('invalid');
    elements.nameInput.classList.remove('invalid');

    if (!host || !name) {
        showNotification('Host/IP dan Nama wajib diisi', 'warning');
        if (!host) elements.hostInput.classList.add('invalid');
        if (!name) elements.nameInput.classList.add('invalid');
        return;
    }

    let lat, lng;
    if (coordinates) {
        const parts = coordinates.split(',').map(s => s.trim());
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            lat = parseFloat(parts[0]);
            lng = parseFloat(parts[1]);
        }
    }

    // Rule 3: Informative Feedback (Loading State)
    setButtonLoading(elements.saveHostBtn, true, 'Simpan');

    // Collect SNMP Data
    const snmpEnabled = document.getElementById('addSnmpEnabled')?.checked || false;
    let snmpCommunity = null;
    let snmpVersion = null;

    if (snmpEnabled) {
        snmpCommunity = document.getElementById('addSnmpCommunity')?.value.trim() || 'public';
        snmpVersion = document.getElementById('addSnmpVersion')?.value || '2c';
    }

    try {
        await addHost(host, name, lat, lng, cid, groupId, snmpEnabled, snmpCommunity, snmpVersion);
        showNotification('Host berhasil ditambahkan', 'success');
        hideModal(elements.addHostModal);

        // Rule 4: Closure (Reset form)
        elements.hostInput.value = '';
        elements.nameInput.value = '';
        if (elements.cidInput) elements.cidInput.value = '';
        if (elements.coordinatesInput) elements.coordinatesInput.value = '';
        if (elements.hostGroupSelect) elements.hostGroupSelect.value = '';

        // Reset SNMP
        const addSnmpEnabled = document.getElementById('addSnmpEnabled');
        if (addSnmpEnabled) {
            addSnmpEnabled.checked = false;
            document.getElementById('addSnmpFields').style.display = 'none';
            document.getElementById('addSnmpCommunity').value = 'public';
        }

        refreshData();
    } catch (error) {
        showNotification(error.message || 'Gagal menambahkan host', 'danger');
    } finally {
        setButtonLoading(elements.saveHostBtn, false, 'Simpan');
    }
}

async function handleAutoPingToggle() {
    try {
        await toggleAutoPing();
    } catch (error) {
        console.error('Error toggling auto-ping:', error);
    }
}

// ========================================
// Utility Functions
// ========================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function parseCoordinates(input) {
    if (!input) return null;
    const parts = input.split(',').map(p => p.trim());
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
}

function formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function formatDateTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}


function formatDuration(startIso, endIso) {
    if (!startIso || !endIso) return '-';

    const start = new Date(startIso);
    const end = new Date(endIso);
    const diffMs = end - start;

    if (diffMs < 0) return '-';

    const diffSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(diffSeconds / 86400);
    const hours = Math.floor((diffSeconds % 86400) / 3600);
    const minutes = Math.floor((diffSeconds % 3600) / 60);
    const seconds = diffSeconds % 60;

    let parts = [];
    if (days > 0) parts.push(`${days}h`);      // h = hari
    if (hours > 0) parts.push(`${hours}j`);    // j = jam
    if (minutes > 0) parts.push(`${minutes}m`); // m = menit
    if (seconds > 0 && days === 0 && hours === 0) parts.push(`${seconds}d`); // d = detik (only show if less than 1 hour)

    return parts.length > 0 ? parts.join(' ') : '< 1d';
}

// ========================================
// Map Functions
// ========================================


function initMap() {
    if (networkMap) return;

    // Initialize map centered on Indonesia
    networkMap = L.map('networkMap').setView([-2.5, 118.0], 5);

    // Add dark tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19
    }).addTo(networkMap);

    // Initialize marker cluster group with custom icon
    markerCluster = L.markerClusterGroup({
        chunkedLoading: true,
        showCoverageOnHover: false,
        maxClusterRadius: 60,
        iconCreateFunction: function (cluster) {
            const childMarkers = cluster.getAllChildMarkers();
            const count = childMarkers.length;

            // Count online/offline hosts in cluster
            let online = 0, offline = 0;
            childMarkers.forEach(m => {
                if (m.options.hostStatus === 'online') online++;
                else if (m.options.hostStatus === 'offline') offline++;
            });

            // Determine cluster color based on status
            let bgColor = '#10b981'; // green by default
            if (offline > 0 && online === 0) {
                bgColor = '#ef4444'; // red if all offline
            } else if (offline > 0) {
                bgColor = '#f59e0b'; // orange if mixed
            }

            return L.divIcon({
                html: `<div class="cluster-icon" style="
                    background: ${bgColor};
                    width: ${30 + Math.min(count * 2, 20)}px;
                    height: ${30 + Math.min(count * 2, 20)}px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: 600;
                    font-size: ${12 + Math.min(count, 6)}px;
                    border: 3px solid rgba(255,255,255,0.8);
                    box-shadow: 0 0 20px ${bgColor}80;
                ">${count}</div>`,
                className: 'custom-cluster-icon',
                iconSize: L.point(40, 40)
            });
        }
    });

    networkMap.addLayer(markerCluster);

    // Handle window resize (especially important for mobile orientation changes)
    let resizeTimeout;
    window.addEventListener('resize', () => {
        if (networkMap && !elements.mapSection.classList.contains('hidden')) {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                networkMap.invalidateSize();
                fitMapToMarkers();
            }, 200);
        }
    });

    // Add markers for cached hosts
    updateMapMarkers(cachedHosts);
}

/**
 * Fit map view to show all markers properly (especially important for mobile)
 */
function fitMapToMarkers() {
    if (!networkMap || !markerCluster) return;

    // Get bounds from cluster layer
    const bounds = markerCluster.getBounds();

    if (bounds.isValid()) {
        // Add padding for better visibility on mobile
        networkMap.fitBounds(bounds, {
            padding: [30, 30],
            maxZoom: 10 // Don't zoom too close
        });
    } else {
        // Fallback to default Indonesia view if no markers
        networkMap.setView([-2.5, 118.0], 5);
    }
}

function createMarkerIcon(status) {
    const color = status === 'online' ? '#10b981' : status === 'offline' ? '#ef4444' : '#6b6b7b';

    return L.divIcon({
        className: `marker-icon marker-${status}`,
        html: `<div style="
            width: 24px;
            height: 24px;
            background: ${color};
            border-radius: 50%;
            border: 3px solid rgba(255,255,255,0.8);
            box-shadow: 0 0 15px ${color}80;
            ${status === 'offline' ? 'animation: markerPulse 1s infinite;' : ''}
        "></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
    });
}

function updateMapMarkers(hosts) {
    if (!networkMap || !markerCluster) return;

    // Track which host IDs we've processed
    const processedIds = new Set();

    hosts.forEach(host => {
        if (host.latitude && host.longitude) {
            processedIds.add(host.id);

            const popupContent = `
                <div class="marker-popup">
                    <h4>${escapeHtml(host.name)}</h4>
                    <div class="host-ip">${escapeHtml(host.host)}</div>
                    <span class="status ${host.status}">${host.status === 'online' ? '● Online' : host.status === 'offline' ? '● Offline' : '● Unknown'}</span>
                    ${host.latency ? `<div class="latency">Latency: ${host.latency}ms</div>` : ''}
                    <button class="btn btn-secondary btn-sm location-btn" data-host-id="${host.id}">📍 Ubah Lokasi</button>
                </div>
            `;

            if (hostMarkers[host.id]) {
                // Update existing marker
                const marker = hostMarkers[host.id];
                marker.setIcon(createMarkerIcon(host.status));
                marker.setLatLng([host.latitude, host.longitude]);
                marker.setPopupContent(popupContent);
                marker.options.hostStatus = host.status;
            } else {
                // Create new marker
                const marker = L.marker([host.latitude, host.longitude], {
                    icon: createMarkerIcon(host.status),
                    hostStatus: host.status
                });

                marker.bindPopup(popupContent);

                // Handle popup button clicks (CSP compliant - no inline onclick)
                marker.on('popupopen', () => {
                    const popup = marker.getPopup();
                    const locationBtn = popup.getElement().querySelector('.location-btn');
                    if (locationBtn) {
                        locationBtn.addEventListener('click', () => {
                            openLocationModal(locationBtn.dataset.hostId);
                        });
                    }
                });

                // Right-click to edit location
                marker.on('contextmenu', () => {
                    openLocationModal(host.id);
                });

                hostMarkers[host.id] = marker;
                markerCluster.addLayer(marker);
            }
        } else {
            // Remove marker if host no longer has location
            if (hostMarkers[host.id]) {
                markerCluster.removeLayer(hostMarkers[host.id]);
                delete hostMarkers[host.id];
            }
        }
    });

    // Remove markers for deleted hosts
    Object.keys(hostMarkers).forEach(hostId => {
        if (!processedIds.has(hostId)) {
            markerCluster.removeLayer(hostMarkers[hostId]);
            delete hostMarkers[hostId];
        }
    });

    // Refresh cluster icons to update colors
    markerCluster.refreshClusters();
}

// ========================================
// Logs Functions
// ========================================

let cachedLogs = [];

async function fetchLogs() {
    try {
        const response = await fetch(`${API_BASE}/api/logs?limit=100`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching logs:', error);
        return [];
    }
}

async function loadAndRenderLogs() {
    cachedLogs = await fetchLogs();
    updateLogHostFilter();
    renderLogs();
}

function updateLogHostFilter() {
    const select = elements.logHostFilter;
    const selectedValue = select.value;

    // Get unique hosts from logs
    const hosts = [...new Set(cachedLogs.map(log => JSON.stringify({ id: log.hostId, name: log.hostName })))];
    const uniqueHosts = hosts.map(h => JSON.parse(h));

    select.innerHTML = '<option value="">Semua Host</option>' +
        uniqueHosts.map(h => `<option value="${h.id}">${escapeHtml(h.name)}</option>`).join('');

    // Restore selection
    select.value = selectedValue;
}

function renderLogs() {
    const filterHostId = elements.logHostFilter.value;
    const filteredLogs = filterHostId
        ? cachedLogs.filter(log => log.hostId === filterHostId)
        : cachedLogs;

    if (filteredLogs.length === 0) {
        elements.logsList.innerHTML = `
            <div class="logs-empty">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                </svg>
                <p>${filterHostId ? 'Tidak ada log untuk host ini' : 'Belum ada log perubahan status'}</p>
            </div>
        `;
        return;
    }

    elements.logsList.innerHTML = filteredLogs.map(log => `
        <div class="log-item">
            <div class="log-icon ${log.type}">
                ${log.type === 'down' ? '🔴' : '🟢'}
            </div>
            <div class="log-content">
                <div class="log-title ${log.type}">
                    ${log.type === 'down' ? 'Host DOWN' : 'Host UP'}
                </div>
                <div class="log-host">${escapeHtml(log.hostName)} (${escapeHtml(log.host)})</div>
            </div>
            <div class="log-time">${formatDateTime(log.timestamp)}</div>
        </div>
    `).join('');
}

// ========================================
// Tab Navigation
// ========================================

function switchTab(tabName) {
    // Save current tab to localStorage
    localStorage.setItem('currentTab', tabName);

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-view="${tabName}"]`).classList.add('active');

    // Show/hide sections
    elements.hostsSection.classList.toggle('hidden', tabName !== 'hosts');
    elements.mapSection.classList.toggle('hidden', tabName !== 'map');
    elements.logsSection.classList.toggle('hidden', tabName !== 'logs');
    if (elements.ticketsSection) {
        elements.ticketsSection.classList.toggle('hidden', tabName !== 'tickets');
    }
    if (elements.usersSection) {
        elements.usersSection.classList.toggle('hidden', tabName !== 'users');
    }
    if (elements.statsSection) {
        elements.statsSection.classList.toggle('hidden', tabName !== 'stats');
    }
    if (elements.auditSection) {
        elements.auditSection.classList.toggle('hidden', tabName !== 'audit');
    }

    // Initialize map when switching to map tab
    if (tabName === 'map') {
        setTimeout(() => {
            initMap();
            if (networkMap) {
                networkMap.invalidateSize();
                // Fit bounds to all markers for proper centering on mobile
                fitMapToMarkers();
            }
        }, 150);
    }

    // Load logs when switching to logs tab
    if (tabName === 'logs') {
        loadAndRenderLogs();
    }

    // Load tickets when switching to tickets tab
    if (tabName === 'tickets') {
        loadAndRenderTickets();
    }

    // Load users when switching to users tab
    if (tabName === 'users') {
        loadUsers();
    }

    // Load stats when switching to stats tab
    if (tabName === 'stats') {
        loadAndRenderStats();
    }

    // Load audit logs when switching to audit tab
    if (tabName === 'audit') {
        loadAndRenderAuditLogs();
    }
}

// ========================================
// Location Modal Functions
// ========================================

function openLocationModal(hostId) {
    const host = cachedHosts.find(h => h.id === hostId);
    if (!host) return;

    currentLocationHostId = hostId;
    elements.locationHostName.textContent = host.name;
    elements.coordinatesInput.value = (host.latitude && host.longitude)
        ? `${host.latitude}, ${host.longitude}`
        : '';

    // Clear address search
    elements.addressSearchInput.value = '';
    elements.addressSearchResults.innerHTML = '';

    showModal(elements.locationModal);

    // Initialize location picker map after modal is shown
    setTimeout(() => {
        initLocationPickerMap(host.latitude, host.longitude);
    }, 200);
}

function initLocationPickerMap(lat, lng) {
    if (locationPickerMap) {
        locationPickerMap.remove();
    }

    const defaultLat = lat || -2.5;
    const defaultLng = lng || 118.0;
    const zoom = lat && lng ? 10 : 5;

    locationPickerMap = L.map('locationPickerMap').setView([defaultLat, defaultLng], zoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OSM © CARTO',
        maxZoom: 19
    }).addTo(locationPickerMap);

    // Add marker if location exists
    if (lat && lng) {
        locationPickerMarker = L.marker([lat, lng]).addTo(locationPickerMap);
    }

    // Click on map to set location
    locationPickerMap.on('click', (e) => {
        const { lat, lng } = e.latlng;
        elements.coordinatesInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

        if (locationPickerMarker) {
            locationPickerMarker.setLatLng([lat, lng]);
        } else {
            locationPickerMarker = L.marker([lat, lng]).addTo(locationPickerMap);
        }
    });
}

async function saveHostLocation() {
    const coords = parseCoordinates(elements.coordinatesInput.value);

    if (!coords) {
        alert('Masukkan koordinat yang valid (Format: Latitude, Longitude)');
        return;
    }

    const { lat, lng } = coords;

    try {
        const response = await fetch(`${API_BASE}/api/hosts/${currentLocationHostId}/location`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: lat, longitude: lng })
        });

        if (response.ok) {
            hideModal(elements.locationModal);
            showNotification('Lokasi host berhasil diperbarui', 'success');
        } else {
            alert('Gagal menyimpan lokasi');
        }
    } catch (error) {
        console.error('Error saving location:', error);
        alert('Gagal menyimpan lokasi');
    }
}

// ========================================
// Address Search (Geocoding)
// ========================================

async function handleEditAddressSearch() {
    const query = elements.editAddressSearchInput.value.trim();

    if (!query) {
        elements.editAddressSearchResults.innerHTML = '';
        return;
    }

    // Show loading
    elements.editAddressSearchResults.innerHTML = `
        <div class="search-loading">
            <span class="loading-spinner"></span> Mencari lokasi...
        </div>
    `;

    try {
        // Use OpenStreetMap Nominatim API (free, no API key required)
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`,
            {
                headers: {
                    'Accept-Language': 'id',
                    'User-Agent': 'NetworkMonitorApp/1.0'
                }
            }
        );

        const results = await response.json();

        if (results.length === 0) {
            elements.editAddressSearchResults.innerHTML = `
                <div class="search-no-results">
                    Tidak ditemukan lokasi untuk "${escapeHtml(query)}"
                </div>
            `;
            return;
        }

        // Render search results
        elements.editAddressSearchResults.innerHTML = results.map(item => `
            <div class="search-result-item" 
                 data-lat="${escapeHtml(item.lat)}" 
                 data-lng="${escapeHtml(item.lon)}"
                 data-display="${escapeHtml(item.display_name)}">
                <div class="host-name">${escapeHtml(item.display_name.split(',')[0])}</div>
                <div class="host-ip">${escapeHtml(item.display_name)}</div>
            </div>
        `).join('');

        // Add click handlers to results
        document.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                handleSelectEditAddress(item);
            });
        });

    } catch (error) {
        console.error('Geocoding error:', error);
        elements.editAddressSearchResults.innerHTML = `
            <div class="search-no-results">
                Gagal mencari lokasi. Silakan coba lagi.
            </div>
        `;
    }
}

async function handleLocationAddressSearch() {
    const query = elements.addressSearchInput.value.trim();

    if (!query) {
        elements.addressSearchResults.innerHTML = '';
        return;
    }

    // Show loading
    elements.addressSearchResults.innerHTML = `
        <div class="search-loading">
            <span class="loading-spinner"></span> Mencari lokasi...
        </div>
    `;

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`,
            {
                headers: {
                    'Accept-Language': 'id',
                    'User-Agent': 'NetworkMonitorApp/1.0'
                }
            }
        );

        const results = await response.json();

        if (results.length === 0) {
            elements.addressSearchResults.innerHTML = `
                <div class="search-no-results">
                    Tidak ditemukan lokasi untuk "${escapeHtml(query)}"
                </div>
            `;
            return;
        }

        // Render search results
        elements.addressSearchResults.innerHTML = results.map(result => `
            <div class="search-result-item" 
                 data-lat="${result.lat}" 
                 data-lng="${result.lon}"
                 data-name="${escapeHtml(result.display_name)}">
                <div class="result-name">${escapeHtml(result.name || result.display_name.split(',')[0])}</div>
                <div class="result-address">${escapeHtml(result.display_name)}</div>
            </div>
        `).join('');

        // Add click handlers to results
        elements.addressSearchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const lat = parseFloat(item.dataset.lat);
                const lng = parseFloat(item.dataset.lng);

                elements.coordinatesInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                elements.addressSearchResults.innerHTML = ''; // Clear results

                // Update map
                if (locationPickerMap) {
                    locationPickerMap.setView([lat, lng], 15);
                    if (locationPickerMarker) {
                        locationPickerMarker.setLatLng([lat, lng]);
                    } else {
                        locationPickerMarker = L.marker([lat, lng]).addTo(locationPickerMap);
                    }
                }
            });
        });

    } catch (error) {
        console.error('Search error:', error);
        elements.addressSearchResults.innerHTML = `
            <div class="search-error">Gagal mencari lokasi</div>
        `;
    }
}

function handleSelectEditAddress(item) {
    const lat = parseFloat(item.dataset.lat);
    const lng = parseFloat(item.dataset.lng);

    // Update coordinate inputs
    elements.editCoordinatesInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    // Update map and marker
    if (editLocationMap) {
        editLocationMap.setView([lat, lng], 15);

        if (editLocationMarker) {
            editLocationMarker.setLatLng([lat, lng]);
        } else {
            editLocationMarker = L.marker([lat, lng]).addTo(editLocationMap);
        }
    }

    // Clear search results and input
    elements.editAddressSearchResults.innerHTML = '';
    elements.editAddressSearchInput.value = '';
}

// Address Search for Add Host Modal
async function searchAddHostAddress() {
    const query = elements.addHostAddressInput.value.trim();

    if (!query) {
        elements.addHostSearchResults.innerHTML = '';
        return;
    }

    elements.addHostSearchResults.innerHTML = `
        <div class="search-loading">Mencari lokasi...</div>
    `;

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`,
            {
                headers: {
                    'Accept-Language': 'id',
                    'User-Agent': 'NetworkMonitorApp/1.0'
                }
            }
        );

        const results = await response.json();

        if (results.length === 0) {
            elements.addHostSearchResults.innerHTML = `
                <div class="search-no-results">Tidak ditemukan lokasi untuk "${escapeHtml(query)}"</div>
            `;
            return;
        }

        elements.addHostSearchResults.innerHTML = results.map(result => `
            <div class="search-result-item add-host-result" 
                 data-lat="${result.lat}" 
                 data-lng="${result.lon}"
                 data-name="${escapeHtml(result.display_name)}">
                <div class="result-name">${escapeHtml(result.name || result.display_name.split(',')[0])}</div>
                <div class="result-address">${escapeHtml(result.display_name)}</div>
            </div>
        `).join('');

        // Add click handlers
        document.querySelectorAll('.add-host-result').forEach(item => {
            item.addEventListener('click', () => {
                const lat = parseFloat(item.dataset.lat);
                const lng = parseFloat(item.dataset.lng);

                elements.addHostCoordinatesInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                elements.addHostSearchResults.innerHTML = '';
                elements.addHostAddressInput.value = '';

                showNotification(`Lokasi dipilih: ${item.dataset.name.split(',')[0]}`, 'success');
            });
        });

    } catch (error) {
        console.error('Geocoding error:', error);
        elements.addHostSearchResults.innerHTML = `
            <div class="search-no-results">Gagal mencari lokasi. Silakan coba lagi.</div>
        `;
    }
}

// ========================================
// Auth Functions
// ========================================

async function checkAuth() {
    try {
        const response = await fetch('/api/me');
        if (response.status === 401) {
            window.location.href = 'login.html';
            return;
        }
        const user = await response.json();
        currentUser = user;

        // Display username in header
        if (elements.currentUserName) {
            elements.currentUserName.textContent = user.name || user.username;
        }

        // Show/Hide Admin Elements
        if (user.role === 'admin') {
            elements.usersTabBtn.classList.remove('hidden');
            if (elements.settingsBtn) elements.settingsBtn.classList.remove('hidden');
            // Phase 1: Show Audit Log tab for admin
            if (elements.auditTabBtn) elements.auditTabBtn.classList.remove('hidden');
        }

        // Phase 2: Show Maintenance button for all authenticated users
        if (elements.maintenanceBtn) {
            elements.maintenanceBtn.style.display = 'inline-flex';
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = 'login.html';
    }
}

function openEditProfileModal() {
    if (!currentUser) return;
    elements.profileUsernameInput.value = currentUser.username || '';
    elements.profileNameInput.value = currentUser.name || '';
    elements.profilePasswordInput.value = '';
    showModal(elements.editProfileModal);
}

async function handleSaveProfile() {
    const username = elements.profileUsernameInput.value.trim();
    const name = elements.profileNameInput.value.trim();
    const password = elements.profilePasswordInput.value;

    if (!username) {
        alert('Username wajib diisi');
        return;
    }

    if (password && !isStrongPassword(password)) {
        alert(getPasswordStrengthError());
        return;
    }

    // Rule 3: Informative Feedback
    setButtonLoading(elements.saveProfileBtn, true, 'Simpan Profile');

    try {
        const response = await fetch('/api/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, name, password: password || undefined })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to update profile');
        }

        const updatedUser = await response.json();
        currentUser = updatedUser;

        // Update displayed name
        if (elements.currentUserName) {
            elements.currentUserName.textContent = updatedUser.name || updatedUser.username;
        }

        hideModal(elements.editProfileModal);
        showNotification('Profile berhasil diperbarui', 'success');
    } catch (error) {
        alert(error.message);
    } finally {
        setButtonLoading(elements.saveProfileBtn, false, 'Simpan Profile');
    }
}

async function handleLogout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = 'login.html';
    } catch (error) {
        console.error('Logout failed:', error);
    }
}

// ========================================
// User Management Functions
// ========================================

async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        if (!response.ok) throw new Error('Failed to fetch users');
        const users = await response.json();
        renderUsers(users);
    } catch (error) {
        console.error('Error loading users:', error);
        showNotification('Gagal memuat list user', 'error');
    }
}

function renderUsers(users) {
    if (!elements.usersTableBody) return;
    elements.usersTableBody.innerHTML = users.map(user => `
        <tr>
            <td>${escapeHtml(user.username)}</td>
            <td>${escapeHtml(user.name)}</td>
            <td>
                <span class="badge badge-${user.role}">${user.role}</span>
            </td>
            <td>
                ${user.role !== 'admin' || user.username !== 'admin' ? `
                <button class="btn btn-secondary btn-sm edit-user-btn" data-id="${user.id}">
                    Edit
                </button>
                <button class="btn btn-danger btn-sm delete-user-btn" data-id="${user.id}">
                    Hapus
                </button>` : ''}
            </td>
        </tr>
    `).join('');

    document.querySelectorAll('.edit-user-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const user = users.find(u => u.id === e.currentTarget.dataset.id);
            openEditUserModal(user);
        });
    });

    document.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', handleDeleteUser);
    });
}

function openEditUserModal(user) {
    if (!user) return;

    elements.editUserId.value = user.id;
    elements.editUsernameInput.value = user.username;
    elements.editPasswordInput.value = ''; // Don't show password
    elements.editUserRealNameInput.value = user.name;
    elements.editUserRoleInput.value = user.role;

    showModal(elements.editUserModal);
}

async function handleEditUser() {
    const id = elements.editUserId.value;
    const username = elements.editUsernameInput.value.trim();
    const password = elements.editPasswordInput.value.trim();
    const name = elements.editUserRealNameInput.value.trim();
    const role = elements.editUserRoleInput.value;

    elements.editUsernameInput.classList.remove('invalid');

    if (!username) {
        showNotification('Username wajib diisi', 'warning');
        elements.editUsernameInput.classList.add('invalid');
        return;
    }

    // Rule 3: Informative Feedback
    setButtonLoading(elements.saveEditUserBtn, true, 'Simpan Perubahan');

    try {
        const payload = { username, name, role };
        if (password) payload.password = password;

        const response = await fetch(`/api/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to update user');
        }

        showNotification('User berhasil diperbarui', 'success');
        hideModal(elements.editUserModal);
        loadUsers();
    } catch (error) {
        showNotification(error.message || 'Gagal memperbarui user', 'error');
    } finally {
        setButtonLoading(elements.saveEditUserBtn, false, 'Simpan Perubahan');
    }
}

async function saveUser() {
    const username = elements.newUsernameInput.value.trim();
    const password = elements.newPasswordInput.value.trim();
    const name = elements.newNameInput.value.trim();
    const role = elements.newRoleInput.value;

    elements.newUsernameInput.classList.remove('invalid');
    elements.newPasswordInput.classList.remove('invalid');

    if (!username || !password) {
        showNotification('Username dan Password wajib diisi', 'warning');
        if (!username) elements.newUsernameInput.classList.add('invalid');
        if (!password) elements.newPasswordInput.classList.add('invalid');
        return;
    }

    // Rule 3: Informative Feedback
    setButtonLoading(elements.saveUserBtn, true, 'Simpan User');

    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, name, role })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to create user');
        }

        showNotification('User berhasil ditambahkan', 'success');
        hideModal(elements.addUserModal);

        // Reset form
        elements.newUsernameInput.value = '';
        elements.newPasswordInput.value = '';
        elements.newNameInput.value = '';

        loadUsers();
    } catch (error) {
        showNotification(error.message || 'Gagal menambahkan user', 'error');
    } finally {
        setButtonLoading(elements.saveUserBtn, false, 'Simpan User');
    }
}

async function handleDeleteUser(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.id;

    // Rule 4 & 5: Error Prevention
    confirmDelete('Apakah Anda yakin ingin menghapus user ini?', async () => {
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.innerHTML = '<span class="loading-spinner" style="width:10px;height:10px;"></span>';

        try {
            const response = await fetch(`/api/users/${id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete user');

            showNotification('User berhasil dihapus', 'success');
            loadUsers();
        } catch (error) {
            showNotification(error.message || 'Gagal menghapus user', 'error');
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });
}

// Make openLocationModal and openEditHostModal accessible globally
window.openLocationModal = openLocationModal;
window.openEditHostModal = openEditHostModal;
window.handleDeleteComment = handleDeleteComment;

// ========================================
// Initialize
// ========================================

async function init() {
    // Check Auth
    await checkAuth();

    // Connect to SSE for real-time updates
    connectSSE();

    // Fetch and render hosts
    const hosts = await fetchHosts();
    cachedHosts = hosts;
    renderFilteredHosts();
    updateStats(hosts);

    // Fetch users for PIC selection
    await fetchUsersForPic();

    // Restore saved tab from localStorage
    const savedTab = localStorage.getItem('currentTab');
    if (savedTab && ['hosts', 'map', 'logs', 'tickets', 'users'].includes(savedTab)) {
        switchTab(savedTab);
    }

    // Event listeners - Search
    elements.hostSearchInput.addEventListener('input', handleHostSearch);

    // Event listeners - Status Filter
    if (elements.statCardOnline) {
        elements.statCardOnline.addEventListener('click', () => setStatusFilter('online'));
    }
    if (elements.statCardOffline) {
        elements.statCardOffline.addEventListener('click', () => setStatusFilter('offline'));
    }
    if (elements.statCardTotal) {
        elements.statCardTotal.addEventListener('click', () => setStatusFilter('all'));
    }

    // Event listeners - Buttons
    elements.logoutBtn.addEventListener('click', handleLogout);
    elements.pingAllBtn.addEventListener('click', handlePingAll);
    elements.addHostBtn.addEventListener('click', () => showModal(elements.addHostModal));
    elements.addHostBtn.addEventListener('click', () => showModal(elements.addHostModal));
    elements.addFirstHostBtn.addEventListener('click', () => showModal(elements.addHostModal));

    // Event listeners - Settings (now handled by initApiWebhooksHandlers)
    // Settings button opens API & Webhooks modal instead
    if (elements.closeSettingsModalBtn) {
        elements.closeSettingsModalBtn.addEventListener('click', () => hideModal(elements.settingsModal));
    }
    if (elements.cancelSettingsModalBtn) {
        elements.cancelSettingsModalBtn.addEventListener('click', () => hideModal(elements.settingsModal));
    }
    if (elements.saveSettingsBtn) {
        elements.saveSettingsBtn.addEventListener('click', handleSaveSettings);
    }
    if (elements.testTelegramBtn) {
        elements.testTelegramBtn.addEventListener('click', handleTestTelegram);
    }

    // Event listeners - Quick Ping
    elements.quickPingBtn.addEventListener('click', handleQuickPing);
    elements.quickPingInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleQuickPing();
    });

    // Auto Ping is now always enabled - no toggle needed

    // Event listeners - Add Host Modal
    elements.closeModalBtn.addEventListener('click', () => hideModal(elements.addHostModal));
    elements.cancelModalBtn.addEventListener('click', () => hideModal(elements.addHostModal));
    elements.saveHostBtn.addEventListener('click', handleAddHost);
    elements.hostInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAddHost();
    });

    // Event listeners - Ping Modal
    const cleanClosePing = () => {
        if (currentPingController) {
            currentPingController.abort();
            currentPingController = null;
        }
        hideModal(elements.pingModal);
    };
    elements.closePingBtn.addEventListener('click', cleanClosePing);
    elements.closePingModalBtn.addEventListener('click', cleanClosePing);

    // Event listeners - Traceroute Modal
    const cleanCloseTraceroute = () => {
        if (currentTracerouteController) {
            currentTracerouteController.abort();
            currentTracerouteController = null;
        }
        hideModal(elements.tracerouteModal);
    };
    elements.closeTracerouteBtn.addEventListener('click', cleanCloseTraceroute);
    elements.closeTracerouteModalBtn.addEventListener('click', cleanCloseTraceroute);

    // Event listeners - Edit Host Modal
    if (elements.closeEditHostModalBtn) {
        elements.closeEditHostModalBtn.addEventListener('click', () => hideModal(elements.editHostModal));
    }
    if (elements.cancelEditHostModalBtn) {
        elements.cancelEditHostModalBtn.addEventListener('click', () => hideModal(elements.editHostModal));
    }
    elements.saveEditHostBtn.addEventListener('click', handleEditHost);
    elements.editHostInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleEditHost();
    });
    elements.editNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleEditHost();
    });

    // Event listeners - Add Host Location Toggle
    elements.addLocationToggle.addEventListener('change', () => {
        elements.addHostLocationFields.classList.toggle('hidden', !elements.addLocationToggle.checked);
    });

    // Event listeners - Add Host Address Search
    elements.searchAddHostAddressBtn.addEventListener('click', searchAddHostAddress);
    elements.addHostAddressInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            searchAddHostAddress();
        }
    });

    // Event listeners - History Modal
    elements.closeHistoryBtn.addEventListener('click', () => hideModal(elements.historyModal));

    // Event listeners - Map
    if (elements.restoreMapBtn) {
        elements.restoreMapBtn.addEventListener('click', () => {
            if (networkMap) {
                // First try to fit to all markers
                if (markerCluster && Object.keys(hostMarkers).length > 0) {
                    const bounds = markerCluster.getBounds();
                    if (bounds.isValid()) {
                        networkMap.fitBounds(bounds, {
                            padding: [30, 30],
                            maxZoom: 10
                        });
                        return;
                    }
                }
                // Fallback: Use Indonesia bounds that work on all screen sizes
                const indonesiaBounds = L.latLngBounds(
                    L.latLng(-11.0, 95.0),   // Southwest corner
                    L.latLng(6.0, 141.0)     // Northeast corner
                );
                networkMap.fitBounds(indonesiaBounds, {
                    padding: [20, 20]
                });
            }
        });
    }

    // Event listeners - Location Modal
    if (elements.closeLocationBtn) {
        elements.closeLocationBtn.addEventListener('click', () => hideModal(elements.locationModal));
    }
    if (elements.cancelLocationBtn) {
        elements.cancelLocationBtn.addEventListener('click', () => hideModal(elements.locationModal));
    }
    if (elements.saveLocationBtn) {
        elements.saveLocationBtn.addEventListener('click', saveHostLocation);
    }
    if (elements.searchAddressBtn) {
        elements.searchAddressBtn.addEventListener('click', handleLocationAddressSearch);
    }
    if (elements.addressSearchInput) {
        elements.addressSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleLocationAddressSearch();
        });
    }

    // Event listeners - Edit Profile
    if (elements.editProfileBtn) {
        elements.editProfileBtn.addEventListener('click', openEditProfileModal);
    }
    if (elements.closeEditProfileBtn) {
        elements.closeEditProfileBtn.addEventListener('click', () => hideModal(elements.editProfileModal));
    }
    if (elements.cancelEditProfileBtn) {
        elements.cancelEditProfileBtn.addEventListener('click', () => hideModal(elements.editProfileModal));
    }
    if (elements.saveProfileBtn) {
        elements.saveProfileBtn.addEventListener('click', handleSaveProfile);
    }

    // Event listeners - Tab Navigation
    elements.hostsTabBtn.addEventListener('click', () => switchTab('hosts'));
    elements.mapTabBtn.addEventListener('click', () => switchTab('map'));
    elements.logsTabBtn.addEventListener('click', () => switchTab('logs'));
    elements.ticketsTabBtn.addEventListener('click', () => switchTab('tickets'));
    elements.usersTabBtn.addEventListener('click', () => switchTab('users'));
    if (elements.statsTabBtn) {
        elements.statsTabBtn.addEventListener('click', () => switchTab('stats'));
    }
    if (elements.auditTabBtn) {
        elements.auditTabBtn.addEventListener('click', () => switchTab('audit'));
    }

    // Event listeners - Tickets
    if (elements.openCreateTicketModalBtn) {
        elements.openCreateTicketModalBtn.addEventListener('click', openCreateTicketModal);
    }

    if (elements.exportTicketsBtn) {
        elements.exportTicketsBtn.addEventListener('click', exportTickets);
    }

    if (elements.ticketStatusFilter) {
        elements.ticketStatusFilter.addEventListener('change', (e) => {
            currentTicketStatusFilter = e.target.value;
            currentTicketPage = 1; // Reset to first page
            renderTickets();
        });
    }
    if (elements.ticketSearchInput) {
        elements.ticketSearchInput.addEventListener('input', (e) => {
            currentTicketSearchQuery = e.target.value;
            currentTicketPage = 1; // Reset to first page
            renderTickets();
        });
    }
    if (elements.ticketHostFilter) {
        elements.ticketHostFilter.addEventListener('change', () => {
            currentTicketPage = 1; // Reset to first page
            renderTickets();
        });
    }
    if (elements.ticketSubmitterFilter) {
        elements.ticketSubmitterFilter.addEventListener('change', () => {
            currentTicketPage = 1; // Reset to first page
            renderTickets();
        });
    }
    if (elements.ticketDateFilter) {
        elements.ticketDateFilter.addEventListener('change', () => {
            currentTicketPage = 1; // Reset to first page
            renderTickets();
        });
    }
    if (elements.addCommentBtn) {
        elements.addCommentBtn.addEventListener('click', handleAddComment);
    }
    if (elements.newCommentInput) {
        elements.newCommentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.stopImmediatePropagation(); // Prevent global modal enter handler
                handleAddComment();
            }
        });
    }
    if (elements.closeCreateTicketBtn) {
        elements.closeCreateTicketBtn.addEventListener('click', () => hideModal(elements.createTicketModal));
    }
    if (elements.cancelCreateTicketBtn) {
        elements.cancelCreateTicketBtn.addEventListener('click', () => hideModal(elements.createTicketModal));
    }
    if (elements.saveTicketBtn) {
        elements.saveTicketBtn.addEventListener('click', handleCreateTicket);
    }
    if (elements.closeEditTicketBtn) {
        elements.closeEditTicketBtn.addEventListener('click', () => hideModal(elements.editTicketModal));
    }
    if (elements.cancelEditTicketBtn) {
        elements.cancelEditTicketBtn.addEventListener('click', () => hideModal(elements.editTicketModal));
    }
    if (elements.saveEditTicketBtn) {
        elements.saveEditTicketBtn.addEventListener('click', handleUpdateTicket);
    }
    if (elements.deleteTicketBtn) {
        elements.deleteTicketBtn.addEventListener('click', handleDeleteTicket);
    }

    // Status change listener for Manual Resolved At Input
    if (elements.editTicketStatus) {
        elements.editTicketStatus.addEventListener('change', (e) => {
            const manualResolvedAtGroup = document.getElementById('manualResolvedAtGroup');
            const resolvedAtInput = document.getElementById('editTicketResolvedAtInput');

            if (e.target.value === 'resolved') {
                if (manualResolvedAtGroup) manualResolvedAtGroup.style.display = 'block';
                // Jika input kosong, isi dengan waktu sekarang
                if (resolvedAtInput && !resolvedAtInput.value) {
                    const now = new Date();
                    // Adjust to local ISO string for datetime-local
                    const year = now.getFullYear();
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    resolvedAtInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
                }
            } else {
                if (manualResolvedAtGroup) manualResolvedAtGroup.style.display = 'none';
            }
        });
    }

    // Event listeners - Ticket Image Upload Preview
    if (elements.ticketImageInput) {
        elements.ticketImageInput.addEventListener('change', (e) => {
            showImagePreview(e.target.files, elements.ticketImagePreview, true);
        });
    }
    if (elements.commentImageInput) {
        elements.commentImageInput.addEventListener('change', (e) => {
            showImagePreview(e.target.files, elements.commentImagePreview, false);
        });
    }

    // Event listeners - Logs Refresh
    elements.refreshLogsBtn.addEventListener('click', loadAndRenderLogs);
    elements.logHostFilter.addEventListener('change', renderLogs);

    // Event listeners - User Mgmt
    elements.addUserBtn.addEventListener('click', () => showModal(elements.addUserModal));
    elements.closeAddUserModalBtn.addEventListener('click', () => hideModal(elements.addUserModal));
    elements.cancelAddUserModalBtn.addEventListener('click', () => hideModal(elements.addUserModal));
    elements.saveUserBtn.addEventListener('click', saveUser);

    // Event listeners - Edit User Mgmt
    elements.closeEditUserModalBtn.addEventListener('click', () => hideModal(elements.editUserModal));
    elements.cancelEditUserModalBtn.addEventListener('click', () => hideModal(elements.editUserModal));
    elements.saveEditUserBtn.addEventListener('click', handleEditUser);

    // Event listeners - Edit Address Search
    if (elements.editSearchAddressBtn) {
        elements.editSearchAddressBtn.addEventListener('click', handleEditAddressSearch);
    }
    if (elements.editAddressSearchInput) {
        elements.editAddressSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleEditAddressSearch();
        });
    }

    // Close modals on overlay click
    elements.addHostModal.addEventListener('click', (e) => {
        if (e.target === elements.addHostModal) hideModal(elements.addHostModal);
    });
    elements.historyModal.addEventListener('click', (e) => {
        if (e.target === elements.historyModal) hideModal(elements.historyModal);
    });

    function closeAllModals() {
        document.querySelectorAll('.modal-overlay.show').forEach(modal => {
            hideModal(modal);
        });
    }

    // Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // ESC to close any open modal
        if (e.key === 'Escape') {
            closeAllModals();
        }

        // ENTER to save/submit in modals
        if (e.key === 'Enter') {
            // Check if any modal is open
            const openModal = document.querySelector('.modal-overlay.show');
            if (openModal) {
                // Ignore if in textarea (allow newlines)
                if (e.target.tagName === 'TEXTAREA') return;

                // Find primary button (Save/Sumit)
                const saveBtn = openModal.querySelector('.btn-primary');
                if (saveBtn && !saveBtn.disabled) {
                    e.preventDefault(); // Prevent default form submission or double actions
                    saveBtn.click();
                }
            }
        }
    });

    // Event listeners - Ticket Host Search
    if (elements.ticketHostSearchInput) {
        elements.ticketHostSearchInput.addEventListener('input', handleTicketHostSearch);
        elements.ticketHostSearchInput.addEventListener('focus', (e) => {
            // If a host is already selected (input has value), show all hosts on focus
            // This allows user to change the selected host
            handleTicketHostSearch(e);
        });
        elements.ticketHostSearchInput.addEventListener('click', (e) => {
            // Always show dropdown on click to allow changing host
            handleTicketHostSearch(e);
        });
    }

    // Event delegation for dropdown item selection using mousedown (fires before blur)
    if (elements.ticketHostSearchResults) {
        elements.ticketHostSearchResults.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevent blur from hiding dropdown before click completes

            const item = e.target.closest('.search-result-item');
            if (item && !item.classList.contains('no-result')) {
                const id = item.dataset.hostId;
                const name = item.dataset.hostName;
                const ip = item.dataset.hostIp;
                if (id && name && ip) {
                    selectTicketHost(id, name, ip);
                }
            }
        });
    }

    // Close search results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#ticketHostSearchContainer') && !e.target.closest('#ticketHostSearchResults')) {
            if (elements.ticketHostSearchResults) {
                elements.ticketHostSearchResults.classList.add('hidden');
            }
        }
    });

    // Theme Toggle
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleTheme);
    }



    // Mobile Hamburger Menu
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const headerActions = document.getElementById('headerActions');

    if (mobileMenuBtn && headerActions) {
        mobileMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            mobileMenuBtn.classList.toggle('active');
            headerActions.classList.toggle('active');
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (headerActions.classList.contains('active') &&
                !headerActions.contains(e.target) &&
                !mobileMenuBtn.contains(e.target)) {
                mobileMenuBtn.classList.remove('active');
                headerActions.classList.remove('active');
            }
        });
    }

}

// Start the app
document.addEventListener('DOMContentLoaded', () => {
    initTheme(); // Initialize theme before app loads to prevent flash
    init();

    // Check for forced password change on load
    checkMustChangePassword();

    // Initialize Audio on first user interaction to bypass Autoplay Block
    document.body.addEventListener('click', initAudio, { once: true });
    document.body.addEventListener('keydown', initAudio, { once: true });

    // Request system notification permission
    requestNotificationPermission();

    // Event listener for save new password button
    if (elements.saveNewPasswordBtn) {
        elements.saveNewPasswordBtn.addEventListener('click', handleSaveNewPassword);
    }

    // ========================================
    // 8 Golden Rules: Keyboard Shortcuts
    // ========================================

    document.addEventListener('keydown', (e) => {
        // ESC - Close any open modal (Rule 6: Easy reversal)
        if (e.key === 'Escape') {
            closeAllModals();
        }

        // Alt+N and / Shortcuts removed by user request (conflicts with browser)
    });

    // Enter key submits forms in modals (Rule 2: Shortcuts)
    document.querySelectorAll('.modal input').forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                // EXCEPTION: Don't auto-submit modal if typing in comment input or search inputs
                if (input.id === 'newCommentInput' ||
                    input.id === 'ticketHostSearchInput' ||
                    input.id === 'editAddressSearchInput' ||
                    input.id === 'addressSearchInput') {
                    return;
                }

                const modal = input.closest('.modal-overlay');
                // Target primary button in footer specifically to avoid inline buttons
                const submitBtn = modal?.querySelector('.modal-footer .btn-primary');
                if (submitBtn && !submitBtn.disabled) {
                    e.preventDefault();
                    e.stopPropagation(); // Stop bubbling to document/global listener
                    submitBtn.click();
                }
            }
        });
    });
});

// Close all open modals
function closeAllModals() {
    document.querySelectorAll('.modal-overlay.show').forEach(modal => {
        hideModal(modal);
    });
}

// ========================================
// 8 Golden Rules: Confirmation Dialogs
// ========================================

// Enhanced delete with confirmation (Rule 4: Closure, Rule 5: Error prevention)
window.confirmDelete = function (message, onConfirm) {
    if (confirm(message || 'Apakah Anda yakin ingin menghapus item ini?')) {
        onConfirm();
    }
};

// Show loading state on button (Rule 3: Informative feedback)
window.setButtonLoading = function (button, isLoading, originalText) {
    if (isLoading) {
        button.disabled = true;
        button.dataset.originalText = button.textContent;
        button.innerHTML = '<span class="loading-spinner"></span> Memproses...';
    } else {
        button.disabled = false;
        button.textContent = originalText || button.dataset.originalText || 'Simpan';
    }
};

// ========================================
// Helper for Chart Tooltips
// ========================================

function showChartTooltip(e, time, latency) {
    let tooltip = document.getElementById('chartTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'chartTooltip';
        tooltip.className = 'chart-tooltip';
        document.body.appendChild(tooltip);
    }

    tooltip.innerHTML = `<div class="tooltip-time">${time}</div><div class="tooltip-val">${latency}</div>`;
    tooltip.style.display = 'block';

    // Safety check for screen edges
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = e.pageX + 10;
    let top = e.pageY + 10;

    if (left + tooltipRect.width > window.innerWidth) {
        left = e.pageX - tooltipRect.width - 10;
    }
    if (top + tooltipRect.height > window.innerHeight) {
        top = e.pageY - tooltipRect.height - 10;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}
window.showChartTooltip = showChartTooltip;

function hideChartTooltip() {
    const tooltip = document.getElementById('chartTooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
    }
}

// ========================================
// Forced Password Change
// ========================================

async function checkMustChangePassword() {
    try {
        const response = await fetch(`${API_BASE}/api/me`);
        if (!response.ok) return;

        const user = await response.json();
        if (user.mustChangePassword) {
            // SECURITY: Redirect to login page - modal there cannot be bypassed
            alert('Anda harus mengganti password terlebih dahulu.');
            window.location.href = 'login.html';
        }
    } catch (error) {
        console.error('Error checking password status:', error);
    }
}

function showForcedChangePasswordModal() {
    if (elements.changePasswordModal) {
        elements.changePasswordModal.classList.add('show');
        // Clear inputs
        if (elements.newPasswordInput) elements.newPasswordInput.value = '';
        if (elements.confirmPasswordInput) elements.confirmPasswordInput.value = '';
    }
}

async function handleSaveNewPassword() {
    const newPassword = elements.newPasswordInput?.value;
    const confirmPassword = elements.confirmPasswordInput?.value;

    if (!newPassword || !confirmPassword) {
        showNotification('Harap isi semua field', 'warning');
        return;
    }

    if (newPassword !== confirmPassword) {
        showNotification('Password baru dan konfirmasi tidak sama', 'warning');
        return;
    }

    // Frontend validation
    if (!isStrongPasswordFrontend(newPassword)) {
        showNotification('Password harus minimal 8 karakter, mengandung huruf besar, huruf kecil, angka, dan simbol', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/change-password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword, confirmPassword })
        });

        const result = await response.json();

        if (!response.ok) {
            showNotification(result.error || 'Gagal mengubah password', 'danger');
            return;
        }

        showNotification('Password berhasil diubah!', 'success');

        // Hide modal and reload to refresh user state
        if (elements.changePasswordModal) {
            elements.changePasswordModal.classList.remove('show');
        }

    } catch (error) {
        console.error('Change password error:', error);
        showNotification('Terjadi kesalahan saat mengubah password', 'danger');
    }
}

// Frontend password strength check (mirrors backend)
// Frontend password strength check (mirrors backend)
function isStrongPassword(password) {
    if (!password || password.length < 8) return false;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    return hasUppercase && hasLowercase && hasDigit && hasSymbol;
}

function getPasswordStrengthError() {
    return 'Password harus memiliki minimal 8 karakter, huruf besar, huruf kecil, angka, dan simbol.';
}
window.hideChartTooltip = hideChartTooltip;

// ========================================
// Footer Copyright - Set Current Year
// ========================================
(function () {
    const yearElement = document.getElementById('currentYear');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }
})();

// ========================================
// Phase 1: Host Groups API Functions
// ========================================

/**
 * Fetch all host groups from the server
 */
async function fetchHostGroups() {
    try {
        const response = await fetch(`${API_BASE}/api/host-groups`, {
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to fetch groups');
        const groups = await response.json();
        cachedHostGroups = groups;
        return groups;
    } catch (error) {
        console.error('Error fetching host groups:', error);
        return [];
    }
}

/**
 * Create a new host group
 */
async function createHostGroup(name, description = '', color = '#6366f1') {
    try {
        const response = await fetch(`${API_BASE}/api/host-groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, description, color })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        showNotification(`Grup "${name}" berhasil dibuat`, 'success');
        await fetchHostGroups();
        updateHostGroupFilter();
        return result;
    } catch (error) {
        showNotification(error.message || 'Gagal membuat grup', 'danger');
        throw error;
    }
}

/**
 * Delete a host group
 */
async function deleteHostGroup(groupId) {
    try {
        const response = await fetch(`${API_BASE}/api/host-groups/${groupId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        showNotification('Grup berhasil dihapus', 'success');
        await fetchHostGroups();
        updateHostGroupFilter();
        return result;
    } catch (error) {
        showNotification(error.message || 'Gagal menghapus grup', 'danger');
        throw error;
    }
}

/**
 * Update host group filter dropdown
 */
function updateHostGroupFilter() {
    const filterSelect = elements.hostGroupFilter;
    if (!filterSelect) return;

    // Preserve current selection
    const currentValue = filterSelect.value;

    // Clear and rebuild options
    filterSelect.innerHTML = '<option value="">Semua Grup</option>';

    cachedHostGroups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        option.style.color = group.color;
        filterSelect.appendChild(option);
    });

    // Restore selection if still valid
    if (currentValue && cachedHostGroups.some(g => g.id === currentValue)) {
        filterSelect.value = currentValue;
    }

    // Also update Add/Edit Host modal group selects
    populateGroupDropdowns();
}

/**
 * Populate Add/Edit Host modal group dropdowns
 */
function populateGroupDropdowns(selectedGroupId = null) {
    const selects = [elements.hostGroupSelect, elements.editHostGroupSelect];

    selects.forEach(select => {
        if (!select) return;

        // Preserve current selection or use provided selectedGroupId
        const currentValue = selectedGroupId !== null ? selectedGroupId : select.value;

        // Clear and rebuild options
        select.innerHTML = '<option value="">-- Tidak Ada Grup --</option>';

        cachedHostGroups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.name;
            option.style.backgroundColor = group.color + '20';
            select.appendChild(option);
        });

        // Restore selection if valid
        if (currentValue && cachedHostGroups.some(g => g.id === currentValue)) {
            select.value = currentValue;
        }
    });
}

/**
 * Filter hosts by group
 */
function filterHostsByGroup() {
    currentGroupFilter = elements.hostGroupFilter?.value || '';
    renderFilteredHosts();
}

// ========================================
// Phase 2: Statistics Functions
// ========================================

/**
 * Load and render statistics when switching to stats tab
 */
async function loadAndRenderStats() {
    if (!elements.statsSection) return;

    try {
        // Fetch all stats data
        const [summaryRes, uptimeRes] = await Promise.all([
            fetch(`${API_BASE}/api/stats/summary`, { credentials: 'include' }),
            fetch(`${API_BASE}/api/stats/uptime?period=24h`, { credentials: 'include' })
        ]);

        if (!summaryRes.ok || !uptimeRes.ok) {
            throw new Error('Failed to fetch statistics');
        }

        const summary = await summaryRes.json();
        const uptime = await uptimeRes.json();

        renderStatsSummary(summary);
        renderUptimeTable(uptime.hosts);

    } catch (error) {
        console.error('Error loading stats:', error);
        showNotification('Gagal memuat statistik', 'danger');
    }
}

/**
 * Render statistics summary cards
 */
function renderStatsSummary(summary) {
    const container = document.getElementById('statsSummaryCards');
    if (!container) return;

    container.innerHTML = `
        <div class="summary-stat-card summary-stat-card-primary">
            <div class="summary-stat-card-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
            </div>
            <div class="summary-stat-card-content">
                <div class="summary-stat-card-value">${summary.overallUptime24h || 'N/A'}%</div>
                <div class="summary-stat-card-label">Uptime 24 Jam</div>
            </div>
        </div>
        <div class="summary-stat-card summary-stat-card-success">
            <div class="summary-stat-card-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                    <line x1="8" y1="21" x2="16" y2="21"/>
                    <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
            </div>
            <div class="summary-stat-card-content">
                <div class="summary-stat-card-value">${summary.onlineCount}/${summary.totalHosts}</div>
                <div class="summary-stat-card-label">Host Online</div>
            </div>
        </div>
        <div class="summary-stat-card summary-stat-card-info">
            <div class="summary-stat-card-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                </svg>
            </div>
            <div class="summary-stat-card-content">
                <div class="summary-stat-card-value">${summary.avgLatency !== null ? summary.avgLatency + 'ms' : 'N/A'}</div>
                <div class="summary-stat-card-label">Latency Rata-rata</div>
            </div>
        </div>
        <div class="summary-stat-card summary-stat-card-warning">
            <div class="summary-stat-card-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
            </div>
            <div class="summary-stat-card-content">
                <div class="summary-stat-card-value">${summary.incidents24h}</div>
                <div class="summary-stat-card-label">Insiden 24 Jam</div>
            </div>
        </div>
    `;
}

/**
 * Render uptime table for all hosts
 */
function renderUptimeTable(hosts) {
    const container = document.getElementById('statsUptimeTable');
    if (!container) return;

    if (!hosts || hosts.length === 0) {
        container.innerHTML = '<p class="text-muted">Belum ada data uptime.</p>';
        return;
    }

    const rows = hosts.map(host => {
        const uptimeValue = host.uptime !== null ? parseFloat(host.uptime) : null;
        let uptimeClass = 'uptime-good';
        if (uptimeValue === null) {
            uptimeClass = 'uptime-unknown';
        } else if (uptimeValue < 95) {
            uptimeClass = 'uptime-bad';
        } else if (uptimeValue < 99) {
            uptimeClass = 'uptime-warning';
        }

        const statusClass = host.status === 'online' ? 'status-online' :
            host.status === 'offline' ? 'status-offline' : 'status-unknown';

        return `
            <tr>
                <td>${host.hostName}</td>
                <td>${host.host}</td>
                <td><span class="status-badge ${statusClass}">${host.status}</span></td>
                <td class="${uptimeClass}">${host.uptime !== null ? host.uptime + '%' : 'N/A'}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="stats-table">
            <thead>
                <tr>
                    <th>Nama Host</th>
                    <th>IP/Hostname</th>
                    <th>Status</th>
                    <th>Uptime 24h</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
}

// ========================================
// Phase 2: Scheduled Maintenance Functions
// ========================================

// Cached maintenance windows
let cachedMaintenanceWindows = [];

/**
 * Fetch maintenance windows from server
 */
async function fetchMaintenanceWindows() {
    try {
        const response = await fetch(`${API_BASE}/api/maintenance`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch maintenance windows');
        cachedMaintenanceWindows = await response.json();
        return cachedMaintenanceWindows;
    } catch (error) {
        console.error('Error fetching maintenance windows:', error);
        return [];
    }
}

/**
 * Create a new maintenance window
 */
async function createMaintenance(data) {
    try {
        const response = await fetch(`${API_BASE}/api/maintenance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to create maintenance');

        showNotification('Jadwal maintenance berhasil dibuat', 'success');
        await fetchMaintenanceWindows();
        renderMaintenanceList();
        return result;
    } catch (error) {
        showNotification(error.message, 'danger');
        throw error;
    }
}

/**
 * Delete a maintenance window
 */
async function deleteMaintenance(id) {
    try {
        const response = await fetch(`${API_BASE}/api/maintenance/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Failed to delete maintenance');

        showNotification('Jadwal maintenance dihapus', 'success');
        await fetchMaintenanceWindows();
        renderMaintenanceList();
    } catch (error) {
        showNotification(error.message, 'danger');
    }
}
// Expose to global scope for inline onclick
window.deleteMaintenance = deleteMaintenance;

/**
 * Check if a host is in maintenance (client-side)
 */
function isHostInMaintenanceClient(hostId) {
    const now = new Date();
    return cachedMaintenanceWindows.find(mw => {
        if (!mw.active) return false;
        const start = new Date(mw.startTime);
        const end = new Date(mw.endTime);
        const isInTimeRange = now >= start && now <= end;
        const isHostIncluded = mw.hostIds.includes(hostId) || mw.hostIds.includes('all');
        return isInTimeRange && isHostIncluded;
    }) || null;
}

/**
 * Render maintenance list in modal
 */
function renderMaintenanceList() {
    const container = elements.maintenanceList;
    if (!container) return;

    // Filter active/future maintenance windows
    const now = new Date();
    const activeWindows = cachedMaintenanceWindows.filter(mw => {
        const end = new Date(mw.endTime);
        return mw.active && end > now;
    });

    if (activeWindows.length === 0) {
        container.innerHTML = '<p class="text-muted">Tidak ada jadwal maintenance aktif.</p>';
        return;
    }

    container.innerHTML = activeWindows.map(mw => {
        const start = new Date(mw.startTime);
        const end = new Date(mw.endTime);
        const hostNames = mw.hostIds.includes('all')
            ? 'Semua Host'
            : mw.hostIds.map(id => cachedHosts.find(h => h.id === id)?.name || id).slice(0, 3).join(', ') +
            (mw.hostIds.length > 3 ? ` +${mw.hostIds.length - 3} lainnya` : '');

        return `
            <div class="maintenance-item">
                <div class="maintenance-info">
                    <div class="maintenance-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                        </svg>
                        ${escapeHtml(mw.reason)}
                    </div>
                    <div class="maintenance-details">
                        <span class="maintenance-hosts">${hostNames}</span>
                        <span class="maintenance-time">${start.toLocaleString()} - ${end.toLocaleString()}</span>
                    </div>
                </div>
                <button class="btn btn-danger btn-sm delete-maintenance-btn" data-id="${mw.id}" title="Hapus Jadwal">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `;
    }).join('');

    // Add event listeners to delete buttons
    container.querySelectorAll('.delete-maintenance-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.dataset.id;
            if (confirm('Hapus jadwal maintenance ini?')) {
                await deleteMaintenance(id);
            }
        });
    });
}

/**
 * Populate host select in maintenance modal
 */
function populateMaintenanceHostSelect() {
    const select = elements.maintenanceHostSelect;
    if (!select) return;

    select.innerHTML = cachedHosts.map(host =>
        `<option value="${host.id}">${escapeHtml(host.name)} (${host.host})</option>`
    ).join('');
}

/**
 * Format date to local datetime-local input format (YYYY-MM-DDTHH:MM)
 */
function formatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Open maintenance modal
 */
function openMaintenanceModal() {
    populateMaintenanceHostSelect();

    // Set default times (now to +2 hours) using local time
    const now = new Date();
    const later = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    elements.maintenanceStartTime.value = formatDateTimeLocal(now);
    elements.maintenanceEndTime.value = formatDateTimeLocal(later);
    elements.maintenanceReason.value = '';
    elements.maintenanceAllHosts.checked = false;
    elements.maintenanceHostSelectGroup.style.display = 'block';

    fetchMaintenanceWindows().then(() => renderMaintenanceList());
    showModal(elements.maintenanceModal);
}

/**
 * Initialize maintenance event handlers
 */
function initMaintenanceEventHandlers() {
    // Maintenance button
    if (elements.maintenanceBtn) {
        elements.maintenanceBtn.addEventListener('click', openMaintenanceModal);
    }

    // Close modal
    if (elements.closeMaintenanceModalBtn) {
        elements.closeMaintenanceModalBtn.addEventListener('click', () => {
            hideModal(elements.maintenanceModal);
        });
    }

    // All hosts checkbox toggle
    if (elements.maintenanceAllHosts) {
        elements.maintenanceAllHosts.addEventListener('change', () => {
            elements.maintenanceHostSelectGroup.style.display =
                elements.maintenanceAllHosts.checked ? 'none' : 'block';
        });
    }

    // Create maintenance button
    if (elements.createMaintenanceBtn) {
        elements.createMaintenanceBtn.addEventListener('click', async () => {
            const allHosts = elements.maintenanceAllHosts.checked;
            const selectedOptions = Array.from(elements.maintenanceHostSelect.selectedOptions);
            const hostIds = selectedOptions.map(opt => opt.value);
            const startTime = elements.maintenanceStartTime.value;
            const endTime = elements.maintenanceEndTime.value;
            const reason = elements.maintenanceReason.value.trim();

            if (!startTime || !endTime) {
                showNotification('Waktu mulai dan selesai harus diisi', 'warning');
                return;
            }

            if (!allHosts && hostIds.length === 0) {
                showNotification('Pilih minimal satu host atau centang "Semua Host"', 'warning');
                return;
            }

            try {
                await createMaintenance({
                    allHosts,
                    hostIds,
                    startTime,
                    endTime,
                    reason: reason || 'Scheduled Maintenance'
                });

                // Reset form
                elements.maintenanceReason.value = '';
                elements.maintenanceHostSelect.selectedIndex = -1;
            } catch (error) {
                // Error already handled in createMaintenance
            }
        });
    }

    console.log('✅ Maintenance event handlers initialized');
}

// ========================================
// Phase 1: Bulk Import/Export Functions
// ========================================

/**
 * Export hosts as JSON file
 */
async function exportHostsJson() {
    try {
        showNotification('Mengeksport hosts...', 'info');
        window.location.href = `${API_BASE}/api/hosts/export`;
    } catch (error) {
        showNotification('Gagal mengeksport hosts', 'danger');
    }
}

/**
 * Export hosts as CSV file
 */
async function exportHostsCsv() {
    try {
        showNotification('Mengeksport hosts ke CSV...', 'info');
        window.location.href = `${API_BASE}/api/hosts/export/csv`;
    } catch (error) {
        showNotification('Gagal mengeksport hosts', 'danger');
    }
}

/**
 * Open import hosts dialog
 */
function openImportHostsDialog() {
    // Create hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,.csv';
    fileInput.style.display = 'none';

    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const isCSV = file.name.endsWith('.csv');

        try {
            showNotification(`Mengimport hosts dari ${file.name}...`, 'info');

            if (isCSV) {
                // CSV upload as FormData
                const formData = new FormData();
                formData.append('file', file);

                const response = await fetch(`${API_BASE}/api/hosts/import/csv`, {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                if (!response.ok) throw new Error(result.error);

                showNotification(result.message, 'success');
            } else {
                // JSON - read and send as JSON body
                const text = await file.text();
                const data = JSON.parse(text);

                // Extract hosts array from export format
                const hosts = Array.isArray(data) ? data : (data.hosts || []);

                const response = await fetch(`${API_BASE}/api/hosts/import`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hosts, skipDuplicates: true })
                });

                const result = await response.json();
                if (!response.ok) throw new Error(result.error);

                showNotification(result.message, 'success');
            }

            // Refresh hosts list
            await refreshData();

        } catch (error) {
            console.error('Import error:', error);
            showNotification(error.message || 'Gagal mengimport hosts', 'danger');
        }

        document.body.removeChild(fileInput);
    };

    document.body.appendChild(fileInput);
    fileInput.click();
}

// ========================================
// Phase 1: Host Actions Dropdown
// ========================================

/**
 * Toggle dropdown menu visibility
 */
function toggleHostActionsDropdown() {
    const menu = elements.hostActionsMenu;
    if (!menu) return;

    menu.classList.toggle('show');
}

/**
 * Close dropdown when clicking outside
 */
function closeDropdownOnOutsideClick(event) {
    if (!event.target.closest('.host-actions-dropdown')) {
        const menu = elements.hostActionsMenu;
        if (menu && menu.classList.contains('show')) {
            menu.classList.remove('show');
        }
    }
}

// ========================================
// Phase 1: Host Groups Management Modal
// ========================================

/**
 * Open host groups management modal
 */
function openManageGroupsModal() {
    // Create modal dynamically
    let modal = document.getElementById('manageGroupsModal');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'manageGroupsModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>Kelola Grup Host</h3>
                    <button class="modal-close" id="closeManageGroupsBtn">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Buat Grup Baru</label>
                        <div class="input-group" style="flex-wrap: wrap; gap: 12px;">
                            <input type="text" id="newGroupNameInput" placeholder="Nama grup..." style="flex: 1; min-width: 200px;">
                            <button class="btn btn-primary btn-sm" id="createGroupBtn">Tambah</button>
                        </div>
                        <div class="color-swatches" id="colorSwatches" style="display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap;">
                            <div class="color-swatch selected" data-color="#7c3aed" style="background: #7c3aed;" title="Purple"></div>
                            <div class="color-swatch" data-color="#3b82f6" style="background: #3b82f6;" title="Blue"></div>
                            <div class="color-swatch" data-color="#10b981" style="background: #10b981;" title="Green"></div>
                            <div class="color-swatch" data-color="#f59e0b" style="background: #f59e0b;" title="Orange"></div>
                            <div class="color-swatch" data-color="#ef4444" style="background: #ef4444;" title="Red"></div>
                            <div class="color-swatch" data-color="#ec4899" style="background: #ec4899;" title="Pink"></div>
                            <div class="color-swatch" data-color="#14b8a6" style="background: #14b8a6;" title="Teal"></div>
                            <div class="color-swatch" data-color="#8b5cf6" style="background: #8b5cf6;" title="Violet"></div>
                            <div class="color-swatch" data-color="#06b6d4" style="background: #06b6d4;" title="Cyan"></div>
                            <div class="color-swatch" data-color="#84cc16" style="background: #84cc16;" title="Lime"></div>
                            <div class="color-swatch" data-color="#f97316" style="background: #f97316;" title="Dark Orange"></div>
                            <div class="color-swatch" data-color="#6366f1" style="background: #6366f1;" title="Indigo"></div>
                        </div>
                        <input type="hidden" id="newGroupColorInput" value="#7c3aed">
                    </div>
                    <div class="groups-list" id="groupsListContainer">
                        <p class="text-muted">Memuat grup...</p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-ghost" id="closeManageGroupsFooterBtn">Tutup</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Color swatch click handler
        modal.querySelectorAll('.color-swatch').forEach(swatch => {
            swatch.onclick = () => {
                modal.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
                swatch.classList.add('selected');
                modal.querySelector('#newGroupColorInput').value = swatch.dataset.color;
            };
        });

        // Add event listeners
        modal.querySelector('#closeManageGroupsBtn').onclick = () => modal.classList.remove('show');
        modal.querySelector('#closeManageGroupsFooterBtn').onclick = () => modal.classList.remove('show');
        modal.querySelector('#createGroupBtn').onclick = async () => {
            const nameInput = modal.querySelector('#newGroupNameInput');
            const colorInput = modal.querySelector('#newGroupColorInput');
            const name = nameInput.value.trim();
            if (name) {
                await createHostGroup(name, '', colorInput.value);
                nameInput.value = '';
                renderGroupsList();
            }
        };

        // Close on overlay click
        modal.onclick = (e) => {
            if (e.target === modal) modal.classList.remove('show');
        };
    }

    // Render groups list
    renderGroupsList();

    // Show modal
    modal.classList.add('show');
}

/**
 * Render groups list in management modal
 */
function renderGroupsList() {
    const container = document.getElementById('groupsListContainer');
    if (!container) return;

    if (cachedHostGroups.length === 0) {
        container.innerHTML = '<p class="text-muted">Belum ada grup. Buat grup baru di atas.</p>';
        return;
    }

    container.innerHTML = cachedHostGroups.map(group => `
        <div class="group-item" data-group-id="${group.id}">
            <span class="group-color" style="background: ${group.color}"></span>
            <span class="group-name">${group.name}</span>
            <span class="group-count">${countHostsInGroup(group.id)} hosts</span>
            <button class="btn btn-icon btn-danger btn-sm delete-group-btn" data-id="${group.id}" title="Hapus Grup">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </div>
    `).join('');

    // Add delete event listeners
    container.querySelectorAll('.delete-group-btn').forEach(btn => {
        btn.onclick = async () => {
            if (confirm('Hapus grup ini? Host tidak akan dihapus.')) {
                await deleteHostGroup(btn.dataset.id);
                renderGroupsList();
            }
        };
    });
}

/**
 * Count hosts in a group
 */
function countHostsInGroup(groupId) {
    return cachedHosts.filter(h => h.groupId === groupId).length;
}

// ========================================
// Phase 1: Audit Logs Functions
// ========================================

/**
 * Fetch audit logs from server
 */
async function fetchAuditLogs(page = 1, limit = 50, filters = {}) {
    try {
        const params = new URLSearchParams({ page, limit, ...filters });
        const response = await fetch(`${API_BASE}/api/audit-logs?${params}`);
        if (!response.ok) throw new Error('Failed to fetch audit logs');
        return await response.json();
    } catch (error) {
        console.error('Error fetching audit logs:', error);
        return { logs: [], total: 0, page: 1, totalPages: 0 };
    }
}

/**
 * Render audit logs section
 */
async function renderAuditLogs() {
    const section = elements.auditSection;
    if (!section) return;

    const data = await fetchAuditLogs();

    section.innerHTML = `
        <div class="section-header">
            <h2>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
                Audit Log
            </h2>
        </div>
        <div class="logs-list audit-logs">
            ${data.logs.length === 0 ?
            '<div class="logs-empty"><p>Belum ada log audit</p></div>' :
            data.logs.map(log => `
                    <div class="log-item audit-log-item">
                        <div class="log-icon" style="background: var(--info-bg); color: var(--info);">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                            </svg>
                        </div>
                        <div class="log-content">
                            <div class="log-header">
                                <span class="log-action">${formatAuditAction(log.action)}</span>
                                <span class="log-time">${formatDateTime(log.timestamp)}</span>
                            </div>
                            <p class="log-details">${log.details}</p>
                            <span class="log-user">oleh ${log.username}</span>
                        </div>
                    </div>
                `).join('')
        }
        </div>
    `;
}

/**
 * Format audit action to display friendly name
 */
function formatAuditAction(action) {
    const actionMap = {
        'login': '🔐 Login',
        'logout': '🚪 Logout',
        'host_add': '➕ Host Ditambah',
        'host_edit': '✏️ Host Diedit',
        'host_delete': '🗑️ Host Dihapus',
        'group_create': '📁 Grup Dibuat',
        'group_update': '📁 Grup Diupdate',
        'group_delete': '📁 Grup Dihapus',
        'ticket_update': '🎫 Tiket Diupdate',
        'hosts_export': '📤 Hosts Dieksport',
        'hosts_export_csv': '📤 Hosts Dieksport (CSV)',
        'hosts_import': '📥 Hosts Diimport',
        'hosts_import_csv': '📥 Hosts Diimport (CSV)'
    };
    return actionMap[action] || action;
}

// ========================================
// Phase 1: Extend renderFilteredHosts for Group Filter
// ========================================

// Store original function reference
const originalRenderFilteredHosts = window.renderFilteredHosts || renderFilteredHosts;

// Override to include group filter
window.renderFilteredHostsWithGroup = function () {
    let filteredHosts = [...cachedHosts];

    // Apply search filter
    if (currentSearchQuery) {
        const query = currentSearchQuery.toLowerCase();
        filteredHosts = filteredHosts.filter(h =>
            h.name?.toLowerCase().includes(query) ||
            h.host?.toLowerCase().includes(query) ||
            h.cid?.toLowerCase().includes(query)
        );
    }

    // Apply status filter
    if (currentStatusFilter !== 'all') {
        filteredHosts = filteredHosts.filter(h => h.status === currentStatusFilter);
    }

    // Apply group filter
    if (currentGroupFilter) {
        filteredHosts = filteredHosts.filter(h => h.groupId === currentGroupFilter);
    }

    // Call original render logic or render directly
    renderHostsGrid(filteredHosts);
};

// ========================================
// Phase 1: Initialize Event Handlers
// ========================================

function initPhase1EventHandlers() {
    // Host Actions Dropdown Toggle
    if (elements.hostActionsBtn) {
        elements.hostActionsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleHostActionsDropdown();
        });
    }

    // Export JSON
    if (elements.exportHostsJsonBtn) {
        elements.exportHostsJsonBtn.addEventListener('click', () => {
            elements.hostActionsMenu?.classList.remove('show');
            exportHostsJson();
        });
    }

    // Export CSV
    if (elements.exportHostsCsvBtn) {
        elements.exportHostsCsvBtn.addEventListener('click', () => {
            elements.hostActionsMenu?.classList.remove('show');
            exportHostsCsv();
        });
    }

    // Import Hosts
    if (elements.importHostsBtn) {
        elements.importHostsBtn.addEventListener('click', () => {
            elements.hostActionsMenu?.classList.remove('show');
            openImportHostsDialog();
        });
    }

    // Manage Groups
    if (elements.manageGroupsBtn) {
        elements.manageGroupsBtn.addEventListener('click', () => {
            elements.hostActionsMenu?.classList.remove('show');
            openManageGroupsModal();
        });
    }

    // Host Group Filter
    if (elements.hostGroupFilter) {
        elements.hostGroupFilter.addEventListener('change', filterHostsByGroup);
    }

    // Close dropdown on outside click
    document.addEventListener('click', closeDropdownOnOutsideClick);

    // Audit Tab
    if (elements.auditTabBtn) {
        elements.auditTabBtn.addEventListener('click', () => {
            // Show audit section
            document.querySelectorAll('.view-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
            elements.auditTabBtn.classList.add('active');

            // Hide other sections
            document.querySelector('.hosts-section')?.classList.add('hidden');
            document.getElementById('mapSection')?.classList.add('hidden');
            document.getElementById('logsSection')?.classList.add('hidden');
            document.getElementById('ticketsSection')?.classList.add('hidden');
            document.getElementById('usersSection')?.classList.add('hidden');

            // Show/create audit section
            let auditSection = elements.auditSection;
            if (!auditSection) {
                auditSection = document.createElement('section');
                auditSection.id = 'auditSection';
                auditSection.className = 'audit-section';
                document.querySelector('.app-container').appendChild(auditSection);
                elements.auditSection = auditSection;
            }
            auditSection.classList.remove('hidden');

            renderAuditLogs();
        });
    }

    // Load host groups on init
    fetchHostGroups().then(() => {
        updateHostGroupFilter();
    });

    console.log('✅ Phase 1 event handlers initialized');
}

// ========================================
// Phase 3: PWA & Push Notification Functions
// ========================================

/**
 * Register service worker for PWA
 */
async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.log('Service workers not supported');
        return null;
    }

    try {
        const registration = await navigator.serviceWorker.register('/service-worker.js');
        console.log('📱 Service Worker registered:', registration.scope);
        swRegistration = registration;

        // Handle updates
        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            console.log('📱 New service worker installing...');

            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    showNotification('Update tersedia! Refresh halaman untuk memperbarui.', 'info');
                }
            });
        });

        return registration;
    } catch (error) {
        console.error('Service Worker registration failed:', error);
        return null;
    }
}

/**
 * Convert URL-safe base64 to Uint8Array for push subscription
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

/**
 * Subscribe to push notifications
 */
async function subscribeToPush() {
    if (!swRegistration) {
        console.log('No service worker registration');
        return false;
    }

    if (!('PushManager' in window)) {
        console.log('Push notifications not supported');
        return false;
    }

    try {
        // Request notification permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('Notification permission denied');
            return false;
        }

        // Get VAPID public key from server
        const response = await fetch(`${API_BASE}/api/push/vapid-public-key`);
        const { publicKey } = await response.json();

        // Subscribe to push
        const subscription = await swRegistration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
        });

        // Send subscription to server
        await fetch(`${API_BASE}/api/push/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(subscription)
        });

        pushSubscription = subscription;
        console.log('📱 Push notification subscription successful');
        showNotification('Push notifications enabled!', 'success');
        return true;
    } catch (error) {
        console.error('Push subscription failed:', error);
        showNotification('Gagal mengaktifkan push notifications', 'danger');
        return false;
    }
}

/**
 * Unsubscribe from push notifications
 */
async function unsubscribeFromPush() {
    if (!pushSubscription) {
        return true;
    }

    try {
        await pushSubscription.unsubscribe();

        await fetch(`${API_BASE}/api/push/unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ endpoint: pushSubscription.endpoint })
        });

        pushSubscription = null;
        console.log('📱 Push notification unsubscribed');
        return true;
    } catch (error) {
        console.error('Unsubscribe failed:', error);
        return false;
    }
}

/**
 * Check current push subscription status
 */
async function checkPushSubscription() {
    if (!swRegistration) return;

    try {
        const subscription = await swRegistration.pushManager.getSubscription();
        pushSubscription = subscription;
        console.log('📱 Push subscription status:', subscription ? 'Active' : 'Not subscribed');
    } catch (error) {
        console.error('Error checking push subscription:', error);
    }
}

/**
 * Update push notification button text/state
 */
function updatePushButton() {
    const btn = document.getElementById('pushNotifBtn');

    if (!btn) return;

    if (pushSubscription) {
        btn.classList.add('btn-success');
        btn.classList.remove('btn-ghost');
        btn.title = 'Push notifications aktif. Klik untuk nonaktifkan.';
    } else {
        btn.classList.remove('btn-success');
        btn.classList.add('btn-ghost');
        btn.title = 'Aktifkan push notifications';
    }
}

/**
 * Toggle push notification subscription
 */
async function togglePushSubscription() {
    const btn = document.getElementById('pushNotifBtn');
    if (btn) btn.disabled = true;

    try {
        if (pushSubscription) {
            // Already subscribed, unsubscribe
            await unsubscribeFromPush();
            showNotification('Push notifications dinonaktifkan', 'info');
        } else {
            // Not subscribed, subscribe
            const success = await subscribeToPush();
            if (!success && Notification.permission === 'denied') {
                showNotification('Izin notifikasi ditolak. Aktifkan di pengaturan browser.', 'warning');
            }
        }
    } finally {
        if (btn) btn.disabled = false;
        updatePushButton();
    }
}

/**
 * Initialize PWA features
 */
async function initPWA() {
    const registration = await registerServiceWorker();
    if (registration) {
        await checkPushSubscription();

        // Auto-subscribe if notification permission already granted
        if (Notification.permission === 'granted' && !pushSubscription) {
            await subscribeToPush();
        }

        updatePushButton();
    }

    // Setup push button event listener
    const pushBtn = document.getElementById('pushNotifBtn');
    if (pushBtn) {
        pushBtn.addEventListener('click', togglePushSubscription);
    }

    console.log('📱 PWA initialized');
}

// Initialize Phase 1 handlers after DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initPhase1EventHandlers();
        initMaintenanceEventHandlers();
        initPWA();
        initApiWebhooksHandlers();
    });
} else {
    initPhase1EventHandlers();
    initMaintenanceEventHandlers();
    initPWA();
    initApiWebhooksHandlers();
}

// ========================================
// Phase 3: API Keys & Webhooks Management
// ========================================

function initApiWebhooksHandlers() {
    // Settings button opens modal
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', openApiWebhooksModal);
    }

    // Close modal
    document.getElementById('closeApiWebhooksModalBtn')?.addEventListener('click', closeApiWebhooksModal);
    document.getElementById('apiWebhooksModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'apiWebhooksModal') closeApiWebhooksModal();
    });

    // Tab switching
    document.querySelectorAll('#apiWebhooksModal .modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#apiWebhooksModal .modal-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('#apiWebhooksModal .modal-tab-content').forEach(c => {
                c.classList.remove('active');
                c.style.display = 'none';
            });
            tab.classList.add('active');
            const tabContent = document.getElementById(tab.dataset.tab);
            if (tabContent) {
                tabContent.classList.add('active');
                tabContent.style.display = 'block';
            }
        });
    });

    // API Key handlers
    document.getElementById('createApiKeyBtn')?.addEventListener('click', showCreateApiKeyForm);
    document.getElementById('cancelCreateApiKeyBtn')?.addEventListener('click', hideCreateApiKeyForm);
    document.getElementById('submitCreateApiKeyBtn')?.addEventListener('click', createApiKey);
    document.getElementById('copyNewKeyBtn')?.addEventListener('click', copyNewKey);
    document.getElementById('closeNewKeyDisplayBtn')?.addEventListener('click', hideNewKeyDisplay);

    // Webhook handlers
    document.getElementById('createWebhookBtn')?.addEventListener('click', showCreateWebhookForm);
    document.getElementById('cancelCreateWebhookBtn')?.addEventListener('click', hideCreateWebhookForm);
    document.getElementById('submitCreateWebhookBtn')?.addEventListener('click', createWebhook);

    // Event delegation for dynamically created API key buttons
    document.getElementById('apiKeysList')?.addEventListener('click', function (e) {
        const btn = e.target.closest('button');
        if (!btn) return;

        const id = btn.dataset.id;
        if (!id) return;

        if (btn.classList.contains('btn-toggle')) {
            toggleApiKey(id);
        } else if (btn.classList.contains('btn-delete')) {
            deleteApiKey(id);
        }
    });

    // Event delegation for dynamically created webhook buttons
    document.getElementById('webhooksList')?.addEventListener('click', function (e) {
        const btn = e.target.closest('button');
        if (!btn) return;

        const id = btn.dataset.id;
        if (!id) return;

        if (btn.classList.contains('btn-test')) {
            testWebhook(id);
        } else if (btn.classList.contains('btn-toggle')) {
            toggleWebhook(id);
        } else if (btn.classList.contains('btn-delete')) {
            deleteWebhook(id);
        }
    });

    // Telegram button handlers
    document.getElementById('testTelegramBtn2')?.addEventListener('click', testTelegramFromModal);
    document.getElementById('saveTelegramBtn2')?.addEventListener('click', saveTelegramFromModal);

    // Enter key handlers for form inputs
    document.getElementById('apiKeyName')?.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            createApiKey();
        }
    });

    document.getElementById('webhookName')?.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            createWebhook();
        }
    });
}

function openApiWebhooksModal() {
    const modal = document.getElementById('apiWebhooksModal');
    if (modal) {
        modal.classList.add('show');
        loadApiKeys();
        loadWebhooks();
        loadTelegramSettings();
    }
}

function closeApiWebhooksModal() {
    const modal = document.getElementById('apiWebhooksModal');
    if (modal) modal.classList.remove('show');
    hideCreateApiKeyForm();
    hideCreateWebhookForm();
    hideNewKeyDisplay();
}

// API Keys functions
async function loadApiKeys() {
    const container = document.getElementById('apiKeysList');
    if (!container) return;

    try {
        const res = await fetch(`${API_BASE}/api/keys`);
        if (!res.ok) throw new Error('Failed to load keys');
        const keys = await res.json();

        if (keys.length === 0) {
            container.innerHTML = '<p class="empty-state">Belum ada API key</p>';
            return;
        }

        container.innerHTML = keys.map(k => `
            <div class="api-item">
                <div class="api-item-info">
                    <strong>${escapeHtml(k.name)}</strong>
                    <code>${k.key}</code>
                    <small>${k.enabled ? '✅ Aktif' : '🔴 Disabled'} · Dibuat ${new Date(k.createdAt).toLocaleDateString()}</small>
                </div>
                <div class="api-item-actions">
                    <button class="btn btn-sm btn-toggle ${k.enabled ? 'btn-warning' : 'btn-success'}" data-id="${k.id}">${k.enabled ? 'Disable' : 'Enable'}</button>
                    <button class="btn btn-sm btn-danger btn-delete" data-id="${k.id}">Hapus</button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Belum ada API keys</p>';
    }
}

function showCreateApiKeyForm() {
    document.getElementById('createApiKeyForm').style.display = 'block';
    document.getElementById('apiKeyName').value = '';
    document.getElementById('apiKeyName').focus();
}

function hideCreateApiKeyForm() {
    document.getElementById('createApiKeyForm').style.display = 'none';
}

function hideNewKeyDisplay() {
    document.getElementById('newKeyDisplay').style.display = 'none';
    document.getElementById('createApiKeyForm').style.display = 'none';
}

async function createApiKey() {
    const name = document.getElementById('apiKeyName').value.trim();
    if (!name) return showNotification('Nama key harus diisi', 'warning');

    try {
        const res = await fetch(`${API_BASE}/api/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (!res.ok) throw new Error('Failed to create key');
        const newKey = await res.json();

        hideCreateApiKeyForm();
        document.getElementById('newKeyValue').textContent = newKey.key;
        document.getElementById('newKeyDisplay').style.display = 'block';
        loadApiKeys();
        showNotification('API key berhasil dibuat!', 'success');
    } catch (err) {
        showNotification('Gagal membuat API key', 'danger');
    }
}

function copyNewKey() {
    const key = document.getElementById('newKeyValue').textContent;
    navigator.clipboard.writeText(key);
    showNotification('Key berhasil dicopy!', 'success');
}

async function toggleApiKey(id) {
    try {
        const res = await fetch(`${API_BASE}/api/keys/${id}/toggle`, { method: 'PUT' });
        if (!res.ok) throw new Error('Failed');
        loadApiKeys();
    } catch (err) {
        showNotification('Gagal mengubah status key', 'danger');
    }
}

async function deleteApiKey(id) {
    if (!confirm('Hapus API key ini?')) return;
    try {
        const res = await fetch(`${API_BASE}/api/keys/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed');
        loadApiKeys();
        showNotification('API key dihapus', 'info');
    } catch (err) {
        showNotification('Gagal menghapus key', 'danger');
    }
}

// Webhooks functions
async function loadWebhooks() {
    const container = document.getElementById('webhooksList');
    if (!container) return;

    try {
        const res = await fetch(`${API_BASE}/api/webhooks`);
        if (!res.ok) throw new Error('Failed');
        const hooks = await res.json();

        if (hooks.length === 0) {
            container.innerHTML = '<p class="empty-state">Belum ada webhook</p>';
            return;
        }

        container.innerHTML = hooks.map(h => `
            <div class="api-item">
                <div class="api-item-info">
                    <strong>${escapeHtml(h.name)}</strong>
                    <code style="font-size:0.7rem;">${escapeHtml(h.url)}</code>
                    <small>${h.enabled ? '✅ Aktif' : '🔴 Disabled'} · Events: ${h.events.join(', ')}</small>
                </div>
                <div class="api-item-actions">
                    <button class="btn btn-sm btn-ghost btn-test" data-id="${h.id}">Test</button>
                    <button class="btn btn-sm btn-toggle ${h.enabled ? 'btn-warning' : 'btn-success'}" data-id="${h.id}">${h.enabled ? 'Disable' : 'Enable'}</button>
                    <button class="btn btn-sm btn-danger btn-delete" data-id="${h.id}">Hapus</button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Belum ada webhooks</p>';
    }
}

function showCreateWebhookForm() {
    document.getElementById('createWebhookForm').style.display = 'block';
    document.getElementById('webhookName').value = '';
    document.getElementById('webhookUrl').value = '';
    document.getElementById('webhookSecret').value = '';
    document.getElementById('webhookEventDown').checked = true;
    document.getElementById('webhookEventUp').checked = true;
}

function hideCreateWebhookForm() {
    document.getElementById('createWebhookForm').style.display = 'none';
}

async function createWebhook() {
    const name = document.getElementById('webhookName').value.trim();
    const url = document.getElementById('webhookUrl').value.trim();
    const secret = document.getElementById('webhookSecret').value.trim();
    const events = [];
    if (document.getElementById('webhookEventDown').checked) events.push('host_down');
    if (document.getElementById('webhookEventUp').checked) events.push('host_up');

    if (!name || !url) return showNotification('Nama dan URL harus diisi', 'warning');

    try {
        const res = await fetch(`${API_BASE}/api/webhooks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, url, secret: secret || null, events })
        });
        if (!res.ok) throw new Error('Failed');
        hideCreateWebhookForm();
        loadWebhooks();
        showNotification('Webhook berhasil ditambahkan!', 'success');
    } catch (err) {
        showNotification('Gagal menambah webhook', 'danger');
    }
}

async function testWebhook(id) {
    try {
        showNotification('Mengirim test webhook...', 'info');
        const res = await fetch(`${API_BASE}/api/webhooks/${id}/test`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showNotification('Test webhook berhasil!', 'success');
        } else {
            showNotification(`Test gagal: ${data.error}`, 'danger');
        }
    } catch (err) {
        showNotification('Gagal mengirim test', 'danger');
    }
}

async function toggleWebhook(id) {
    try {
        const res = await fetch(`${API_BASE}/api/webhooks/${id}/toggle`, { method: 'PUT' });
        if (!res.ok) throw new Error('Failed');
        loadWebhooks();
    } catch (err) {
        showNotification('Gagal mengubah status webhook', 'danger');
    }
}

async function deleteWebhook(id) {
    if (!confirm('Hapus webhook ini?')) return;
    try {
        const res = await fetch(`${API_BASE}/api/webhooks/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed');
        loadWebhooks();
        showNotification('Webhook dihapus', 'info');
    } catch (err) {
        showNotification('Gagal menghapus webhook', 'danger');
    }
}

// Telegram functions for new modal
async function loadTelegramSettings() {
    try {
        const res = await fetch(`${API_BASE}/api/settings`);
        if (res.ok) {
            const data = await res.json();
            if (data.telegram) {
                document.getElementById('tgBotToken').value = data.telegram.botToken || '';
                document.getElementById('tgChatId').value = data.telegram.chatId || '';
            }
        }
    } catch (err) {
        console.error('Error loading telegram settings:', err);
    }
}

async function saveTelegramFromModal() {
    const botToken = document.getElementById('tgBotToken').value.trim();
    const chatId = document.getElementById('tgChatId').value.trim();

    try {
        const res = await fetch(`${API_BASE}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram: { botToken, chatId } })
        });
        if (res.ok) {
            showNotification('Pengaturan Telegram disimpan!', 'success');
        } else {
            showNotification('Gagal menyimpan pengaturan', 'danger');
        }
    } catch (err) {
        showNotification('Error: ' + err.message, 'danger');
    }
}

async function testTelegramFromModal() {
    const botToken = document.getElementById('tgBotToken').value.trim();
    const chatId = document.getElementById('tgChatId').value.trim();

    if (!botToken || !chatId) {
        return showNotification('Isi Bot Token dan Chat ID dulu', 'warning');
    }

    try {
        showNotification('Mengirim pesan test...', 'info');
        const res = await fetch(`${API_BASE}/api/settings/test-telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ botToken, chatId })
        });
        const data = await res.json();
        if (res.ok) {
            showNotification('Pesan test berhasil dikirim!', 'success');
        } else {
            showNotification(`Error: ${data.error || 'Gagal kirim'}`, 'danger');
        }
    } catch (err) {
        showNotification('Error: ' + err.message, 'danger');
    }
}

// Expose function to global window object for onclick handler
window.openApiWebhooksModal = openApiWebhooksModal;
window.closeApiWebhooksModal = closeApiWebhooksModal;
window.toggleApiKey = toggleApiKey;
window.deleteApiKey = deleteApiKey;
window.createApiKey = createApiKey;
window.testWebhook = testWebhook;
window.toggleWebhook = toggleWebhook;
window.deleteWebhook = deleteWebhook;
window.saveTelegramFromModal = saveTelegramFromModal;
window.testTelegramFromModal = testTelegramFromModal;
window.loadTelegramSettings = loadTelegramSettings;

/* ========================================
   SNMP & Traffic Monitoring Functions
   ======================================== */

let trafficChartInstance = null;
let currentTrafficHostId = null;
let trafficUpdateInterval = null;

async function scanInterfaces(hostId, community, version, signal) {
    try {
        const response = await fetch(`${API_BASE}/api/hosts/${hostId}/snmp/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ community, version }),
            signal: signal // Pass abort signal
        });
        if (!response.ok) throw new Error('Scanning failed');
        return await response.json();
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('SNMP scan was aborted');
            return null;
        }
        console.error('Scan error:', error);
        throw error;
    }
}

// Reset SNMP scan state (called when modal closes)
function resetSnmpScanState() {
    // Abort any pending scan request
    if (currentSnmpScanController) {
        currentSnmpScanController.abort();
        currentSnmpScanController = null;
    }

    // Reset scan button state
    const btn = document.getElementById('btnScanInterfaces');
    if (btn) {
        btn.innerHTML = '🔍 Scan';
        btn.disabled = false;
    }
}

async function handleScanInterfaces() {
    const hostId = elements.editHostId.value;
    const community = document.getElementById('editSnmpCommunity').value;
    const version = document.getElementById('editSnmpVersion').value;
    const interfaceSelect = document.getElementById('editSnmpInterface');
    const btn = document.getElementById('btnScanInterfaces');

    if (!hostId) return alert('Host ID missing');

    // Abort any previous scan
    if (currentSnmpScanController) {
        currentSnmpScanController.abort();
    }
    currentSnmpScanController = new AbortController();

    // Loading state
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner"></span> Scanning...';
    btn.disabled = true;

    try {
        const interfaces = await scanInterfaces(hostId, community, version, currentSnmpScanController.signal);

        // Return early if scan was aborted
        if (!interfaces) {
            return;
        }

        // Populate dropdown
        interfaceSelect.innerHTML = '<option value="">-- Pilih Interface --</option>';
        interfaces.forEach(iface => {
            const opt = document.createElement('option');
            opt.value = iface.index; // Use Index
            opt.textContent = `${iface.name} (${iface.description || iface.mac || 'No Desc'})`;
            opt.dataset.name = iface.name;
            interfaceSelect.appendChild(opt);
        });

        showNotification(`Ditemukan ${interfaces.length} interfaces`, 'success');

        // Auto-select first if available
        if (interfaces.length > 0) {
            interfaceSelect.selectedIndex = 1;
            document.getElementById('editSnmpInterfaceName').value = interfaces[0].name;
        }

    } catch (error) {
        showNotification('Gagal scan interfaces: ' + error.message, 'danger');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
        currentSnmpScanController = null;
    }
}

async function openTrafficModal(hostId) {
    const host = cachedHosts.find(h => h.id === hostId);
    if (!host) return;

    currentTrafficHostId = hostId;
    document.getElementById('trafficHostName').textContent = host.name;

    showModal(document.getElementById('trafficModal'));

    // Init chart
    initTrafficChart();

    // Load initial data
    await loadTrafficData();

    // Start auto-refresh (every 30s)
    if (trafficUpdateInterval) clearInterval(trafficUpdateInterval);
    trafficUpdateInterval = setInterval(loadTrafficData, 5000);
}

function closeTrafficModal() {
    hideModal(document.getElementById('trafficModal'));
    if (trafficUpdateInterval) clearInterval(trafficUpdateInterval);
    trafficUpdateInterval = null;
    currentTrafficHostId = null;
}

function initTrafficChart() {
    const ctx = document.getElementById('trafficChart').getContext('2d');

    if (trafficChartInstance) {
        trafficChartInstance.destroy();
    }

    trafficChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Inbound (Mbps)',
                    borderColor: '#10b981', // Success color
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    data: [],
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Outbound (Mbps)',
                    borderColor: '#3b82f6', // Info color
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    data: [],
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: {
                    labels: { color: '#9ca3af' }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return context.dataset.label + ': ' + context.parsed.y + ' Mbps';
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#9ca3af' },
                    grid: { color: '#374151' }
                },
                y: {
                    ticks: { color: '#9ca3af' },
                    grid: { color: '#374151' },
                    beginAtZero: true
                }
            },
            animation: false
        }
    });
}

async function loadTrafficData() {
    if (!currentTrafficHostId) return;

    try {
        // Add cache bust to prevent browser caching
        const response = await fetch(`${API_BASE}/api/hosts/${currentTrafficHostId}/snmp/history?_=${Date.now()}`);
        if (!response.ok) return;

        const data = await response.json();
        // Handle both array (old) and object (new) response formats
        let history = Array.isArray(data) ? data : (data.history || []);

        // Normalize data - handle both old format (inBps in bytes/sec) and new format (traffic_in in Mbps)
        const displayHistory = history.slice(-100).map(h => {
            let traffic_in = h.traffic_in || 0;
            let traffic_out = h.traffic_out || 0;

            // If old format (inBps in bytes per second), convert to Mbps
            // inBps values are typically large numbers like 138577818
            if (h.inBps !== undefined && h.inBps > 0) {
                traffic_in = (h.inBps * 8) / 1000000; // bytes/s * 8 bits / 1M = Mbps
            }
            if (h.outBps !== undefined && h.outBps > 0) {
                traffic_out = (h.outBps * 8) / 1000000;
            }

            return {
                timestamp: h.timestamp,
                traffic_in: traffic_in,
                traffic_out: traffic_out
            };
        });

        if (displayHistory.length) {
            console.log('[DEBUG] Frontend Traffic History:', displayHistory.slice(-3));
        } else {
            console.log('[DEBUG] No traffic history data available yet');
        }

        // Update Chart
        const labels = displayHistory.map(h => new Date(h.timestamp).toLocaleTimeString());

        trafficChartInstance.data.labels = labels;
        trafficChartInstance.data.datasets[0].data = displayHistory.map(h => parseFloat((h.traffic_in || 0).toFixed(2)));
        trafficChartInstance.data.datasets[1].data = displayHistory.map(h => parseFloat((h.traffic_out || 0).toFixed(2)));
        trafficChartInstance.update();

        // Update Current Stats (Last Entry)
        if (history.length > 0) {
            const last = history[history.length - 1];
            // Safe check for elements and handle undefined values
            const inEl = document.querySelector('.traffic-stat .value.in');
            const outEl = document.querySelector('.traffic-stat .value.out');
            const trafficIn = (last.traffic_in !== undefined && last.traffic_in !== null) ? last.traffic_in.toFixed(2) : '0.00';
            const trafficOut = (last.traffic_out !== undefined && last.traffic_out !== null) ? last.traffic_out.toFixed(2) : '0.00';
            if (inEl) inEl.textContent = trafficIn + ' Mbps';
            if (outEl) outEl.textContent = trafficOut + ' Mbps';
        }

    } catch (e) {
        console.error('Error loading traffic data:', e);
    }
}

function initSnmpEventHandlers() {
    console.log('Initialize SNMP Handlers');

    const btnScan = document.getElementById('btnScanInterfaces');
    if (btnScan) {
        btnScan.addEventListener('click', handleScanInterfaces);

        // Update interface name hidden input
        const select = document.getElementById('editSnmpInterface');
        if (select) {
            select.addEventListener('change', (e) => {
                const selectedOpt = select.options[select.selectedIndex];
                const nameInput = document.getElementById('editSnmpInterfaceName');
                if (nameInput) nameInput.value = selectedOpt.textContent;
            });
        }
    }

    // Toggles for visibility
    const addSnmpToggle = document.getElementById('addSnmpEnabled');
    if (addSnmpToggle) {
        addSnmpToggle.addEventListener('change', (e) => {
            document.getElementById('addHostSnmpFields').style.display = e.target.checked ? 'block' : 'none';
        });
    }

    // Add Host SNMP Scan button - shows message since host needs to be saved first
    const btnAddHostScan = document.getElementById('btnAddHostScanInterfaces');
    if (btnAddHostScan) {
        btnAddHostScan.addEventListener('click', () => {
            showNotification('Simpan host terlebih dahulu, kemudian scan interface dari Edit Host', 'warning');
        });
    }

    const editSnmpToggle = document.getElementById('editSnmpEnabled');
    if (editSnmpToggle) {
        editSnmpToggle.addEventListener('change', (e) => {
            document.getElementById('editSnmpFields').style.display = e.target.checked ? 'block' : 'none';
        });
    }

    // Edit Host Modal Close - Reset SNMP scan state
    const closeEditHostBtn = elements.closeEditHostModalBtn;
    if (closeEditHostBtn) {
        closeEditHostBtn.addEventListener('click', resetSnmpScanState);
    }
    const cancelEditHostBtn = elements.cancelEditHostModalBtn;
    if (cancelEditHostBtn) {
        cancelEditHostBtn.addEventListener('click', resetSnmpScanState);
    }

    // Also reset on Edit Host modal overlay click
    const editModalOverlay = elements.editModalGroup;
    if (editModalOverlay) {
        editModalOverlay.addEventListener('click', (e) => {
            if (e.target === editModalOverlay) resetSnmpScanState();
        });
    }

    // Traffic Modal Close
    const closeTrafficBtn = document.getElementById('closeTrafficModalBtn');
    if (closeTrafficBtn) {
        closeTrafficBtn.addEventListener('click', closeTrafficModal);
    }

    // Close on overlay click
    const trafficModal = document.getElementById('trafficModal');
    if (trafficModal) {
        trafficModal.addEventListener('click', (e) => {
            if (e.target === trafficModal) closeTrafficModal();
        });
    }
}

// Auto-init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSnmpEventHandlers);
} else {
    initSnmpEventHandlers();
}

// ========================================
// Alpine.js Integration (Phase 4)
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
    // Sync initial state with Alpine Store
    if (window.Alpine && window.fetchHosts) {
        try {
            const hosts = await fetchHosts();
            if (Alpine.store('app')) {
                Alpine.store('app').setHosts(hosts);
                console.log('✅ Alpine Store synced with initial data');
            }
        } catch (error) {
            console.error('Failed to sync Alpine store:', error);
        }
    }
});
