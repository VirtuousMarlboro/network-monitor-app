// Service Worker for Network Monitor PWA
const CACHE_NAME = 'netmonitor-v2'; // Updated version to force refresh
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/login.html',
    '/styles.css',
    '/app.js',
    '/logo.png',
    '/manifest.json'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting()) // Force activate immediately
    );
});

// Activate event - clean up old caches and take control immediately
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => {
            console.log('[SW] Taking control of all clients');
            return self.clients.claim(); // Take control immediately
        })
    );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests and API calls
    if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Clone the response and cache it
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return response;
            })
            .catch(() => {
                // Fallback to cache
                return caches.match(event.request);
            })
    );
});

// Push notification event - MUST show notification or browser may throttle
self.addEventListener('push', (event) => {
    console.log('[SW] Push notification received at:', new Date().toISOString());

    let data = {
        title: 'Network Monitor',
        body: 'Notifikasi baru',
        icon: '/logo.png',
        badge: '/logo.png',
        tag: 'netmonitor-notification',
        requireInteraction: true,
        silent: false // Make sure to play sound
    };

    if (event.data) {
        try {
            const payload = event.data.json();
            data = { ...data, ...payload };
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: data.icon || '/logo.png',
        badge: data.badge || '/logo.png',
        tag: data.tag || 'netmonitor-notification',
        requireInteraction: true, // Keep notification visible until user interacts
        silent: false, // Play sound
        renotify: true, // Always notify even if same tag
        vibrate: [200, 100, 200, 100, 200],
        data: {
            url: data.url || '/',
            timestamp: Date.now()
        },
        // iOS needs these for better display
        image: undefined, // Can add image if needed
        actions: [
            { action: 'open', title: '📱 Buka' },
            { action: 'close', title: '❌ Tutup' }
        ]
    };

    // IMPORTANT: Must use waitUntil to ensure notification is shown
    event.waitUntil(
        self.registration.showNotification(data.title, options)
            .then(() => console.log('[SW] Notification shown successfully'))
            .catch((err) => console.error('[SW] Failed to show notification:', err))
    );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked:', event.action);
    event.notification.close();

    if (event.action === 'close') {
        return;
    }

    // Open or focus the app
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // Check if app is already open
                for (const client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Open new window
                if (clients.openWindow) {
                    return clients.openWindow(event.notification.data?.url || '/');
                }
            })
    );
});

// Notification close event
self.addEventListener('notificationclose', (event) => {
    console.log('[SW] Notification closed');
});

// Message event - for communication with main app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
