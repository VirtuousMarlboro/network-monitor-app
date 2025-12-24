// Service Worker for Network Monitor PWA
const CACHE_NAME = 'netmonitor-v4'; // Fixed external CDN handling for map resources
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
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Skip API calls - let them go directly to network
    if (event.request.url.includes('/api/')) {
        return;
    }

    // Skip external CDN resources - let browser handle directly
    // These resources have their own caching and CORS handling
    const externalDomains = [
        'unpkg.com',
        'cdn.jsdelivr.net',
        'fonts.googleapis.com',
        'fonts.gstatic.com',
        'tile.openstreetmap.org',
        'nominatim.openstreetmap.org'
    ];

    if (externalDomains.some(domain => url.hostname.includes(domain))) {
        // Don't intercept - let browser fetch directly
        return;
    }

    // Only cache same-origin requests
    if (url.origin !== self.location.origin) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Only cache valid responses
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }
                // Clone the response and cache it
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return response;
            })
            .catch(() => {
                // Fallback to cache, return a proper Response if not found
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // If it's a navigation request and not found, try returning index.html
                    if (event.request.mode === 'navigate') {
                        return caches.match('/index.html');
                    }
                    // Return empty response for missing resources instead of undefined
                    return new Response('', { status: 404, statusText: 'Not Found' });
                });
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
        tag: 'netmonitor-notification'
    };

    if (event.data) {
        try {
            const payload = event.data.json();
            data = { ...data, ...payload };
        } catch (e) {
            data.body = event.data.text();
        }
    }

    // iOS Safari has limited notification support
    // Only use options that are universally supported
    const options = {
        body: data.body,
        icon: data.icon || '/logo.png',
        badge: data.badge || '/logo.png',
        tag: data.tag || 'netmonitor-notification',
        data: {
            url: data.url || '/',
            timestamp: Date.now()
        }
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
