import qrcode from 'qrcode-generator'

// The dynamic QRIS of a PG sale is a string (UMK-1991); this draws it. The store's own static QRIS is an uploaded
// image and does not come through here. `qrcode-generator` is the one dependency added for it (no dependencies of
// its own); the SVG is built from the matrix as a path, never as markup from a string.

/** Light modules around the code that a scanner needs (the QR standard says 4). */
export const QUIET_ZONE = 4

// Byte mode with UTF-8: the library's default turns a character into its low 8 bits, so any non-ASCII text would
// draw a different, wrong code. A QRIS string is ASCII, but a wrong code is worse than a longer one.
qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s))

/** The QR's dark modules, row by row. Throws when the text is too long for any QR version. */
export function qrMatrix(value: string): boolean[][] {
  const qr = qrcode(0, 'M')
  qr.addData(value, 'Byte')
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
