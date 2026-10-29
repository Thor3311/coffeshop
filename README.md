# Kang Bahar Coffee

Situs kedai kopi dengan pemesanan lewat QR di meja, portal admin, dan papan barista.
Dibangun sebagai Cloudflare Worker + D1 (SQLite), tanpa framework front-end dan tanpa build
step untuk halaman—halaman HTML/CSS/JS biasa, worker-nya dibundel dengan esbuild.

- **Publik**: landing page, daftar meja, halaman pesan (keranjang → checkout → bayar), pelacakan pesanan.
- **Staf**: login Freebuff, portal admin (ringkasan, pesanan, menu, meja & QR, staf), papan barista (antrean live).

## Menjalankan di lokal

```bash
npm install
npm run build        # bundel worker + pustaka QR
npm run dev          # http://localhost:8787
```

`npm run dev` memakai D1 lokal (`.wrangler/state`). Skema dan data awal (12 menu, 10 meja)
dibuat otomatis saat request API pertama.

Login lokal memakai client ID pengembangan yang sudah didaftarkan untuk
`http://localhost:8787/auth/freebuff/callback`. Jangan mengganti `APP_ORIGIN` ke `127.0.0.1`
saat menguji login: cookie OIDC terikat pada origin `localhost`.

## Peran staf

Login staf memakai **username dan kata sandi**, bukan akun Freebuff.

- Akun admin bawaan: username **`adminkang`** (kata sandi awal diberikan terpisah saat serah
  terima dan sengaja tidak ditulis di repositori).
- Buka `/admin` atau `/barista`, masukkan username dan kata sandi.
- Admin menambah akun barista di **Portal admin → tab Staf → Akun staf**: isi username, nama,
  kata sandi (minimal 6 karakter), dan peran. Akun yang sama bisa dipakai untuk kedua halaman,
  hanya saja halaman admin menolak peran `barista`.
- **Segera ganti kata sandi bawaan**: tab *Staf* → **Reset sandi** pada akun `adminkang`.
- Logout memanggil `POST /api/staf/keluar` (cookie sesi dihapus di server).

Kata sandi disimpan sebagai hash PBKDF2-SHA256 bersalt di tabel `kredensial`, tidak pernah di
kode halaman maupun di body respons. Sesi memakai token acak 256-bit yang di-hash di database,
dikirim sebagai cookie `HttpOnly; SameSite=Lax` (plus `Secure` di HTTPS) dan berlaku 12 jam.
Login dibatasi 8 percobaan gagal per 10 menit untuk setiap kombinasi IP dan username.

Jalur **Sign in with Freebuff** tetap tersedia sebagai opsi: admin dapat membuat kode undangan
sekali pakai untuk staf yang lebih suka memakai akun Freebuff.

Hak akses ditegakkan di server pada setiap endpoint (`/api/pesanan`, `/api/ringkasan`,
`/api/menu`, `/api/meja`, `/api/staf/*`), bukan hanya disembunyikan di UI.

## Alur pelanggan

1. QR tiap meja mengarah ke `/pesan?meja=M01` (dibuat di tab *Meja & QR*, bisa dicetak).
2. Pelanggan menambah menu, mengisi nama, memilih metode bayar, lalu mengirim pesanan.
3. Pesanan menerima kode `KB-XXXXX`; halaman status memperbarui diri tiap 5 detik.
4. Barista memproses di `/barista`: Baru → Sedang dibuat → Siap diantar → Selesai.

## Catatan pembayaran

Pembayaran di aplikasi ini **belum terhubung ke payment gateway**. Alur yang berjalan:

- **QRIS / e-wallet**: pelanggan melihat kode QR (berisi kode pesanan dan nominal), menekan
  *Saya sudah bayar*, status berubah menjadi *Menunggu verifikasi*, lalu kasir menekan
  **Tandai lunas** di papan barista atau portal admin.
- **Tunai**: pelanggan membayar di kasir, kasir menandai lunas.

Verifikasi manual ini disengaja agar tidak ada klaim pembayaran palsu. Untuk pembayaran otomatis
(QRIS dinamis, e-wallet, kartu) perlu akun merchant pada penyedia seperti Midtrans atau Xendit;
setelah kredensial tersedia, langkah berikutnya adalah membuat endpoint pembuatan transaksi,
webhook status, dan mengganti tombol konfirmasi manual dengan status dari webhook.

## Struktur

```
src/worker.js        API + auth + bootstrap skema/seed + penyajian aset
src/vendor-qr.js     pembungkus pustaka QR untuk halaman admin
public/index.html    landing page
public/meja.html     pemilih meja
public/pesan.html    menu, keranjang, checkout, pembayaran, status
public/pesanan.html  pelacakan pesanan
public/admin.html    portal admin
public/barista.html  papan barista
public/assets/       style.css, app.js, qrcode.js (hasil build)
scripts/build.mjs    bundel esbuild
deploy.json          manifest deploy Sites (worker + folder public)
wrangler.jsonc       konfigurasi dev lokal (binding DB, ASSETS, variabel auth)
```

## Skema D1

| Tabel | Isi |
| --- | --- |
| `meja` | kode, nomor, label, aktif |
| `menu` | nama, kategori, deskripsi, harga, tersedia |
| `pesanan` | kode, meja, nama, catatan, total, status, metode_bayar, status_bayar, waktu |
| `item` | baris pesanan (nama & harga disalin saat dipesan) |
| `staf` | `sub` Freebuff, nama, peran (`admin`/`barista`) |
| `undangan` | kode sekali pakai + peran |
| `kredensial` | username, nama, hash kata sandi, peran |
| `sesi` | hash token sesi, username, peran, kedaluwarsa |
| `meta` | penanda versi skema agar bootstrap tidak dijalankan ulang tiap request |

Harga dan total selalu dihitung ulang di server dari tabel `menu`, bukan dari body request.

## API singkat

| Metode | Path | Akses |
| --- | --- | --- |
| GET | `/api/menu` | publik |
| GET | `/api/meja`, `/api/meja/:kode` | publik |
| POST | `/api/pesanan` | publik (same-origin) |
| GET | `/api/pesanan/:kode` | publik dengan kode |
| POST | `/api/pesanan/:kode/bayar` | publik dengan kode |
| GET | `/api/pesanan?filter=aktif\|hari\|selesai\|semua` | staf |
| PATCH | `/api/pesanan/:id` | staf |
| GET | `/api/ringkasan` | staf |
| POST/PATCH/DELETE | `/api/menu`, `/api/menu/:id` | admin |
| POST/PATCH | `/api/meja`, `/api/meja/:kode` | admin |
| GET | `/api/staf/saya` | publik (status sesi) |
| POST | `/api/staf/masuk`, `/api/staf/keluar` | publik (same-origin) |
| GET/POST | `/api/staf/kredensial`, `/api/staf/kredensial/hapus` | admin |
| POST | `/api/staf/klaim-admin`, `/api/staf/gabung`, `/api/staf/undangan`, `/api/staf/hapus` | sesuai peran |
| GET | `/api/staf/daftar` | admin |

Semua request yang mengubah data wajib same-origin (`isSameOriginRequest`) dan diperiksa ulang
di server; respons API memakai `Cache-Control: no-store`.

## Deploy

Worker dibundel ke `dist/worker.js`, aset statis di `public/`. Manifest `deploy.json` dipakai
oleh Sites (`assetsDirectory: ./public`, binding `DB`, variabel auth diisi otomatis saat deploy).
`npm run build` harus dijalankan sebelum deploy.
