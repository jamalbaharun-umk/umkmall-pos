import qrcode from 'qrcode-generator'

// The dynamic QRIS of a PG sale is a string (UMK-1991); this draws it. The store's own static QRIS is an uploaded
// image and does not come through here. `qrcode-generator` is the one dependency added for it (no dependencies of
// its own); the SVG is built from the matrix as a path, never as markup from a string.

/** The QR's dark modules, row by row. Throws when the text is too long for any QR version. */
export function qrMatrix(value: string): boolean[][] {
  const qr = qrcode(0, 'M')
  qr.addData(value)
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
}

/** One SVG path for all dark modules: a horizontal run of dark modules is one rectangle. Unit = one module. */
export function qrPath(matrix: boolean[][]): string {
  const parts: string[] = []
  matrix.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (!row[x]) {
        x++
        continue
      }
      const start = x
      while (x < row.length && row[x]) x++
      parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`)
    }
  })
  return parts.join('')
}
