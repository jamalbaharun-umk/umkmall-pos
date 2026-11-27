import { describe, expect, it } from 'vitest'
import { checkExpiry } from '../routes/pembelian/-validate'
import { expiringFooter, expiryText, formatDay } from './expiry'

describe('expiry wording (UMK-2087)', () => {
  it('writes a store day without a timezone shift', () => {
    expect(formatDay('2026-12-05')).toBe('5 Des 2026')
    expect(formatDay('2027-01-01')).toBe('1 Jan 2027')
    expect(formatDay('')).toBe('')
  })

  it('says how far the date is, in whole days', () => {
    expect(expiryText(-3)).toBe('Kedaluwarsa 3 hari lalu')
    expect(expiryText(-1)).toBe('Kedaluwarsa kemarin')
    expect(expiryText(0)).toBe('Kedaluwarsa hari ini')
    expect(expiryText(1)).toBe('Kedaluwarsa besok')
    expect(expiryText(12)).toBe('Kedaluwarsa 12 hari lagi')
  })

  it('footer counts every product, not only the rows shown', () => {
    expect(expiringFooter(3, 3, 30)).toBe('3 produk kedaluwarsa dalam 30 hari.')
    expect(expiringFooter(12, 5, 30)).toBe('Menampilkan 5 dari 12 produk yang kedaluwarsa dalam 30 hari.')
  })

  it('an empty date is fine, a filled one must be a real day', () => {
    expect(checkExpiry('')).toBeUndefined()
    expect(checkExpiry(undefined)).toBeUndefined()
    expect(checkExpiry('2026-12-05')).toBeUndefined()
    expect(checkExpiry('2026-02-31')).toBe('Tanggal kedaluwarsa tidak valid')
    expect(checkExpiry('05-12-2026')).toBe('Tanggal kedaluwarsa tidak valid')
  })
})
