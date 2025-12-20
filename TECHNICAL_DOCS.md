# 📚 Dokumentasi Teknis - Network Monitor Pro

## Daftar Isi
1. [Arsitektur Sistem](#arsitektur-sistem)
2. [Database Schema](#database-schema)
3. [API Reference](#api-reference)
4. [Service Worker & PWA](#service-worker--pwa)
5. [Security Implementation](#security-implementation)
6. [Deployment Guide](#deployment-guide)

---

## Arsitektur Sistem

### Overview
```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Browser   │  │     PWA     │  │   Mobile (Safari)   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │                │                    │
          ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Layer (Express.js)                  │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────┐  │
│  │  Routes   │  │Middleware │  │    WAF    │  │  Session │  │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └────┬─────┘  │
└────────┼──────────────┼──────────────┼─────────────┼────────┘
         │              │              │             │
         ▼              ▼              ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│                      Service Layer                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │  Database  │  │    SNMP    │  │   Backup   │             │
│  │  Service   │  │  Service   │  │  Service   │             │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘             │
└────────┼───────────────┼───────────────┼────────────────────┘
         │               │               │
         ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│                      Data Layer                              │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐   │
│  │ SQLite (Main)  │  │ SQLite (Session)│  │ JSON Backup  │   │
│  └────────────────┘  └────────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Komponen Utama

| Komponen | File | Deskripsi |
|----------|------|-----------|
| Entry Point | `server.js` | Express server, routing, SSE, monitoring loop |
| Database | `services/databaseService.js` | SQLite operations, CRUD |
| SNMP | `services/snmpService.js` | SNMP v2c traffic monitoring |
| Backup | `services/backupService.js` | JSON backup automation |
| Auth | `middleware/auth.js` | Session & role verification |
| Routes | `routes/*.js` | Modular API endpoints |

---

## Database Schema

### Tabel: `hosts`
```sql
CREATE TABLE hosts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    cid TEXT,
    group_id TEXT,
    latitude REAL,
    longitude REAL,
    snmp_enabled INTEGER DEFAULT 0,
    snmp_community TEXT,
    snmp_interface_index INTEGER,
    created_at INTEGER,
    FOREIGN KEY (group_id) REFERENCES host_groups(id)
);
```

### Tabel: `tickets`
```sql
CREATE TABLE tickets (
    id TEXT PRIMARY KEY,
    host_id TEXT,
    cid TEXT,
    source TEXT,              -- 'manual' | 'auto'
    status TEXT DEFAULT 'open', -- 'open' | 'pending' | 'in_progress' | 'resolved'
    priority TEXT DEFAULT 'medium',
    description TEXT,
    resolution TEXT,
    pic TEXT,
    submitter TEXT,
    created_at INTEGER,
    first_response_at INTEGER,
    resolved_at INTEGER,
    created_by TEXT,
    FOREIGN KEY (host_id) REFERENCES hosts(id)
);
```

### Tabel: `users`
```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,    -- BCrypt hashed
    name TEXT,
    role TEXT DEFAULT 'user', -- 'admin' | 'user'
    created_at INTEGER
);
```

### Tabel: `audit_logs`
```sql
CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    username TEXT,
    action TEXT,
    details TEXT,
    metadata TEXT,            -- JSON string
    ip_address TEXT,
    user_agent TEXT,
    created_at INTEGER
);
```

---

## API Reference

### Authentication
Semua endpoint (kecuali `/api/auth/*`) memerlukan session cookie valid.

### Host Management

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| GET | `/api/hosts` | - | `[{id, name, host, status, latency, ...}]` |
| POST | `/api/hosts` | `{name, host, cid?, groupId?}` | `{id, name, host, ...}` |
| PUT | `/api/hosts/:id` | `{name?, host?, cid?}` | `{id, ...}` |
| DELETE | `/api/hosts/:id` | - | `{message}` |

### Ticket Management

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| GET | `/api/tickets` | - | `[{id, ticketId, status, ...}]` |
| POST | `/api/tickets` | `{hostId?, description, priority?}` | `{id, ticketId, ...}` |
| PUT | `/api/tickets/:id` | `{status?, priority?, description?}` | `{id, ...}` |
| DELETE | `/api/tickets/:id` | - | `{message}` |
| POST | `/api/tickets/:id/comments` | `{text}` + file | `{id, text, author}` |

### Network Tools

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/ping-stream` | `{host}` | Streaming text (chunked) |
| POST | `/api/traceroute` | `{host}` | Streaming text (chunked) |

### Push Notifications

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| GET | `/api/push/vapid-public-key` | - | `{publicKey}` |
| POST | `/api/push/subscribe` | PushSubscription object | `{success}` |
| POST | `/api/push/unsubscribe` | `{endpoint}` | `{success}` |

### Server-Sent Events

```javascript
// Connect ke SSE
const eventSource = new EventSource('/api/events');

// Events yang tersedia:
eventSource.addEventListener('hosts-update', (e) => { /* host status */ });
eventSource.addEventListener('alerts', (e) => { /* up/down alerts */ });
eventSource.addEventListener('ticket-created', (e) => { /* new ticket */ });
eventSource.addEventListener('ticket-updated', (e) => { /* ticket change */ });
```

---

## Service Worker & PWA

### Registration
```javascript
// Di app.js
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
        .then(reg => swRegistration = reg);
}
```

### Push Notification Flow
```
1. User clicks "Enable Push"
2. Frontend requests Notification permission
3. Frontend gets VAPID public key from server
4. Frontend subscribes via pushManager.subscribe()
5. Frontend sends subscription to /api/push/subscribe
6. Server stores subscription
7. When event occurs, server calls webpush.sendNotification()
8. Service worker receives 'push' event
9. Service worker calls showNotification()
```

### iOS-Specific Notes
- Hanya berfungsi saat PWA di-install ke Home Screen
- Memerlukan iOS 16.4+
- Tidak mendukung: `actions`, `vibrate`, `renotify`, `requireInteraction`

---

## Security Implementation

### Middleware Stack
```javascript
app.use(helmet());           // Security headers
app.use(waf);                // Custom WAF
app.use(rateLimiter);        // Rate limiting
app.use(session({...}));     // Session management
```

### WAF Protection
- SQL Injection detection
- XSS pattern blocking
- Command injection prevention
- Path traversal blocking

### Password Security
```javascript
// Hashing
const hash = bcrypt.hashSync(password, 12);

// Verification
const valid = bcrypt.compareSync(input, hash);
```

### Session Configuration
```javascript
session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new SQLiteStore({ db: 'sessions.db' }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
})
```

---

## Deployment Guide

### Production Checklist
- [ ] Set `NODE_ENV=production`
- [ ] Generate strong `SESSION_SECRET` (32+ chars)
- [ ] Configure HTTPS (required for Push)
- [ ] Set up reverse proxy (nginx/Apache)
- [ ] Configure firewall
- [ ] Set up monitoring/alerting
- [ ] Configure backup schedule

### PM2 Deployment
```bash
# Install PM2
npm install -g pm2

# Start app
pm2 start server.js --name "network-monitor"

# Enable startup
pm2 startup
pm2 save

# Monitor
pm2 logs network-monitor
```

### Nginx Reverse Proxy
```nginx
server {
    listen 443 ssl http2;
    server_name monitor.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # SSE support
    location /api/events {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }
}
```

### Backup Strategy
```bash
# Cron job untuk backup harian
0 2 * * * tar -czf /backup/netmon-$(date +%Y%m%d).tar.gz /app/data/
```

---

### Database Locked Error
```bash
# Stop aplikasi
pm2 stop network-monitor

# Check connections
fuser data/network_monitor.db

# Restart
pm2 start network-monitor
```

### Ping/Traceroute Tidak Berhenti
- Pastikan `taskkill` tersedia di Windows
- Cek log untuk error "taskkill error"

---

**Versi Dokumen:** 1.0  
**Terakhir Diperbarui:** Desember 2024
