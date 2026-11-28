// UMK-2134: pure rules of the guide runtime, unit-tested without React.

export const LARGE_TEXT_KEY = 'pos.guide.largeText'

/**
 * A guide stays hidden while the person is in the middle of something: any open dialog (the payment sheet, a PIN
 * entry, an error, a form), or a focused one-time-code field.
 */
export function blocksGuide(doc: Pick<Document, 'querySelector'>): boolean {
  return Boolean(
    doc.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"], [autocomplete="one-time-code"]'),
  )
}

/** "Teks besar" is a per-device choice; a browser without storage reads it as off. */
export function readLargeText(): boolean {
  try {
    return localStorage.getItem(LARGE_TEXT_KEY) === '1'
  } catch {
    return false
  }
}

/** UMK-2124: a helper's guide progress lives on the device (a helper session reaches no guide progress in pos-api). */
export const DEVICE_GUIDES_KEY = 'pos.guide.device'

type Status = 'done' | 'skipped'

/** The guides marked on this device; an empty map without storage or for a value that is not ours. */
export function readDeviceProgress(storage: Pick<Storage, 'getItem'> | undefined): Map<string, Status> {
  try {
    const raw = JSON.parse(storage?.getItem(DEVICE_GUIDES_KEY) ?? '{}') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map()
    return new Map(
      Object.entries(raw).filter((e): e is [string, Status] => e[1] === 'done' || e[1] === 'skipped'),
    )
  } catch {
    return new Map()
  }
}

/** Marks a guide on this device; false when the browser keeps no storage (the mark lasts for this visit). */
export function writeDeviceProgress(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, key: string, status: Status): boolean {
  try {
    if (!storage) return false
    const all = Object.fromEntries(readDeviceProgress(storage))
    storage.setItem(DEVICE_GUIDES_KEY, JSON.stringify({ ...all, [key]: status }))
    return true
  } catch {
    return false
  }
}
