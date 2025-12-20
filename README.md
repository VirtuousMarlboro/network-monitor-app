# 🌐 Network Monitor Pro

Aplikasi monitoring jaringan enterprise-grade berbasis web untuk memantau konektivitas, traffic SNMP, dan manajemen tiket insiden secara real-time.

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![Express](https://img.shields.io/badge/Express-4.18-blue) ![SQLite](https://img.shields.io/badge/SQLite-3-003B57) ![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8) ![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Fitur Utama

### 🖥️ Monitoring
- **Real-time Status** - Pemantauan status host (Online/Offline) dengan latency
- **Continuous Ping** - Ping terus-menerus (seperti `ping -t`) dengan auto-scroll
- **Traceroute** - Trace route ke host dengan output streaming
- **SNMP Traffic** - Monitoring traffic interface bandwidth via SNMP (v2c)
- **Interactive Maps** - Visualisasi lokasi host dengan Leaflet.js
- **Traffic Graphs** - Grafik traffic in/out real-time

### 🎫 Tiketing & Insiden
- **Manajemen Tiket** - Buat, update, dan lacak tiket insiden
- **Status Tiket** - Open, Pending, In Progress, Resolved
- **Auto-Ticket** - Pembuatan tiket otomatis saat host down > 2 menit
- **Komentar & Lampiran** - Diskusi dan upload bukti pada tiket
- **First Response Time** - Tracking waktu respons pertama

### 🔔 Notifikasi
- **Push Notifications** - Web Push untuk desktop dan mobile (PWA)
- **Telegram Bot** - Notifikasi via Telegram dengan rate limiting
- **Webhooks** - Integrasi dengan sistem eksternal
- **Sound Alerts** - Audio feedback untuk host up/down

### 🛡️ Keamanan & Manajemen
- **User Management** - Role-based access control (Admin/User)
- **Host Groups** - Pengelompokan host untuk manajemen lebih mudah
- **Maintenance Mode** - Jadwal maintenance untuk mute notifikasi
- **WAF** - Proteksi terhadap SQLi, XSS, dan serangan umum
- **Audit Logs** - Pencatatan aktivitas user lengkap
- **Rate Limiting** - Proteksi API dari abuse

### ⚙️ Teknis
- **PWA Ready** - Installable sebagai aplikasi mobile/desktop
- **SQLite Database** - Data tersimpan aman (ACID compliant)
- **JSON Backup** - Backup otomatis data penting
- **Modular Architecture** - Routes/Services/Middleware terpisah
- **SSE Real-time** - Server-Sent Events untuk update live

## 🚀 Instalasi

### Prasyarat
- Node.js 18 LTS atau lebih baru
- npm atau yarn
- Build tools untuk `better-sqlite3` (opsional, otomatis terinstall)

### Langkah Instalasi

```bash
# 1. Clone repository
git clone https://github.com/user/network-monitor-app.git
cd network-monitor-app

# 2. Install dependencies
npm install

# 3. Jalankan aplikasi
npm start

# 4. Akses di browser
# http://localhost:3000
```

### Login Default
- **Username:** `admin`
- **Password:** `ChangeThisStrongPassword123!`

> ⚠️ **PENTING:** Segera ganti password default setelah login pertama!

## ⚙️ Konfigurasi

Buat file `.env` untuk konfigurasi:

```env
# Server
PORT=3000
NODE_ENV=production

# Security
SESSION_SECRET=rahasia_super_panjang_minimal_32_karakter

# Telegram (Opsional)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

## 📁 Struktur Project

```
network-monitor-app/
├── config/              # Konstanta dan konfigurasi
├── data/                # Database & JSON (JANGAN DIHAPUS!)
│   ├── network_monitor.db
│   ├── sessions.db
│   └── *.json
├── middleware/          # Express middleware (auth, WAF)
├── public/              # Frontend (HTML, CSS, JS)
│   ├── index.html
│   ├── login.html
│   ├── app.js
│   ├── styles.css
│   └── service-worker.js
├── routes/              # API Routes modular
├── services/            # Business logic
│   ├── databaseService.js
│   ├── snmpService.js
│   └── backupService.js
├── uploads/             # File uploads
├── server.js            # Entry point
└── package.json
```

## 🔒 Data yang Tidak Boleh Dihapus

Saat update aplikasi, **JANGAN menimpa folder berikut:**
- `data/` - Database dan konfigurasi
- `uploads/` - File attachment tiket

## 🛠️ Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Backend | Node.js, Express.js |
| Database | SQLite (better-sqlite3) |
| Frontend | HTML5, CSS3, Vanilla JS |
| Reactivity | Alpine.js |
| Charts | Chart.js |
| Maps | Leaflet.js |
| Security | Helmet, BCrypt, Rate Limiter |
| Push | Web Push API, VAPID |

## 📝 API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/hosts` | Daftar semua host |
| POST | `/api/hosts` | Tambah host baru |
| GET | `/api/tickets` | Daftar tiket |
| POST | `/api/tickets` | Buat tiket baru |
| POST | `/api/ping-stream` | Continuous ping |
| POST | `/api/traceroute` | Traceroute |
| GET | `/api/events` | SSE stream |

## 📄 Lisensi

MIT License - Bebas digunakan untuk keperluan pribadi maupun komersial.

---

**Dibuat dengan ❤️ untuk memudahkan monitoring jaringan**
