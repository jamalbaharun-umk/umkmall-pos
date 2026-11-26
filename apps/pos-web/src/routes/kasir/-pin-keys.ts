// The hardware keyboard for the PIN keypad of the sign-in screen (UMK-2058): digits, Backspace, Enter.
// Pure so it is unit-tested; the screen only feeds it the key event.

export type PinKey = 'hapus' | 'masuk' | `${number}`

type KeyInfo = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; repeat?: boolean; target?: { tagName?: string } | null }

/**
 * Which keypad key a keyboard event stands for, or null when the keypad must ignore it: a shortcut (Ctrl/Cmd/Alt),
 * a held key (Backspace may repeat to clear, a digit or Enter may not), and Enter or Space on a focused button or
 * link, where the browser clicks it already (taking Enter as well would press the key twice, or sign in twice).
 */
export function pinKeyOf(e: KeyInfo): PinKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  const tag = (e.target?.tagName ?? '').toUpperCase()
  if (/^\d$/.test(e.key)) return e.repeat ? null : (e.key as PinKey)
  if (e.key === 'Backspace') return 'hapus'
  if (e.key === 'Enter') return e.repeat || tag === 'BUTTON' || tag === 'A' ? null : 'masuk'
  return null
}
