/* Kang Bahar Coffee — utilitas bersama */
(function () {
  const rupiahFmt = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  })

  function rupiah(n) {
    return rupiahFmt.format(Number(n) || 0)
  }

  async function api(path, opsi = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: opsi.body ? { 'Content-Type': 'application/json' } : undefined,
      ...opsi,
      body: opsi.body && typeof opsi.body !== 'string' ? JSON.stringify(opsi.body) : opsi.body,
    })
    let data = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Permintaan gagal (' + res.status + ').')
      err.status = res.status
      err.data = data
      throw err
    }
    return data
  }

  function jam(ms) {
    return new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  }

  function lama(ms) {
    const detik = Math.max(0, Math.floor((Date.now() - Number(ms)) / 1000))
    if (detik < 60) return 'baru saja'
    const menit = Math.floor(detik / 60)
    if (menit < 60) return menit + ' mnt lalu'
    const jamLalu = Math.floor(menit / 60)
    if (jamLalu < 24) return jamLalu + ' jam lalu'
    return Math.floor(jamLalu / 24) + ' hari lalu'
  }

  function toast(pesan, jenis = '') {
    let wrap = document.querySelector('.toast-wrap')
    if (!wrap) {
      wrap = document.createElement('div')
      wrap.className = 'toast-wrap'
      document.body.appendChild(wrap)
    }
    const el = document.createElement('div')
    el.className = 'toast ' + jenis
    el.textContent = pesan
    wrap.appendChild(el)
    setTimeout(() => el.remove(), 4200)
  }

  const CUP = `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M14 24h30v12a15 15 0 0 1-15 15h0a15 15 0 0 1-15-15V24Z" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round"/>
    <path d="M44 28h4a7 7 0 0 1 0 14h-4" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M22 14c0-3 3-3 3-6M31 14c0-3 3-3 3-6M40 14c0-3 3-3 3-6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
  </svg>`

  const BEAN = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
    <ellipse cx="12" cy="12" rx="7.5" ry="10" transform="rotate(35 12 12)" stroke="currentColor" stroke-width="1.8"/>
    <path d="M7 17c3-1 5-3 6-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`

  function labelStatus(status) {
    return (
      {
        baru: 'Pesanan baru',
        diproses: 'Sedang dibuat',
        siap: 'Siap diantar',
        selesai: 'Selesai',
        batal: 'Dibatalkan',
      }[status] || status
    )
  }

  function labelBayar(status) {
    return (
      {
        belum: 'Belum dibayar',
        verifikasi: 'Menunggu verifikasi',
        lunas: 'Lunas',
      }[status] || status
    )
  }

  function kelasBayar(status) {
    return { belum: 'badge-red', verifikasi: 'badge-amber', lunas: 'badge-green' }[status] || 'badge-neutral'
  }

  async function sesiStaf() {
    return api('/api/staf/saya')
  }

  window.KB = {
    api,
    rupiah,
    jam,
    lama,
    toast,
    CUP,
    BEAN,
    labelStatus,
    labelBayar,
    kelasBayar,
    sesiStaf,
  }
})()
