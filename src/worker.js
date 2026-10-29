import { createFreebuffAuth, isSameOriginRequest } from '@freebuff/auth'

/* ------------------------------------------------------------------ */
/*  Skema & data awal                                                  */
/* ------------------------------------------------------------------ */

const SKEMA = [
  `CREATE TABLE IF NOT EXISTS meja (
     kode TEXT PRIMARY KEY,
     nomor INTEGER NOT NULL,
     label TEXT NOT NULL,
     aktif INTEGER NOT NULL DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS menu (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     nama TEXT NOT NULL,
     kategori TEXT NOT NULL,
     deskripsi TEXT NOT NULL DEFAULT '',
     harga INTEGER NOT NULL,
     tersedia INTEGER NOT NULL DEFAULT 1,
     urutan INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS pesanan (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kode TEXT NOT NULL UNIQUE,
     meja_kode TEXT NOT NULL,
     nama TEXT NOT NULL,
     catatan TEXT NOT NULL DEFAULT '',
     total INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'baru',
     metode_bayar TEXT NOT NULL DEFAULT 'qris',
     status_bayar TEXT NOT NULL DEFAULT 'belum',
     dibuat INTEGER NOT NULL,
     diubah INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS item (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     pesanan_id INTEGER NOT NULL,
     menu_id INTEGER,
     nama TEXT NOT NULL,
     harga INTEGER NOT NULL,
     jumlah INTEGER NOT NULL,
     catatan TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS staf (
     sub TEXT PRIMARY KEY,
     nama TEXT NOT NULL DEFAULT '',
     peran TEXT NOT NULL,
     dibuat INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS undangan (
     kode TEXT PRIMARY KEY,
     peran TEXT NOT NULL,
     dipakai INTEGER NOT NULL DEFAULT 0,
     dibuat INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS kredensial (
     username TEXT PRIMARY KEY,
     nama TEXT NOT NULL,
     hash TEXT NOT NULL,
     peran TEXT NOT NULL,
     dibuat INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sesi (
     token_hash TEXT PRIMARY KEY,
     username TEXT NOT NULL,
     nama TEXT NOT NULL,
     peran TEXT NOT NULL,
     kedaluwarsa INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS meta (
     kunci TEXT PRIMARY KEY,
     nilai TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_pesanan_dibuat ON pesanan (dibuat DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_item_pesanan ON item (pesanan_id)`,
]

// Naikkan versi ini setiap kali SKEMA berubah, agar bootstrap dijalankan ulang.
const SKEMA_VERSI = 'v2'

const MENU_AWAL = [
  ['Es Kopi Susu Gula Aren', 'Kopi', 'Espresso, susu segar, dan gula aren cair. Menu paling dicari.', 22000],
  ['Americano', 'Kopi', 'Dua shot espresso dengan air panas atau es.', 18000],
  ['Cappuccino', 'Kopi', 'Espresso, susu steamed, dan foam tebal.', 24000],
  ['Cafe Latte', 'Kopi', 'Espresso dengan susu steamed yang lembut.', 25000],
  ['Espresso', 'Kopi', 'Satu shot pekat dari biji house blend.', 16000],
  ['Kopi Tubruk', 'Kopi', 'Seduhan klasik, disajikan dengan gula batu.', 15000],
  ['Matcha Latte', 'Non-Kopi', 'Matcha Jepang dengan susu segar.', 26000],
  ['Cokelat Panas', 'Non-Kopi', 'Cokelat pekat dengan whipped cream.', 23000],
  ['Teh Lemon Madu', 'Non-Kopi', 'Teh hitam, lemon segar, dan madu.', 17000],
  ['Croissant Butter', 'Makanan', 'Croissant mentega, dipanggang ulang saat dipesan.', 20000],
  ['Roti Bakar Srikaya', 'Makanan', 'Roti gandum dengan srikaya buatan sendiri.', 17000],
  ['Pisang Goreng Keju', 'Makanan', 'Pisang goreng hangat dengan keju parut.', 18000],
]

// Hash PBKDF2-SHA256 dari kata sandi admin awal. Kata sandi aslinya tidak disimpan di kode.
// Iterasi dibuat rendah (2.000) agar verifikasi selesai jauh di bawah batas CPU Worker;
// keamanan bertumpu pada HTTPS, HttpOnly cookie, dan pembatasan percobaan login.
const HASH_ADMIN_AWAL = 'pbkdf2$2000$txS06DPsUBcYKOaMJFswEQ==$wj/XjgdbCXYPnxIVeZWliALx4N17Hsj7Hjv9M/LrlUQ='
// Hash lama (100.000 iterasi) yang perlu dipindahkan agar login tidak lambat.
const HASH_ADMIN_LAMA = 'pbkdf2$100000$cUMA07ti6jKkNME9Z3UuUA==$bDj1FOelIo5K+0XcmQoP3xb1HvmirqOo2FRbRckGI2g='

const STATUS_PESANAN = ['baru', 'diproses', 'siap', 'selesai', 'batal']
const STATUS_BAYAR = ['belum', 'verifikasi', 'lunas']
const METODE = ['qris', 'ewallet', 'tunai']

let siapDb = false
let authInstance
let appInstance

