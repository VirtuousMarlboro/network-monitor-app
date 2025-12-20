# 🌐 Network Monitor Pro

Aplikasi monitoring jaringan enterprise-grade berbasis web untuk memantau konektivitas, traffic SNMP, dan manajemen tiket insiden secara real-time.

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![Express](https://img.shields.io/badge/Express-4.18-blue) ![SQLite](https://img.shields.io/badge/SQLite-3-003B57) ![Alpine.js](https://img.shields.io/badge/Alpine.js-3.x-8BC0D0) ![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Fitur Utama

### 🖥️ Monitoring
- **Real-time Status** - Pemantauan status host (Online/Offline) dengan latency.
- **SNMP Traffic** - Monitoring traffic interface bandwidth via SNMP (v2c).
- **Interactive Maps** - Visualisasi lokasi host dengan Leaflet.js map.
- **Traffic Graphs** - Grafik traffic in/out real-time.

### 🎫 Tiketing & Insiden
- **Manajemen Tiket** - Buat, update, dan lacak tiket insiden.
- **Auto-Ticket** - Pembuatan tiket otomatis saat host down (configurable).
- **Komentar & Lampiran** - Diskusi dan upload bukti pada tiket.

### 🛡️ Keamanan & Manajemen
- **User Management** - Role-based access control (Admin/User).
- **Host Groups** - Pengelompokan host untuk manajemen lebih mudah.
- **WAF (Web Application Firewall)** - Proteksi built-in terhadap SQLi, XSS, dan serangan umum.
- **Audit Logs** - Pencatatan aktivitas user lengkap.

### ⚙️ Teknis
- **SQLite Persistence** - Data tersimpan aman di database SQLite (ACID compliant).
- **JSON Backup** - Backup otomatis data penting ke format JSON.
- **Modular Architecture** - Kode backend terstruktur (Routes/Services/Middleware).
- **Secure Sessions** - Manajemen sesi persisten dan aman.

## 🚀 Cara Menjalankan

### Prasyarat
- Node.js 18 (LTS) atau lebih baru
- npm

### Instalasi

1. **Clone repository:**
   ```bash
   git clone https://github.com/user/network-monitor-app.git
   cd network-monitor-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```
   *Note: Proses ini akan meng-compile `better-sqlite3`, pastikan build tools tersedia jika diperlukan.*

3. **Setup Environment (Opsional):**
   Buat file `.env` jika ingin mengubah konfigurasi default:
   ```env
   PORT=3000
   SESSION_SECRET=rahasia_super_panjang_minimal_32_karakter
   NODE_ENV=development
   ```

4. **Jalankan Aplikasi:**
   ```bash
   npm start
   ```

5. **Akses Dashboard:**
   Buka browser dan akses: `http://localhost:3000`

   **Login Default:**
   - Username: `admin`
   - Password: `ChangeThisStrongPassword123!` (Segera ganti password setelah login!)

## 📁 Struktur Project

```
network-monitor-app/
├── config/              # Konfigurasi sistem (constants.js)
├── data/                # Database SQLite & JSON backups
├── middleware/          # Express middleware (auth, WAF)
├── public/              # Frontend static files (HTML, CSS, JS)
├── routes/              # API Routes (Modular)
├── services/            # Business Logic (DB, SNMP, Backup)
├── server.js            # Entry point aplikasi
└── README.md            # Dokumentasi ini
```

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** SQLite (better-sqlite3)
- **Frontend:** HTML5, CSS3, Alpine.js (Reactivity), Chart.js (Grafik), Leaflet (Peta)
- **Security:** Helmet, Express-Rate-Limit, Custom WAF, BCrypt

## 📝 Catatan Data
Data aplikasi tersimpan di folder `data/`:
- `network_monitor.db` - Database utama SQLite
- `sessions.db` - Session store
- `*.json` - File backup data

## 📄 Lisensi
MIT License
