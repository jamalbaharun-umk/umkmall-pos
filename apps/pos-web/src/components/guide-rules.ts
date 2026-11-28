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
