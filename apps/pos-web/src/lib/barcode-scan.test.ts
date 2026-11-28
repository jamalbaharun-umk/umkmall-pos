import { describe, expect, it } from 'vitest'
import {
  BEEP_KEY,
  addedResult,
  barcodePath,
  cameraSupport,
  classifyCameraError,
  createDedupe,
  exactMatch,
  looksLikeTypedBarcode,
  normalizeCode,
  pickFormats,
  readBeep,
  showScanButton,
  soldOutResult,
  takenResult,
  writeBeep,
} from './barcode-scan'

describe('dedupe window (owner ruling: same code within 1.5 s counts once)', () => {
  it('counts the first scan, ignores the same code inside the window, counts it again at 1.5 s', () => {
    const d = createDedupe()
    expect(d.accept('8991', 1000)).toBe(true)
    expect(d.accept('8991', 1100)).toBe(false)
    expect(d.accept('8991', 2499)).toBe(false)
    expect(d.accept('8991', 2500)).toBe(true)
  })
  it('measures from the last counted scan, so a held camera adds one per window, not one per frame', () => {
    const d = createDedupe()
    const counted = [0, 300, 600, 900, 1200, 1500, 1800, 3000].filter((t) => d.accept('x', t))
    expect(counted).toEqual([0, 1500, 3000])
  })
  it('keeps codes apart, also A then B then A', () => {
    const d = createDedupe()
    expect(d.accept('A', 0)).toBe(true)
    expect(d.accept('B', 100)).toBe(true)
    expect(d.accept('A', 200)).toBe(false)
  })
  it('forget lets a failed scan be tried again at once', () => {
    const d = createDedupe()
    d.accept('A', 0)
    d.forget('A')
    expect(d.accept('A', 10)).toBe(true)
    d.reset()
    expect(d.accept('A', 20)).toBe(true)
  })
})

describe('code normalisation', () => {
  it('drops whitespace and control characters (a keyboard scanner ends with Enter), caps at 64', () => {
    expect(normalizeCode(' 8991 234\n')).toBe('8991234')
    expect(normalizeCode('\u0000AB\u001f12')).toBe('AB12')
    expect(normalizeCode('1'.repeat(80))).toHaveLength(64)
    expect(normalizeCode(undefined)).toBe('')
    expect(normalizeCode(42)).toBe('')
  })
})

describe('beep preference per device', () => {
  const store = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
  }
  it('is on by default and after being switched on', () => {
    const s = store()
    expect(readBeep(s)).toBe(true)
    writeBeep(false, s)
    expect(readBeep(s)).toBe(false)
    expect(s.m.get(BEEP_KEY)).toBe('0')
    writeBeep(true, s)
    expect(readBeep(s)).toBe(true)
  })
  it('works without storage and when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readBeep(undefined)).toBe(true)
    expect(readBeep(broken)).toBe(true)
    expect(() => writeBeep(false, broken)).not.toThrow()
    expect(() => writeBeep(false, undefined)).not.toThrow()
  })
})

describe('camera support and failures', () => {
  const ok = { isSecureContext: true, hasMediaDevices: true, hasDetector: true, videoInputs: 1 }
  it('answers each state in the order the sheet explains them', () => {
    expect(cameraSupport(ok)).toBe('ok')
    expect(cameraSupport({ ...ok, isSecureContext: false, hasDetector: false, hasMediaDevices: false })).toBe('insecure')
    expect(cameraSupport({ ...ok, hasMediaDevices: false })).toBe('no-camera')
    expect(cameraSupport({ ...ok, videoInputs: 0 })).toBe('no-camera')
    expect(cameraSupport({ ...ok, hasDetector: false })).toBe('no-detector')
    expect(cameraSupport({ ...ok, videoInputs: undefined })).toBe('ok')
  })
  it('shows the Scan button only where scanning works or http can be explained', () => {
    expect(showScanButton('ok')).toBe(true)
    expect(showScanButton('insecure')).toBe(true)
    expect(showScanButton('no-camera')).toBe(false)
    expect(showScanButton('no-detector')).toBe(false)
  })
  it('tells denied, no camera and busy apart', () => {
    expect(classifyCameraError({ name: 'NotAllowedError' })).toBe('denied')
    expect(classifyCameraError({ name: 'SecurityError' })).toBe('denied')
    expect(classifyCameraError({ name: 'NotFoundError' })).toBe('no-camera')
    expect(classifyCameraError({ name: 'NotReadableError' })).toBe('busy')
    expect(classifyCameraError(new Error('x'))).toBe('busy')
    expect(classifyCameraError(null)).toBe('busy')
  })
  it('asks the detector only for formats it supports', () => {
    expect(pickFormats(['qr_code', 'ean_13', 'code_128', 'aztec'])).toEqual(['ean_13', 'code_128'])
    expect(pickFormats([])).toEqual([])
  })
})

describe('matching a code to a product', () => {
  const rows = [
    { id: 'a', barcodes: ['89910000011'] },
    { id: 'b', barcodes: ['8991', 'AbC-1'] },
  ]
  it('takes only an exact barcode: the search is a substring match', () => {
    expect(exactMatch(rows, '8991')?.id).toBe('b')
    expect(exactMatch(rows, '899100000')).toBeNull()
    expect(exactMatch(rows, ' 89910000011\n')?.id).toBe('a')
  })
  it('falls back to a case-insensitive match, and an empty code matches nothing', () => {
    expect(exactMatch(rows, 'abc-1')?.id).toBe('b')
    expect(exactMatch(rows, '')).toBeNull()
    expect(exactMatch([], '8991')).toBeNull()
  })
  it('builds the existing catalogue search path, tenant from the session on the server', () => {
    expect(barcodePath(' 8991 ')).toBe('/catalog/products?perPage=20&q=8991&use=sale')
    expect(barcodePath('a b&c=d', 'all')).toBe('/catalog/products?perPage=20&q=ab%26c%3Dd')
  })
  it('treats Enter in the till search as a barcode only when the grid found nothing', () => {
    expect(looksLikeTypedBarcode('8991234567890', 0)).toBe(true)
    expect(looksLikeTypedBarcode('8991234567890', 1)).toBe(false)
    expect(looksLikeTypedBarcode('mi goreng', 0)).toBe(false)
    expect(looksLikeTypedBarcode('abc', 0)).toBe(false)
    expect(looksLikeTypedBarcode('  ', 0)).toBe(false)
  })
})

describe('result texts', () => {
  it('say what happened in Indonesian, with the cart count', () => {
    expect(addedResult('Mi goreng', 4)).toEqual({
      kind: 'ok',
      title: 'Mi goreng',
      badge: '+1',
      detail: 'Mi goreng ditambahkan. Di keranjang: 4 barang.',
    })
    expect(soldOutResult('Teh').kind).toBe('warn')
    expect(takenResult('899', 'Teh Botol 350ml')).toMatchObject({
      detail: 'Barcode 899 sudah dipakai produk Teh Botol 350ml.',
    })
  })
})
