# 🌐 Network Monitor

Aplikasi web untuk memantau konektivitas jaringan berdasarkan ping ke IP address atau hostname.

![Network Monitor](https://img.shields.io/badge/Node.js-18+-green) ![Express](https://img.shields.io/badge/Express-4.18-blue) ![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Fitur

- **Quick Ping** - Ping cepat ke IP/hostname tanpa menyimpan
- **Manajemen Host** - Tambah, hapus, dan kelola host yang dipantau
- **Status Real-time** - Lihat status online/offline dan latency
- **Riwayat Ping** - Lihat history ping dengan grafik visual
- **Auto Refresh** - Refresh otomatis setiap 30 detik
- **UI Modern** - Tampilan modern dark theme dengan animasi halus

## 🚀 Cara Menjalankan

### Prasyarat
- Node.js 18 atau lebih baru
- npm

### Instalasi

1. Masuk ke direktori proyek:
```bash
cd network-monitor-app
```

2. Install dependencies:
```bash
npm install
```

3. Jalankan server:
```bash
npm start
```

4. Buka browser dan akses:
```
http://localhost:3000
```

## 📖 Penggunaan

### Quick Ping
1. Masukkan IP atau hostname di kolom Quick Ping
2. Klik tombol "Ping"
3. Hasil akan ditampilkan (online/offline dan latency)

### Menambah Host untuk Dipantau
1. Klik tombol "Tambah Host"
2. Masukkan IP Address atau Hostname
3. Masukkan nama (opsional) untuk identifikasi
4. Klik "Simpan"

### Memantau Host
- Klik tombol "Ping" pada kartu host untuk ping manual
- Klik tombol "History" untuk melihat riwayat ping
- Aktifkan "Auto Refresh" untuk ping otomatis setiap 30 detik
- Klik "Ping Semua" untuk ping semua host sekaligus

### Menghapus Host
- Klik ikon tempat sampah pada kartu host
- Konfirmasi penghapusan

## 🛠️ API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/hosts` | Mendapatkan semua host |
| POST | `/api/hosts` | Menambah host baru |
| DELETE | `/api/hosts/:id` | Menghapus host |
| POST | `/api/ping/:id` | Ping host tertentu |
| POST | `/api/ping-all` | Ping semua host |
| GET | `/api/history/:id` | Mendapatkan riwayat ping |
| POST | `/api/quick-ping` | Quick ping tanpa menyimpan |

## 📁 Struktur File

```
network-monitor-app/
├── server.js        # Backend Express server
├── package.json     # Dependencies
├── README.md        # Dokumentasi
└── public/          # Frontend files
    ├── index.html   # Halaman utama
    ├── styles.css   # Styling
    └── app.js       # JavaScript frontend
```

## 🔧 Konfigurasi

- **Port**: Default 3000, bisa diubah via environment variable `PORT`
  ```bash
  PORT=8080 npm start
  ```

## 📝 Catatan

- Data disimpan di memory (akan hilang jika server restart)
- Untuk produksi, pertimbangkan menggunakan database seperti SQLite atau MongoDB
- Ping memerlukan akses jaringan yang sesuai

## 📄 Lisensi

MIT License
