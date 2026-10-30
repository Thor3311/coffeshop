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

`APP_ORIGIN` boleh dibiarkan kosong di lokal: origin lalu diambil dari request, jadi login
username/kata sandi di `http://localhost:8787/admin` langsung berjalan tanpa variabel tambahan.
Sign in with Freebuff tidak aktif bila `FREEBUFF_CLIENT_ID`/`FREEBUFF_ISSUER` tidak diisi, dan
itu tidak menghalangi login staf.

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

Jalur **Sign in with Freebuff** tetap tersedia sebagai opsi (admin dapat membuat kode undangan
sekali pakai untuk staf yang lebih suka memakai akun Freebuff), tetapi hanya hidup bila
`FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER`, dan `APP_ORIGIN` diisi. Di akun Cloudflare sendiri
jalur ini mati secara default — login username/kata sandi tetap penuh berfungsi.

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
index.html           landing page
meja.html            pemilih meja
pesan.html           menu, keranjang, checkout, pembayaran, status
pesanan.html         pelacakan pesanan
admin.html           portal admin
barista.html         papan barista
assets/              style.css, app.js (sumber, dipakai apa adanya)
scripts/build.mjs    bundel esbuild + salin halaman/aset ke dist/public
deploy.json          manifest deploy Sites (worker + dist/public)
wrangler.jsonc       konfigurasi Worker: binding DB/ASSETS, APP_ORIGIN, dev lokal + deploy
```

Halaman dan aset berada di root repo agar bisa disajikan langsung sebagai situs statis
(GitHub Pages). `npm run build` menyalinnya ke `dist/public` untuk dilayani Worker, jadi tidak
ada berkas ganda yang perlu disunting dua kali.

## GitHub Pages

Repo ini bisa langsung dipakai GitHub Pages dengan pengaturan **Settings → Pages →
Deploy from a branch → `main` / `(root)`**. Halaman dan CSS memakai path relatif, sehingga tetap
benar saat disajikan dari subfolder (`https://<user>.github.io/<repo>/`), dan `.nojekyll` membuat
GitHub tidak memproses berkas lewat Jekyll.

Batasannya jelas: GitHub Pages hanya menyajikan berkas statis, tanpa Worker dan D1. Di sana
landing page tampil utuh (menu memakai kartu statis bawaan HTML), tetapi daftar meja, pemesanan,
pelacakan, portal admin, dan papan barista memerlukan backend. Untuk alur yang hidup, pakai
deploy Worker/Sites di bawah.

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

## Deploy ke akun Cloudflare sendiri

Yang dibutuhkan: Node 18+, akun Cloudflare (paket gratis cukup), dan `npm install` sekali.

### 1. Masuk ke akun Cloudflare

```bash
npm run login          # membuka browser: pilih akun → Allow
npx wrangler whoami    # memastikan akun & izin terbaca
```

### 2. Buat database D1 (sekali saja)

```bash
npm run db:create
```

Perintah itu menjalankan `wrangler d1 create kang-bahar --binding DB --update-config --location apac`,
sehingga database `kang-bahar` dibuat di akunmu dan `database_id` di `wrangler.jsonc` langsung
terisi. Kalau database sudah ada, perintah berhenti dengan pesan *already exists* — ambil id-nya
di dashboard (**D1 → kang-bahar → UUID**) dan tempel ke `d1_databases[0].database_id`.

### 3. Deploy

```bash
npm run deploy         # build halaman + worker, lalu wrangler deploy
```

URL pertama muncul di akhir output, bentuknya
`https://kang-bahar-coffee.<subdomain>.workers.dev`.

### 4. Isi `APP_ORIGIN` lalu deploy ulang

Salin origin dari langkah 3 ke `vars.APP_ORIGIN` di `wrangler.jsonc`, misalnya
`"https://kang-bahar-coffee.namamu.workers.dev"`, lalu `npm run deploy` sekali lagi.
Dengan begitu cookie sesi dikirim dengan atribut `Secure` dan pemeriksaan same-origin memakai
origin tetap, bukan header dari request.

### 5. Database terisi otomatis

Tidak ada migrasi manual: request API pertama membuat tabel, 12 menu, 10 meja, dan akun admin
bawaan. Bukti cepat:

```bash
curl https://<worker-mu>/api/menu
```

Kalau JSON berisi 12 menu, database siap. Halaman `https://<worker-mu>/admin` sudah bisa dibuka
saat itu juga.

### 6. Masuk admin dan ganti kata sandi

Buka `/admin`, masuk dengan `adminkang` dan kata sandi bawaan, lalu **Staf → Reset sandi**.
Lakukan sebelum URL dibagikan: kata sandi bawaan ada di kode sumber repositori ini, jadi siapa
pun yang tahu nilainya punya akses admin penuh. Setelah itu buat akun barista di **Staf →
Akun staf**.

### 7. Domain sendiri (opsional)

Dashboard: **Workers & Pages → kang-bahar-coffee → Settings → Domains & Routes → Add →
Custom domain**. Atau di `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "kopi.domainmu.com", "custom_domain": true }]
```

lalu `npm run deploy`. Domain harus memakai nameserver Cloudflare (gratis). Setelah domain aktif,
ubah `APP_ORIGIN` ke `https://kopi.domainmu.com` dan deploy ulang agar cookie mengikuti domain itu.

### Memperbarui dan merawat

```bash
npm run deploy         # setiap kali kode berubah
npm run logs           # log real-time Worker
```

- **Biaya**: paket gratis Worker (100.000 request/hari) dan D1 (5 GB) jauh lebih dari cukup untuk
  satu kedai; keduanya tidak perlu kartu kredit.
- **Menghapus**: `npx wrangler delete kang-bahar-coffee` lalu `npx wrangler d1 delete kang-bahar`.
- **Test tanpa mengunggah**: `npx wrangler deploy --dry-run --outdir /tmp/kb` membaca konfigurasi
  dan seluruh aset tanpa menyentuh akun.

### Deploy lewat Sites (preview Freebuff)

Manifest `deploy.json` tetap ada (`entrypoint: worker.js`, `assetsDirectory: ./dist/public`).
Sites mengisi binding `DB` dan variabel auth secara otomatis, jadi `npm run build` lalu deploy
lewat alat Sites — tidak perlu D1 sendiri.