function getAuth(env) {
  authInstance ??= createFreebuffAuth({
    clientId: env.FREEBUFF_CLIENT_ID,
    issuer: env.FREEBUFF_ISSUER,
    baseUrl: env.APP_ORIGIN,
    allowInsecureLocalhost: env.APP_ORIGIN.startsWith('http://'),
  })
  return authInstance
}

/* ------------------------------------------------------------------ */
/*  Utilitas                                                           */
/* ------------------------------------------------------------------ */

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function acak(panjang) {
  const abjad = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(panjang))
  return Array.from(bytes, (b) => abjad[b % abjad.length]).join('')
}

function awalHariWib() {
  const geser = 7 * 60 * 60 * 1000
  const sekarang = Date.now()
  return Math.floor((sekarang + geser) / 86400000) * 86400000 - geser
}

async function siapkanDatabase(env) {
  if (siapDb) return

  // Jalan pintas: satu query murah, bukan seluruh batch DDL di setiap isolate baru.
  try {
    const meta = await env.DB.prepare('SELECT nilai FROM meta WHERE kunci = ?').bind('skema').first()
    if (meta && meta.nilai === SKEMA_VERSI) {
      siapDb = true
      return
    }
  } catch {
    // Tabel meta belum ada pada basis data baru.
  }

  await env.DB.batch(SKEMA.map((sql) => env.DB.prepare(sql)))

  const meja = await env.DB.prepare('SELECT COUNT(*) AS n FROM meja').first()
  if (!meja || meja.n === 0) {
    const baris = []
    for (let i = 1; i <= 10; i++) {
      baris.push(
        env.DB.prepare('INSERT INTO meja (kode, nomor, label, aktif) VALUES (?, ?, ?, 1)').bind(
          'M' + String(i).padStart(2, '0'),
          i,
          'Meja ' + i,
        ),
      )
    }
    await env.DB.batch(baris)
  }

  const menu = await env.DB.prepare('SELECT COUNT(*) AS n FROM menu').first()
  if (!menu || menu.n === 0) {
    await env.DB.batch(
      MENU_AWAL.map((m, i) =>
        env.DB.prepare(
          'INSERT INTO menu (nama, kategori, deskripsi, harga, tersedia, urutan) VALUES (?, ?, ?, ?, 1, ?)',
        ).bind(m[0], m[1], m[2], m[3], i),
      ),
    )
  }

  const kredensial = await env.DB.prepare('SELECT COUNT(*) AS n FROM kredensial').first()
  if (!kredensial || kredensial.n === 0) {
    await env.DB.prepare(
      'INSERT INTO kredensial (username, nama, hash, peran, dibuat) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('adminkang', 'Kang Bahar', HASH_ADMIN_AWAL, 'admin', Date.now())
      .run()
  } else {
    // Pindahkan hash admin bawaan yang masih memakai 100.000 iterasi.
    await env.DB.prepare('UPDATE kredensial SET hash = ? WHERE username = ? AND hash = ?')
      .bind(HASH_ADMIN_AWAL, 'adminkang', HASH_ADMIN_LAMA)
      .run()
  }

  await env.DB.prepare(
    "INSERT INTO meta (kunci, nilai) VALUES ('skema', ?) ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai",
  )
    .bind(SKEMA_VERSI)
    .run()
  siapDb = true
}

/* ---------- kredensial & sesi staf ---------- */

const UMUR_SESI = 12 * 60 * 60 * 1000
const gagalLogin = new Map()

function ambilCookie(header, nama) {
  for (const bagian of String(header || '').split(';')) {
    const potong = bagian.trim().split('=')
    if (potong[0] === nama) return potong.slice(1).join('=')
  }
  return null
}

function hexDari(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(teks) {
  return hexDari(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(teks)))
}

async function turunkan(password, salt, iterasi) {
  const kunci = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bit = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: Number(iterasi), hash: 'SHA-256' },
    kunci,
    256,
  )
  return new Uint8Array(bit)
}

async function verifikasiPassword(password, simpan) {
  const [skema, iterasi, saltB64, hashB64] = String(simpan || '').split('$')
  if (skema !== 'pbkdf2' || !iterasi || !saltB64 || !hashB64) return false
  try {
    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0))
    const target = Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0))
    const hasil = await turunkan(password, salt, iterasi)
    if (hasil.length !== target.length) return false
    let beda = 0
    for (let i = 0; i < hasil.length; i++) beda |= hasil[i] ^ target[i]
    return beda === 0
  } catch {
    return false
  }
}

async function buatHashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iterasi = 2000
  const hash = await turunkan(password, salt, iterasi)
  return `pbkdf2$${iterasi}$${btoa(String.fromCharCode(...salt))}$${btoa(String.fromCharCode(...hash))}`
}

function headerSesi(env, token, umurDetik) {
  const bagian = [`kb_sesi=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${umurDetik}`]
  if (env.APP_ORIGIN.startsWith('https://')) bagian.push('Secure')
  return bagian.join('; ')
}

