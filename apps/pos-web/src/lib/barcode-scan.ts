// UMK-1986 (design 47): the pure rules of camera barcode scanning. No React, no browser globals unless passed in, so
// they are unit-tested on their own. The camera and the sheet are `components/barcode-scanner.tsx`.

/** The same code scanned twice within this window counts once (owner ruling 2026-11-28). */
export const DEDUPE_WINDOW_MS = 1500
export const MAX_CODE_LENGTH = 64
export const BEEP_KEY = 'pos.scan.beep'

/** Retail barcode formats; QR and the like are not product codes. Only those the browser supports are asked for. */
export const RETAIL_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar'] as const

export const pickFormats = (supported: readonly string[]): string[] => RETAIL_FORMATS.filter((f) => supported.includes(f))

/** A scanned or typed code as the catalogue stores it: no whitespace or control characters, at most 64 characters. */
export function normalizeCode(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\s\u0000-\u001f\u007f]/g, '').slice(0, MAX_CODE_LENGTH)
}

/**
 * Counts a code once inside the window. `accept` is true when the scan should count; the time of the last counted scan
 * of each code is kept, so A, B, A inside the window still counts A once. `forget` lets a scan that failed (no
 * connection) be tried again at once.
 */
export function createDedupe(windowMs = DEDUPE_WINDOW_MS) {
  const last = new Map<string, number>()
  return {
    accept(code: string, now: number): boolean {
      const before = last.get(code)
      if (before !== undefined && now - before < windowMs) return false
      last.set(code, now)
      // The map stays small: a code older than the window can never block anything.
      for (const [c, t] of last) if (now - t >= windowMs) last.delete(c)
      return true
    },
    forget(code: string) {
      last.delete(code)
    },
    reset() {
      last.clear()
    },
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
const deviceStorage = (): StorageLike | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** The beep is on unless this device switched it off; a browser without storage reads it as on. */
export function readBeep(storage: StorageLike | undefined = deviceStorage()): boolean {
  try {
    return storage?.getItem(BEEP_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeBeep(on: boolean, storage: StorageLike | undefined = deviceStorage()): void {
  try {
    storage?.setItem(BEEP_KEY, on ? '1' : '0')
  } catch {
    // Storage blocked: the choice lasts until the page closes only.
  }
}

/** Fired on `window` by `setBeep` so the Pengaturan switch and the camera sheet stay in step inside one tab. */
export const BEEP_EVENT = 'pos:scan-beep'

type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

/**
 * Calls `listener` whenever the beep choice may have changed: in this tab (`BEEP_EVENT`) or in another tab of the
 * device (`storage` event for `BEEP_KEY`). Returns the unsubscribe function.
 */
export function subscribeBeep(listener: () => void, target: Listenable | undefined = browserWindow()): () => void {
  if (!target) return () => undefined
  const onStorage = (e: Event) => {
    const key = (e as StorageEvent).key
    if (key === null || key === BEEP_KEY) listener()
  }
  target.addEventListener(BEEP_EVENT, listener)
  target.addEventListener('storage', onStorage)
  return () => {
    target.removeEventListener(BEEP_EVENT, listener)
    target.removeEventListener('storage', onStorage)
  }
}

const browserWindow = (): (Listenable & Pick<EventTarget, 'dispatchEvent'>) | undefined =>
  typeof window === 'undefined' ? undefined : window

/** Stores the choice and tells every switch on the page. */
export function setBeep(on: boolean, storage: StorageLike | undefined = deviceStorage(), target = browserWindow()): void {
  writeBeep(on, storage)
  try {
    target?.dispatchEvent(new Event(BEEP_EVENT))
  } catch {
    // No events: the next read still sees the stored value.
  }
}

/**
 * What to do with the shared AudioContext before a beep. Mobile browsers start it `suspended` (iOS also `interrupted`
 * after a call) until a user gesture resumes it; a `closed` one can never run again and is replaced.
 */
export function audioAction(state: string | undefined): 'create' | 'resume' | 'ready' {
  if (state === undefined || state === 'closed') return 'create'
  if (state === 'suspended' || state === 'interrupted') return 'resume'
  return 'ready'
}

export type CameraSupport = 'ok' | 'insecure' | 'no-detector' | 'no-camera'

/**
 * Whether this device can scan. An address that is not https (or localhost) has no camera API at all, and Chromium
 * hides the detector there too, so it is answered first: the sheet then explains it (screen 7).
 */
export function cameraSupport(env: {
  isSecureContext: boolean
  hasMediaDevices: boolean
  hasDetector: boolean
  /** Number of video inputs `enumerateDevices` listed; undefined while unknown. */
  videoInputs?: number
}): CameraSupport {
  if (!env.isSecureContext) return 'insecure'
  if (!env.hasMediaDevices) return 'no-camera'
  if (!env.hasDetector) return 'no-detector'
  if (env.videoInputs === 0) return 'no-camera'
  return 'ok'
}

/** The Scan button is shown where scanning works or where the sheet can say why not (http). */
export const showScanButton = (s: CameraSupport) => s === 'ok' || s === 'insecure'

export type CameraFailure = 'denied' | 'no-camera' | 'busy'

/** What a failed `getUserMedia` means for the person: permission refused, no camera, or the camera is in use. */
export function classifyCameraError(e: unknown): CameraFailure {
  const name = typeof e === 'object' && e && 'name' in e ? String((e as { name: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'no-camera'
  return 'busy'
}

/** The product whose barcode equals `code` (the catalogue search is a substring match), exact first, then any case. */
export function exactMatch<P extends { barcodes: readonly string[] }>(rows: readonly P[], code: string): P | null {
  const c = normalizeCode(code)
  if (!c) return null
  const lower = c.toLowerCase()
  return (
    rows.find((p) => p.barcodes.includes(c)) ?? rows.find((p) => p.barcodes.some((b) => b.toLowerCase() === lower)) ?? null
  )
}

/** pos-api path that finds a product by barcode among what the till sells (tenant from the session, server side). */
export function barcodePath(code: string, use: 'sale' | 'all' = 'sale'): string {
  const params = new URLSearchParams({ perPage: '20', q: normalizeCode(code) })
  if (use === 'sale') params.set('use', 'sale')
  return `/catalog/products?${params.toString()}`
}

/** What the camera sheet shows after one code: a success card, a warning that adds nothing, or an unknown code. */
export type ScanResult =
  | { kind: 'ok'; title: string; badge?: string; detail: string }
  | { kind: 'warn'; title: string; detail: string }
  | { kind: 'unknown'; code: string }

const items = (n: number) => `${n} barang`

/** Till: the product was added; `inCart` counts the items in the cart now. */
export const addedResult = (name: string, inCart: number): ScanResult => ({
  kind: 'ok',
  title: name,
  badge: '+1',
  detail: `${name} ditambahkan. Di keranjang: ${items(inCart)}.`,
})

export const soldOutResult = (name: string): ScanResult => ({
  kind: 'warn',
  title: `${name} habis`,
  detail: 'Tidak ada yang dimasukkan ke keranjang. Perbarui stok di Pembelian atau Stok opname.',
})

/** Product form: the code is free, so it fills the field. */
export const filledResult = (code: string): ScanResult => ({
  kind: 'ok',
  title: code,
  detail: `Barcode ${code} diisi ke kolom.`,
})

/** Product form: another product already holds the code (the catalogue refuses duplicates in one store). */
export const takenResult = (code: string, productName: string): ScanResult => ({
  kind: 'warn',
  title: 'Barcode sudah dipakai',
  detail: `Barcode ${code} sudah dipakai produk ${productName}.`,
})

/**
 * Product form: what a scanned `code` means for a barcode field. `others` are the form's other barcode rows;
 * `holderName` is the name of another product of the store that already holds the code, null when it is free.
 */
export function fieldScanResult(code: string, others: readonly string[], holderName: string | null): ScanResult {
  if (holderName) return takenResult(code, holderName)
  if (others.some((o) => normalizeCode(o) === code))
    return { kind: 'warn', title: 'Barcode sudah ada', detail: `Barcode ${code} sudah ada di daftar barcode produk ini.` }
  return filledResult(code)
}

export const unknownResult = (code: string): ScanResult => ({ kind: 'unknown', code })

/** The sentence at the till when a typed or keyboard-scanner code is not in the store (Enter in the search field). */
export const unknownTypedText = (code: string) => `Barcode ${code} belum ada di toko Anda.`

/** Enter in the till's search field is a barcode lookup only when the grid found nothing and the text is one token. */
export function looksLikeTypedBarcode(raw: string, gridMatches: number): boolean {
  const t = raw.trim()
  return gridMatches === 0 && t.length >= 4 && t.length <= MAX_CODE_LENGTH && !/\s/.test(t)
}
