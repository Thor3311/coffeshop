import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('dist', { recursive: true })
mkdirSync('public/assets', { recursive: true })

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

// QR encoder for the admin page (renders table QRs in the browser).
await build({
  entryPoints: ['src/vendor-qr.js'],
  outfile: 'public/assets/qrcode.js',
  bundle: true,
  format: 'iife',
  globalName: 'qrcodegen',
  target: 'es2019',
  logLevel: 'info',
})

console.log('build selesai: dist/worker.js + public/assets/qrcode.js')