async function stafDari(request, env) {
  const cookie = request.headers.get('Cookie')
  const token = ambilCookie(cookie, 'kb_sesi')
  if (token) {
    const sesi = await env.DB.prepare(
      'SELECT username, nama, peran, kedaluwarsa FROM sesi WHERE token_hash = ?',
    )
      .bind(await sha256Hex(token))
      .first()
    if (sesi && sesi.kedaluwarsa > Date.now()) {
      const sub = 'pw:' + sesi.username
      return {
        user: { sub, name: sesi.nama },
        staf: { sub, nama: sesi.nama, peran: sesi.peran, username: sesi.username },
        viaPassword: true,
      }
    }
  }

  const user = await getAuth(env).getUser(request)
  if (!user) return { user: null, staf: null }
  const staf = await env.DB.prepare('SELECT sub, nama, peran FROM staf WHERE sub = ?').bind(user.sub).first()
  return { user, staf }
}

function tolakAsal(request, env) {
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: 'Permintaan lintas asal ditolak.' }, 403)
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  API publik                                                         */
/* ------------------------------------------------------------------ */

async function daftarMenu(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, nama, kategori, deskripsi, harga, tersedia FROM menu ORDER BY urutan, id',
  ).all()
  return json({ menu: results })
}

async function daftarMeja(env, hanyaAktif) {
  const sql = hanyaAktif
    ? 'SELECT kode, nomor, label FROM meja WHERE aktif = 1 ORDER BY nomor'
    : 'SELECT kode, nomor, label, aktif FROM meja ORDER BY nomor'
  const { results } = await env.DB.prepare(sql).all()
  return json({ meja: results })
}

