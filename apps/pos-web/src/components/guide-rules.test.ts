import { describe, expect, it } from 'vitest'
import { blocksGuide } from './guide-rules'

describe('guide rules (UMK-2134)', () => {
  const doc = (match: string | null) => ({ querySelector: (s: string) => (match && s.includes(match) ? {} : null) }) as never

  it('hides the guide while a dialog, a payment sheet or a PIN entry is open', () => {
    expect(blocksGuide(doc('[role="dialog"]'))).toBe(true)
    expect(blocksGuide(doc('[role="alertdialog"]'))).toBe(true)
    expect(blocksGuide(doc('[autocomplete="one-time-code"]'))).toBe(true)
    expect(blocksGuide(doc(null))).toBe(false)
  })

})
