import qrcode from 'qrcode-generator'

export function buatQrSvg(teks, ukuran = 220) {
  const qr = qrcode(0, 'M')
  qr.addData(teks)
  qr.make()
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true })
}

export const qrcodeLib = qrcode
