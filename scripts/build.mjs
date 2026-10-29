import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

// Halaman dan aset publik tinggal di root repo (agar GitHub Pages bisa menyajikannya
// langsung). Worker tetap dilayani dari dist/, jadi berkas statis disalin ke dist/public.
const HALAMAN = ['index.html', 'meja.html', 'pesan.html', 'pesanan.html', 'admin.html', 'barista.html']
const ASET = ['style.css', 'app.js']

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist/public/assets', { recursive: true })

for (const berkas of HALAMAN) cpSync(berkas, `dist/public/${berkas}`)
for (const berkas of ASET) cpSync(`assets/${berkas}`, `dist/public/assets/${berkas}`)

await build({
  entryPoints: ['src/worker.js'],
  outfile: 'dist/worker.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['worker', 'browser'],
  logLevel: 'info',
})

// QR encoder untuk halaman admin (menggambar QR meja di browser).
await build({
  entryPoints: ['src/vendor-qr.js'],
  outfile: 'dist/public/assets/qrcode.js',
  bundle: true,
  format: 'iife',
  globalName: 'qrcodegen',
  target: 'es2019',
  logLevel: 'info',
})

console.log('build selesai: dist/worker.js + dist/public (halaman, style.css, app.js, qrcode.js)')
