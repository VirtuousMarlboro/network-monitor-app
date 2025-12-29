# Network Monitor - Architecture & Refactoring Guide

## Current Architecture Overview

### Backend (server.js - 3,300+ lines)
The backend is already **partially modular** with routes extracted:

```
server.js (main)
├── routes/
│   ├── authRoutes.js      - Login, logout, session
│   ├── userRoutes.js      - User CRUD
│   ├── hostRoutes.js      - Host management
│   ├── ticketRoutes.js    - Ticket system
│   ├── snmpRoutes.js      - SNMP traffic history
│   └── settingsRoutes.js  - App settings
├── services/
│   ├── databaseService.js - SQLite operations
│   ├── snmpService.js     - SNMP polling
│   ├── backupService.js   - Data backups
│   └── wafService.js      - Web Application Firewall
└── middleware/
    └── auth.js            - Authentication middleware
```

**Functions still in server.js:**
- Ping functions (singlePing, pingHost, autoPingAllHosts)
- Telegram notification service
- Push notification functions
- SSE broadcasting
- Maintenance window logic
- Ticket auto-creation logic

### Frontend (app.js - 6,500+ lines)
Already has **partial modularization** in `js/` folder:

```
public/
├── app.js           - Main application (LARGE)
├── js/
│   ├── alpine.min.js
│   ├── store.js     - Alpine.js global store
│   ├── floating-windows.js - Ping/traceroute windows
│   └── components/
│       ├── stats-dashboard.js
│       ├── host-card.js
│       └── traffic-chart.js
└── index.html
```

---

## Recommended Refactoring (Future Work)

### Phase 1: Extract Ping Service (Backend)

Create `services/pingService.js`:
```javascript
// Extract from server.js:
// - singlePing()
// - pingHost()
// - autoPingAllHosts()
// - PING_ATTEMPTS, PROBE_TIMEOUT, PROBE_DOWN_COUNT constants
```

### Phase 2: Extract Notification Service (Backend)

Create `services/notificationService.js`:
```javascript
// Extract from server.js:
// - telegramService (queue, rate limiting)
// - sendTelegramNotification()
// - sendPushNotificationToAll()
// - sendWebhookEvent()
```

### Phase 3: Split app.js (Frontend)

Create separate modules:
- `js/modules/hosts.js` - Host CRUD, rendering
- `js/modules/map.js` - Leaflet map functions
- `js/modules/logs.js` - Log display, filtering
- `js/modules/tickets.js` - Ticket management
- `js/modules/auth.js` - Login, profile
- `js/modules/notifications.js` - Push, sounds

---

## Redis Caching (For Multi-Instance Scaling)

### Current Limitations
- SQLite only supports single-writer (no concurrent writes)
- Session store is SQLite (single-server)
- Ping history in memory (per-process)

### Redis Migration Plan
```javascript
// 1. Session Store
// Replace: better-sqlite3-session-store
// With: connect-redis

// 2. Ping History Cache
// Store in Redis instead of memory:
redis.hset('ping:host-id', timestamp, JSON.stringify(result));

// 3. SSE Pub/Sub
// Use Redis Pub/Sub for multi-instance SSE:
const subscriber = redis.duplicate();
subscriber.subscribe('network-monitor-events');
```

### Required Changes for Redis
1. `npm install ioredis connect-redis`
2. Add `REDIS_URL` to `.env`
3. Create `services/cacheService.js`
4. Update session configuration
5. Modify ping history storage
6. Implement Redis Pub/Sub for SSE

---

## Test Coverage Recommendations

Before any major refactoring:
1. Add integration tests for ping monitoring
2. Add E2E tests for critical flows
3. Achieve 70%+ code coverage

Current test coverage: ~40% (routes and services only)