async function buatPesanan(request, env) {
  const salahAsal = tolakAsal(request, env)
  if (salahAsal) return salahAsal

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Body tidak valid.' }, 400)
  }

  const mejaKode = String(body?.meja || '').trim()
  const nama = String(body?.nama || '').trim().slice(0, 60)
  const catatan = String(body?.catatan || '').trim().slice(0, 240)
  const metode = METODE.includes(body?.metode) ? body.metode : 'qris'
  const items = Array.isArray(body?.items) ? body.items : []

  if (nama.length < 2) return json({ error: 'Nama minimal 2 karakter.' }, 400)
  if (items.length === 0) return json({ error: 'Pesanan masih kosong.' }, 400)
  if (items.length > 40) return json({ error: 'Terlalu banyak item.' }, 400)

  const meja = await env.DB.prepare('SELECT kode, label, aktif FROM meja WHERE kode = ?').bind(mejaKode).first()
  if (!meja || meja.aktif !== 1) return json({ error: 'Meja tidak ditemukan.' }, 404)

  const bersih = []
  for (const it of items) {
    const id = Number(it?.menu_id)
    const jumlah = Math.min(Math.max(Number(it?.jumlah) || 0, 1), 20)
    if (!Number.isInteger(id)) continue
    bersih.push({ id, jumlah, catatan: String(it?.catatan || '').trim().slice(0, 120) })
  }
  if (bersih.length === 0) return json({ error: 'Item pesanan tidak valid.' }, 400)

  const ids = [...new Set(bersih.map((b) => b.id))]
  const { results: menuRows } = await env.DB.prepare(
    `SELECT id, nama, harga, tersedia FROM menu WHERE id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all()
  const peta = new Map(menuRows.map((m) => [m.id, m]))

  let total = 0
  const itemFinal = []
  for (const b of bersih) {
    const m = peta.get(b.id)
    if (!m || m.tersedia !== 1) return json({ error: 'Ada menu yang sedang tidak tersedia.' }, 409)
    total += m.harga * b.jumlah
    itemFinal.push({ menu_id: m.id, nama: m.nama, harga: m.harga, jumlah: b.jumlah, catatan: b.catatan })
  }

  const sekarang = Date.now()
  for (let coba = 0; coba < 6; coba++) {
    const kode = 'KB-' + acak(5)
    try {
      await env.DB.prepare(
        `INSERT INTO pesanan (kode, meja_kode, nama, catatan, total, status, metode_bayar, status_bayar, dibuat, diubah)
         VALUES (?, ?, ?, ?, ?, 'baru', ?, 'belum', ?, ?)`,
      )
        .bind(kode, meja.kode, nama, catatan, total, metode, sekarang, sekarang)
        .run()

      const row = await env.DB.prepare('SELECT id FROM pesanan WHERE kode = ?').bind(kode).first()
      await env.DB.batch(
        itemFinal.map((it) =>
          env.DB.prepare(
            'INSERT INTO item (pesanan_id, menu_id, nama, harga, jumlah, catatan) VALUES (?, ?, ?, ?, ?, ?)',
          ).bind(row.id, it.menu_id, it.nama, it.harga, it.jumlah, it.catatan),
        ),
      )
      return json({ kode, total, meja: meja.label }, 201)
    } catch (err) {
      if (!String(err).includes('UNIQUE')) throw err
    }
  }
  return json({ error: 'Gagal membuat nomor pesanan, coba lagi.' }, 500)
}

async function detailPesanan(env, kode) {
  const pesanan = await env.DB.prepare(
    `SELECT p.kode, p.nama, p.catatan, p.total, p.status, p.metode_bayar, p.status_bayar,
            p.dibuat, p.diubah, m.label AS meja
     FROM pesanan p LEFT JOIN meja m ON m.kode = p.meja_kode
     WHERE p.kode = ?`,
  )
    .bind(kode)
    .first()
  if (!pesanan) return json({ error: 'Pesanan tidak ditemukan.' }, 404)
  const { results: item } = await env.DB.prepare(
    'SELECT nama, harga, jumlah, catatan FROM item WHERE pesanan_id = (SELECT id FROM pesanan WHERE kode = ?)',
  )
    .bind(kode)
    .all()
  return json({ pesanan, item })
}

async function konfirmasiBayar(request, env, kode) {
  const salahAsal = tolakAsal(request, env)
  if (salahAsal) return salahAsal
  const pesanan = await env.DB.prepare('SELECT id, status_bayar FROM pesanan WHERE kode = ?').bind(kode).first()
  if (!pesanan) return json({ error: 'Pesanan tidak ditemukan.' }, 404)
  if (pesanan.status_bayar !== 'belum') {
    return json({ error: 'Pembayaran sudah dikonfirmasi sebelumnya.' }, 409)
  }
  await env.DB.prepare("UPDATE pesanan SET status_bayar = 'verifikasi', diubah = ? WHERE kode = ?")
    .bind(Date.now(), kode)
    .run()
  return json({ ok: true, status_bayar: 'verifikasi' })
}

/* ------------------------------------------------------------------ */
/*  API staf                                                           */
/* ------------------------------------------------------------------ */

async function pesananStaf(request, env) {
  const url = new URL(request.url)
  const filter = url.searchParams.get('filter') || 'aktif'
  let where = ''
  const bind = []
  if (filter === 'aktif') where = "WHERE p.status IN ('baru','diproses','siap')"
  else if (filter === 'hari') {
    where = 'WHERE p.dibuat >= ?'
    bind.push(awalHariWib())
  } else if (filter === 'selesai') where = "WHERE p.status IN ('selesai','batal')"

  const { results: pesanan } = await env.DB.prepare(
    `SELECT p.id, p.kode, p.nama, p.catatan, p.total, p.status, p.metode_bayar, p.status_bayar,
            p.dibuat, p.diubah, m.label AS meja, m.nomor AS meja_nomor
     FROM pesanan p LEFT JOIN meja m ON m.kode = p.meja_kode
     ${where}
     ORDER BY p.dibuat DESC LIMIT 80`,
  )
    .bind(...bind)
    .all()

  if (pesanan.length === 0) return json({ pesanan: [] })

  const ids = pesanan.map((p) => p.id)
  const { results: items } = await env.DB.prepare(
    `SELECT pesanan_id, nama, harga, jumlah, catatan FROM item WHERE pesanan_id IN (${ids
      .map(() => '?')
      .join(',')})`,
  )
    .bind(...ids)
    .all()

  const perPesanan = new Map()
  for (const it of items) {
    if (!perPesanan.has(it.pesanan_id)) perPesanan.set(it.pesanan_id, [])
    perPesanan.get(it.pesanan_id).push(it)
  }
  return json({ pesanan: pesanan.map((p) => ({ ...p, item: perPesanan.get(p.id) || [] })) })
}

async function ubahPesanan(request, env, id) {
  const salahAsal = tolakAsal(request, env)
  if (salahAsal) return salahAsal
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Body tidak valid.' }, 400)
  }
  const pesanan = await env.DB.prepare('SELECT id FROM pesanan WHERE id = ?').bind(id).first()
  if (!pesanan) return json({ error: 'Pesanan tidak ditemukan.' }, 404)

  const bagian = []
  const nilai = []
  if (body.status !== undefined) {
    if (!STATUS_PESANAN.includes(body.status)) return json({ error: 'Status tidak dikenal.' }, 400)
    bagian.push('status = ?')
    nilai.push(body.status)
  }
  if (body.status_bayar !== undefined) {
    if (!STATUS_BAYAR.includes(body.status_bayar)) return json({ error: 'Status bayar tidak dikenal.' }, 400)
    bagian.push('status_bayar = ?')
    nilai.push(body.status_bayar)
  }
  if (bagian.length === 0) return json({ error: 'Tidak ada perubahan.' }, 400)

  bagian.push('diubah = ?')
  nilai.push(Date.now())
  await env.DB.prepare(`UPDATE pesanan SET ${bagian.join(', ')} WHERE id = ?`)
    .bind(...nilai, id)
    .run()
  return json({ ok: true })
}

async function ringkasan(env) {
  const mulai = awalHariWib()
  const hariIni = await env.DB.prepare(
    'SELECT COUNT(*) AS jumlah, COALESCE(SUM(CASE WHEN status_bayar = \'lunas\' THEN total ELSE 0 END), 0) AS pendapatan FROM pesanan WHERE dibuat >= ? AND status != \'batal\'',
  )
    .bind(mulai)
    .first()

  const aktif = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM pesanan WHERE status IN ('baru','diproses','siap')",
  ).first()

  const { results: perStatus } = await env.DB.prepare(
    'SELECT status, COUNT(*) AS n FROM pesanan WHERE dibuat >= ? GROUP BY status',
  )
    .bind(mulai)
    .all()

  const belumDiverifikasi = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM pesanan WHERE status_bayar = 'verifikasi'",
  ).first()

  const mejaTerisi = await env.DB.prepare(
    "SELECT COUNT(DISTINCT meja_kode) AS n FROM pesanan WHERE status IN ('baru','diproses','siap')",
  ).first()

  const totalMeja = await env.DB.prepare('SELECT COUNT(*) AS n FROM meja WHERE aktif = 1').first()

  const { results: terlaris } = await env.DB.prepare(
    `SELECT i.nama, SUM(i.jumlah) AS jumlah
     FROM item i JOIN pesanan p ON p.id = i.pesanan_id
     WHERE p.dibuat >= ? AND p.status != 'batal'
     GROUP BY i.nama ORDER BY jumlah DESC LIMIT 5`,
  )
    .bind(mulai)
    .all()

  return json({
    tanggal: mulai,
    pesanan_hari_ini: hariIni?.jumlah || 0,
    pendapatan_hari_ini: hariIni?.pendapatan || 0,
    pesanan_aktif: aktif?.n || 0,
    menunggu_verifikasi: belumDiverifikasi?.n || 0,
    meja_terisi: mejaTerisi?.n || 0,
    total_meja: totalMeja?.n || 0,
    per_status: perStatus,
    terlaris,
  })
}

async function menuAdmin(request, env, method, id) {
  const salahAsal = tolakAsal(request, env)
  if (salahAsal) return salahAsal
  if (method === 'POST') {
    const body = await request.json().catch(() => null)
    const nama = String(body?.nama || '').trim().slice(0, 60)
    const kategori = ['Kopi', 'Non-Kopi', 'Makanan'].includes(body?.kategori) ? body.kategori : 'Kopi'
    const deskripsi = String(body?.deskripsi || '').trim().slice(0, 200)
    const harga = Math.max(1000, Math.min(Number(body?.harga) || 0, 1000000))
    if (nama.length < 2) return json({ error: 'Nama menu minimal 2 karakter.' }, 400)
    if (!harga) return json({ error: 'Harga tidak valid.' }, 400)
    const urutan = (await env.DB.prepare('SELECT COALESCE(MAX(urutan), 0) + 1 AS u FROM menu').first())?.u || 1
    const hasil = await env.DB.prepare(
      'INSERT INTO menu (nama, kategori, deskripsi, harga, tersedia, urutan) VALUES (?, ?, ?, ?, 1, ?)',
    )
      .bind(nama, kategori, deskripsi, harga, urutan)
      .run()
    return json({ ok: true, id: hasil.meta?.last_row_id }, 201)
  }

  if (!id) return json({ error: 'ID menu wajib diisi.' }, 400)
  if (method === 'PATCH') {
    const body = await request.json().catch(() => null)
    const bagian = []
    const nilai = []
    if (body?.nama !== undefined) {
      bagian.push('nama = ?')
      nilai.push(String(body.nama).trim().slice(0, 60))
    }
    if (body?.kategori !== undefined && ['Kopi', 'Non-Kopi', 'Makanan'].includes(body.kategori)) {
      bagian.push('kategori = ?')
      nilai.push(body.kategori)
    }
    if (body?.deskripsi !== undefined) {
      bagian.push('deskripsi = ?')
      nilai.push(String(body.deskripsi).trim().slice(0, 200))
    }
    if (body?.harga !== undefined) {
      bagian.push('harga = ?')
      nilai.push(Math.max(1000, Math.min(Number(body.harga) || 0, 1000000)))
    }
    if (body?.tersedia !== undefined) {
      bagian.push('tersedia = ?')
      nilai.push(body.tersedia ? 1 : 0)
    }
    if (bagian.length === 0) return json({ error: 'Tidak ada perubahan.' }, 400)
    await env.DB.prepare(`UPDATE menu SET ${bagian.join(', ')} WHERE id = ?`)
      .bind(...nilai, id)
      .run()
    return json({ ok: true })
  }

  if (method === 'DELETE') {
    const dipakai = await env.DB.prepare('SELECT COUNT(*) AS n FROM item WHERE menu_id = ?').bind(id).first()
    if (dipakai?.n) {
      await env.DB.prepare('UPDATE menu SET tersedia = 0 WHERE id = ?').bind(id).run()
      return json({ ok: true, dinonaktifkan: true })
    }
    await env.DB.prepare('DELETE FROM menu WHERE id = ?').bind(id).run()
    return json({ ok: true })
  }
  return json({ error: 'Metode tidak didukung.' }, 405)
}

async function mejaAdmin(request, env, method, kode) {
  const salahAsal = tolakAsal(request, env)
  if (salahAsal) return salahAsal
  if (method === 'POST') {
    const body = await request.json().catch(() => null)
    const nomor = Math.max(1, Math.min(Number(body?.nomor) || 0, 999))
    if (!nomor) return json({ error: 'Nomor meja tidak valid.' }, 400)
    const kodeBaru = String(body?.kode || 'M' + String(nomor).padStart(2, '0')).toUpperCase()
    const label = String(body?.label || 'Meja ' + nomor).slice(0, 40)
    try {
      await env.DB.prepare('INSERT INTO meja (kode, nomor, label, aktif) VALUES (?, ?, ?, 1)')
        .bind(kodeBaru, nomor, label)
        .run()
    } catch {
      return json({ error: 'Kode meja sudah dipakai.' }, 409)
    }
    return json({ ok: true, kode: kodeBaru }, 201)
  }
  if (method === 'PATCH') {
    if (!kode) return json({ error: 'Kode meja wajib diisi.' }, 400)
    const body = await request.json().catch(() => null)
    const bagian = []
    const nilai = []
    if (body?.label !== undefined) {
      bagian.push('label = ?')
      nilai.push(String(body.label).slice(0, 40))
    }
    if (body?.aktif !== undefined) {
      bagian.push('aktif = ?')
      nilai.push(body.aktif ? 1 : 0)
    }
    if (bagian.length === 0) return json({ error: 'Tidak ada perubahan.' }, 400)
    await env.DB.prepare(`UPDATE meja SET ${bagian.join(', ')} WHERE kode = ?`)
      .bind(...nilai, kode)
      .run()
    return json({ ok: true })
  }
  return json({ error: 'Metode tidak didukung.' }, 405)
}

async function stafEndpoint(request, env, segmen) {
  const { user, staf, viaPassword } = await stafDari(request, env)
  const jumlahStaf = await env.DB.prepare('SELECT COUNT(*) AS n FROM staf').first()
  const adaAdmin = await env.DB.prepare("SELECT COUNT(*) AS n FROM staf WHERE peran = 'admin'").first()
  const adaAdminKred = await env.DB.prepare("SELECT COUNT(*) AS n FROM kredensial WHERE peran = 'admin'").first()
  const adaAdminTotal = (adaAdmin?.n || 0) + (adaAdminKred?.n || 0) > 0

  if (segmen[0] === 'saya' && request.method === 'GET') {
    if (!user) return json({ login: false, adaAdmin: adaAdminTotal })
    if (!staf) return json({ login: true, terdaftar: false, adaAdmin: adaAdminTotal })
    return json({
      login: true,
      terdaftar: true,
      peran: staf.peran,
      nama: staf.nama || user.name || 'Staf',
      username: staf.username || null,
      via: viaPassword ? 'password' : 'freebuff',
    })
  }

  /* ----- login username & kata sandi (khusus staf kedai) ----- */
  if (segmen[0] === 'masuk' && request.method === 'POST') {
    const salahAsal = tolakAsal(request, env)
    if (salahAsal) return salahAsal
    const body = await request.json().catch(() => null)
    const username = String(body?.username || '').trim().toLowerCase().slice(0, 40)
    const password = String(body?.password || '')
    if (!username || !password) return json({ error: 'Username dan kata sandi wajib diisi.' }, 400)

    const ip = request.headers.get('CF-Connecting-IP') || 'lokal'
    const kunci = ip + '|' + username
    const catat = gagalLogin.get(kunci)
    if (catat && catat.n >= 8 && catat.sampai > Date.now()) {
      return json({ error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' }, 429)
    }

    const kred = await env.DB.prepare('SELECT username, nama, hash, peran FROM kredensial WHERE username = ?')
      .bind(username)
      .first()
    const cocok = kred ? await verifikasiPassword(password, kred.hash) : false
    if (!cocok) {
      const n = (catat && catat.sampai > Date.now() ? catat.n : 0) + 1
      gagalLogin.set(kunci, { n, sampai: Date.now() + 10 * 60 * 1000 })
      return json({ error: 'Username atau kata sandi salah.' }, 401)
    }
    gagalLogin.delete(kunci)

    const token = hexDari(crypto.getRandomValues(new Uint8Array(32)))
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sesi WHERE kedaluwarsa < ?').bind(Date.now()),
      env.DB.prepare('INSERT INTO sesi (token_hash, username, nama, peran, kedaluwarsa) VALUES (?, ?, ?, ?, ?)').bind(
        await sha256Hex(token),
        kred.username,
        kred.nama,
        kred.peran,
        Date.now() + UMUR_SESI,
      ),
    ])
    return new Response(JSON.stringify({ ok: true, peran: kred.peran, nama: kred.nama }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Set-Cookie': headerSesi(env, token, UMUR_SESI / 1000),
      },
    })
  }

  if (segmen[0] === 'keluar' && request.method === 'POST') {
    const salahAsal = tolakAsal(request, env)
    if (salahAsal) return salahAsal
    const token = ambilCookie(request.headers.get('Cookie'), 'kb_sesi')
    if (token) {
      await env.DB.prepare('DELETE FROM sesi WHERE token_hash = ?').bind(await sha256Hex(token)).run()
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Set-Cookie': headerSesi(env, '', 0),
      },
    })
  }

  if (!user) return json({ error: 'Silakan masuk terlebih dahulu.' }, 401)

  // Klaim admin pertama hanya jika belum ada staf sama sekali.
  if (segmen[0] === 'klaim-admin' && request.method === 'POST') {
    const salahAsal = tolakAsal(request, env)
    if (salahAsal) return salahAsal
    if (adaAdminTotal) return json({ error: 'Admin sudah ada. Masuk dengan akun yang diberikan admin.' }, 409)
    await env.DB.prepare('INSERT INTO staf (sub, nama, peran, dibuat) VALUES (?, ?, ?, ?)')
      .bind(user.sub, user.name || 'Admin', 'admin', Date.now())
      .run()
    return json({ ok: true, peran: 'admin' })
  }

  if (segmen[0] === 'gabung' && request.method === 'POST') {
    const salahAsal = tolakAsal(request, env)
    if (salahAsal) return salahAsal
    if (staf) return json({ error: 'Akun ini sudah terdaftar sebagai staf.' }, 409)
    const body = await request.json().catch(() => null)
    const kode = String(body?.kode || '').trim().toUpperCase()
    const undangan = await env.DB.prepare('SELECT kode, peran, dipakai FROM undangan WHERE kode = ?')
      .bind(kode)
      .first()
    if (!undangan || undangan.dipakai) return json({ error: 'Kode undangan tidak berlaku.' }, 404)
    await env.DB.batch([
      env.DB.prepare('INSERT INTO staf (sub, nama, peran, dibuat) VALUES (?, ?, ?, ?)').bind(
        user.sub,
        user.name || 'Staf',
        undangan.peran,
        Date.now(),
      ),
      env.DB.prepare('UPDATE undangan SET dipakai = 1 WHERE kode = ?').bind(kode),
    ])
    return json({ ok: true, peran: undangan.peran })
  }

  if (!staf) return json({ error: 'Akun ini belum terdaftar sebagai staf.' }, 403)

  if (segmen[0] === 'daftar' && request.method === 'GET') {
    if (staf.peran !== 'admin') return json({ error: 'Khusus admin.' }, 403)
    const { results } = await env.DB.prepare('SELECT sub, nama, peran, dibuat FROM staf ORDER BY dibuat').all()
    const { results: kredensial } = await env.DB.prepare(
      'SELECT username, nama, peran, dibuat FROM kredensial ORDER BY dibuat',
    ).all()
    return json({ staf: results, kredensial, saya: user.sub, username: staf.username || null })
  }

  /* ----- kelola akun username & kata sandi ----- */
  if (segmen[0] === 'kredensial') {
    if (staf.peran !== 'admin') return json({ error: 'Khusus admin.' }, 403)

    if (request.method === 'GET' && !segmen[1]) {
      const { results } = await env.DB.prepare(
        'SELECT username, nama, peran, dibuat FROM kredensial ORDER BY dibuat',
      ).all()
      return json({ kredensial: results })
    }

    if (request.method === 'POST' && !segmen[1]) {
      const salahAsal = tolakAsal(request, env)
      if (salahAsal) return salahAsal
      const body = await request.json().catch(() => null)
      const username = String(body?.username || '').trim().toLowerCase().slice(0, 40)
      const nama = String(body?.nama || '').trim().slice(0, 60) || username
      const password = String(body?.password || '')
      const peran = body?.peran === 'admin' ? 'admin' : 'barista'
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
        return json({ error: 'Username 3–40 karakter, hanya huruf kecil, angka, titik, garis bawah, atau strip.' }, 400)
      }
      if (password.length < 6) return json({ error: 'Kata sandi minimal 6 karakter.' }, 400)

      const lama = await env.DB.prepare('SELECT username FROM kredensial WHERE username = ?').bind(username).first()
      const hash = await buatHashPassword(password)
      if (lama) {
        await env.DB.batch([
          env.DB.prepare('UPDATE kredensial SET nama = ?, hash = ?, peran = ? WHERE username = ?').bind(
            nama,
            hash,
            peran,
            username,
          ),
          env.DB.prepare('DELETE FROM sesi WHERE username = ?').bind(username),
        ])
        return json({ ok: true, diperbarui: true })
      }
      await env.DB.prepare('INSERT INTO kredensial (username, nama, hash, peran, dibuat) VALUES (?, ?, ?, ?, ?)')
        .bind(username, nama, hash, peran, Date.now())
        .run()
      return json({ ok: true }, 201)
    }

    if (request.method === 'POST' && segmen[1] === 'hapus') {
      const salahAsal = tolakAsal(request, env)
      if (salahAsal) return salahAsal
      const body = await request.json().catch(() => null)
      const username = String(body?.username || '').trim().toLowerCase()
      if (!username) return json({ error: 'Username wajib diisi.' }, 400)
      if (staf.username === username) return json({ error: 'Tidak bisa menghapus akun sendiri.' }, 400)
      const target = await env.DB.prepare('SELECT peran FROM kredensial WHERE username = ?').bind(username).first()
      if (!target) return json({ error: 'Akun tidak ditemukan.' }, 404)
      if (target.peran === 'admin' && (adaAdminKred?.n || 0) <= 1) {
        return json({ error: 'Minimal harus ada satu admin dengan kata sandi.' }, 400)
      }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM kredensial WHERE username = ?').bind(username),
        env.DB.prepare('DELETE FROM sesi WHERE username = ?').bind(username),
      ])
      return json({ ok: true })
    }
  }

  if (segmen[0] === 'undangan' && request.method === 'POST') {
    if (staf.peran !== 'admin') return json({ error: 'Khusus admin.' }, 403)
    const salahAsal = tolakAsal(request, env)
    if (salahAsal) return salahAsal
    const body = await request.json().catch(() => null)
    const peran = body?.peran === 'admin' ? 'admin' : 'barista'
    const kode = acak(8)
    await env.DB.prepare('INSERT INTO undangan (kode, peran, dipakai, dibuat) VALUES (?, ?, 0, ?)')
      .bind(kode, peran, Date.now())
      .run()
    return json({ kode, peran }, 201)
  }

  if (segmen[0] === 'hapus' && request.method === 'POST') {
    if (staf.peran !== 'admin') return json({ error: 'Khusus admin.' }, 403)
    const salahAsal = tolakAsal(request, env)
    if (salahAsal) return salahAsal
    const body = await request.json().catch(() => null)
    const sub = String(body?.sub || '')
    if (!sub) return json({ error: 'Sub staf wajib diisi.' }, 400)
    if (sub === user.sub) return json({ error: 'Tidak bisa menghapus akun sendiri.' }, 400)
    const target = await env.DB.prepare('SELECT peran FROM staf WHERE sub = ?').bind(sub).first()
    if (!target) return json({ error: 'Staf tidak ditemukan.' }, 404)
    if (target.peran === 'admin' && (adaAdmin?.n || 0) <= 1) {
      return json({ error: 'Minimal harus ada satu admin.' }, 400)
    }
    await env.DB.prepare('DELETE FROM staf WHERE sub = ?').bind(sub).run()
    return json({ ok: true })
  }

  return json({ error: 'Endpoint staf tidak dikenal.' }, 404)
}

/* ------------------------------------------------------------------ */
/*  Handler utama                                                      */
/* ------------------------------------------------------------------ */

async function handle(request, env) {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method
  const segmen = path.split('/').filter(Boolean)

  if (path.startsWith('/api/')) {
    try {
      await siapkanDatabase(env)

      if (segmen[1] === 'menu' && segmen[2] === undefined) {
        if (method === 'GET') return await daftarMenu(env)
        const { user, staf } = await stafDari(request, env)
        if (!user || !staf || staf.peran !== 'admin') return json({ error: 'Khusus admin.' }, 403)
        return await menuAdmin(request, env, method, null)
      }
      if (segmen[1] === 'menu' && segmen[2]) {
        const { user, staf } = await stafDari(request, env)
        if (!user || !staf || staf.peran !== 'admin') return json({ error: 'Khusus admin.' }, 403)
        return await menuAdmin(request, env, method, Number(segmen[2]))
      }
      if (segmen[1] === 'meja') {
        if (method === 'GET' && !segmen[2]) return await daftarMeja(env, true)
        if (method === 'GET' && segmen[2]) {
          const meja = await env.DB.prepare('SELECT kode, nomor, label FROM meja WHERE kode = ? AND aktif = 1')
            .bind(segmen[2].toUpperCase())
            .first()
          if (!meja) return json({ error: 'Meja tidak ditemukan.' }, 404)
          return json({ meja })
        }
        const { user, staf } = await stafDari(request, env)
        if (!user || !staf || staf.peran !== 'admin') return json({ error: 'Khusus admin.' }, 403)
        return await mejaAdmin(request, env, method, segmen[2] ? segmen[2].toUpperCase() : null)
      }
      if (segmen[1] === 'pesanan' && !segmen[2] && method === 'POST') {
        return await buatPesanan(request, env)
      }
      if (segmen[1] === 'pesanan' && segmen[2] && segmen[3] === 'bayar' && method === 'POST') {
        return await konfirmasiBayar(request, env, segmen[2].toUpperCase())
      }
      if (segmen[1] === 'pesanan' && segmen[2] && method === 'GET') {
        return await detailPesanan(env, segmen[2].toUpperCase())
      }
      if (segmen[1] === 'pesanan' && !segmen[2] && method === 'GET') {
        const { user, staf } = await stafDari(request, env)
        if (!user) return json({ error: 'Silakan masuk terlebih dahulu.' }, 401)
        if (!staf) return json({ error: 'Akun ini belum terdaftar sebagai staf.' }, 403)
        return await pesananStaf(request, env)
      }
      if (segmen[1] === 'pesanan' && segmen[2] && method === 'PATCH') {
        const { user, staf } = await stafDari(request, env)
        if (!user) return json({ error: 'Silakan masuk terlebih dahulu.' }, 401)
        if (!staf) return json({ error: 'Akun ini belum terdaftar sebagai staf.' }, 403)
        return await ubahPesanan(request, env, Number(segmen[2]))
      }
      if (segmen[1] === 'ringkasan' && method === 'GET') {
        const { user, staf } = await stafDari(request, env)
        if (!user) return json({ error: 'Silakan masuk terlebih dahulu.' }, 401)
        if (!staf) return json({ error: 'Akun ini belum terdaftar sebagai staf.' }, 403)
        return await ringkasan(env)
      }
      if (segmen[1] === 'staf') {
        return await stafEndpoint(request, env, segmen.slice(2))
      }

      return json({ error: 'Endpoint tidak ditemukan.' }, 404)
    } catch (err) {
      console.error('API error:', err?.stack || err)
      return json({ error: 'Terjadi kesalahan pada server.' }, 500)
    }
  }

  // Aset statis, termasuk URL rapi tanpa akhiran .html
  let respons = await env.ASSETS.fetch(request)
  if (respons.status === 404 && !path.includes('.')) {
    const coba = new URL(request.url)
    coba.pathname = path.replace(/\/$/, '') + '.html'
    respons = await env.ASSETS.fetch(new Request(coba.toString(), request))
  }
  return respons
}

export default {
  fetch(request, env) {
    authInstance ??= getAuth(env)
    appInstance ??= authInstance.wrap(handle)
    return appInstance(request, env)
  },
}
