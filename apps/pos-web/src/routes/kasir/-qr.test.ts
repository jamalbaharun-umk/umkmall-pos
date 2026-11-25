import { describe, expect, it } from 'vitest'
import { QUIET_ZONE, qrMatrix, qrPath } from './-qr'

describe('qrMatrix', () => {
  it('makes a square matrix with the three finder patterns', () => {
    const m = qrMatrix('00020101021226670016COM.EXAMPLE.WWW0118936000000000000000520454995303360')
    expect(m.length).toBeGreaterThanOrEqual(21)
    expect(m.every((r) => r.length === m.length)).toBe(true)
    const n = m.length
    // each finder pattern's corner module is dark: top-left, top-right, bottom-left
    expect(m[0][0]).toBe(true)
    expect(m[0][n - 1]).toBe(true)
    expect(m[n - 1][0]).toBe(true)
  })

  it('is the same for the same text and different for another', () => {
    expect(qrMatrix('abc')).toEqual(qrMatrix('abc'))
    expect(qrMatrix('abc')).not.toEqual(qrMatrix('abd'))
  })

  it('encodes text as UTF-8, so two characters that share their low 8 bits are not the same code', () => {
    // U+00E9 and U+01E9 both end in 0xE9: the library's default (8-bit masking) would draw them identically
    expect(qrMatrix('\u00e9')).not.toEqual(qrMatrix('\u01e9'))
  })

  it('refuses text that no QR can hold, instead of drawing a wrong code', () => {
    expect(() => qrMatrix('x'.repeat(5000))).toThrow()
  })
})

describe('qrPath', () => {
  it('draws a run of dark modules as one rectangle and skips light ones', () => {
    expect(qrPath([[true, true, false, true]])).toBe('M0 0h2v1h-2zM3 0h1v1h-1z')
    expect(qrPath([[false], [true]])).toBe('M0 1h1v1h-1z')
    expect(qrPath([[false, false]])).toBe('')
  })
})

describe('quiet zone', () => {
  it('is the 4 modules the QR standard asks for', () => {
    expect(QUIET_ZONE).toBe(4)
  })
})
