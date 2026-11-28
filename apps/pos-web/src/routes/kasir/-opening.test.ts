import { describe, expect, it } from 'vitest'
import { openingToast, showOpeningCard } from './-opening'

describe('the automatic opening card (design 40 screen 7)', () => {
  it('shows only for a shift that opened by itself and was not checked yet', () => {
    expect(showOpeningCard({ openedAutomatically: true, openingCheckedAt: null })).toBe(true)
    expect(showOpeningCard({ openedAutomatically: true, openingCheckedAt: '2026-11-28T01:00:00Z' })).toBe(false)
    expect(showOpeningCard({ openedAutomatically: false, openingCheckedAt: null })).toBe(false)
    // an older pos-api answers neither field
    expect(showOpeningCard({})).toBe(false)
    expect(showOpeningCard(null)).toBe(false)
  })

  it('names what happened', () => {
    expect(openingToast(50000)).toBe('Modal awal sudah dicek')
    expect(openingToast(50000, 50000)).toBe('Modal awal sudah dicek')
    expect(openingToast(50000, 30000)).toBe('Modal awal dibetulkan jadi Rp30.000')
  })
})
