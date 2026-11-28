import { describe, expect, it } from 'vitest'
import { showCashier } from './solo'

describe('showCashier', () => {
  it('always shows the cashier outside solo-owner mode', () => {
    expect(showCashier(false, ['Pemilik'])).toBe(true)
    expect(showCashier(false, [])).toBe(true)
  })
  it('hides it in solo-owner mode when every name is the owner', () => {
    expect(showCashier(true, ['Pemilik', 'Pemilik'])).toBe(false)
    expect(showCashier(true, [])).toBe(false)
  })
  it('keeps it in solo-owner mode when another name is there', () => {
    expect(showCashier(true, ['Pemilik', 'Agen UMKMall'])).toBe(true)
    expect(showCashier(true, ['Rina'])).toBe(true)
  })
})
