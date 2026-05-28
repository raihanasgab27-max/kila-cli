# Dokumentasi Kila CLI (Remote AI Bridge)

Proyek ini adalah asisten koding AI yang berjalan secara remote (di VPS) namun memiliki kemampuan untuk mengelola file dan menjalankan perintah di komputer lokal (PC) Anda.

## Arsitektur

Arsitektur sistem ini terbagi menjadi dua bagian utama:
1. **Client (PC Lokal)**: Menjalankan antarmuka CLI dan mengeksekusi instruksi file system/shell.
2. **Server (VPS)**: Menjalankan "otak" AI menggunakan Ollama dan mengeksekusi instruksi yang membutuhkan internet kencang/bebas blokir.

### Lokasi Eksekusi Tool

| Tool | Lokasi Eksekusi | Deskripsi |
| :--- | :--- | :--- |
| `read_file` | PC Lokal | Membaca file di harddisk kamu. |
| `write_file` | PC Lokal | Membuat/mengedit file di PC kamu. |
| `list_files` | PC Lokal | Melihat daftar file di folder kamu. |
| `delete_file` | PC Lokal | Menghapus file di PC kamu. |
| `run_command` | PC Lokal | Menjalankan perintah terminal (npm, git, dll). |
| `web_search` | **VPS** | Mencari informasi di Google/DuckDuckGo menggunakan internet VPS. |

## Cara Penggunaan

### 1. Menjalankan Server (di VPS)
Pastikan Ollama sudah terinstall dan model sudah di-download.
```bash
# Di VPS
npm install
npm run server
```

### 2. Menjalankan Client (di PC Lokal)
Gunakan URL Cloudflare Tunnel atau IP VPS kamu.
```bash
# Di PC Lokal
npm run build
kila-ai -u https://url-vps-kamu.com
```

## Keunggulan Web Search di VPS
- **Bypass Blokir**: Menghindari pemblokiran situs oleh ISP lokal (Internet Positif, dll).
- **Kecepatan**: Menggunakan bandwidth VPS yang biasanya jauh lebih tinggi dari internet rumahan.
- **Privasi**: IP lokal kamu tidak terekspos langsung ke mesin pencari.

## Konfigurasi
- **Model Default**: `llama3.2:3b` (Bisa diubah via flag `-m`).
- **Context Window**: Mengikuti default Ollama (biasanya 2048 - 4096 token).
- **Persistence**: Model tetap standby di RAM VPS selama 5 menit setelah digunakan (default Ollama keep-alive).
