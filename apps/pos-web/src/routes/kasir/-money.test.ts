import { describe, expect, it } from 'vitest'
import { parseRupiah, quickAmounts, taxOf } from './-money'

describe('cashier money helpers', () => {
  it('quick amounts: exact, then the next round notes', () => {
    expect(quickAmounts(15_000)).toEqual([15_000, 20_000, 50_000, 100_000])
    expect(quickAmounts(12_500)).toEqual([12_500, 15_000, 20_000, 50_000, 100_000])
    expect(quickAmounts(100_000)).toEqual([100_000])
  })
  it('tax matches pos-api: half up on the taxable amount', () => {
    expect(taxOf(10_000, 1000)).toBe(1000)
    expect(taxOf(5, 1000)).toBe(1) // 0.5 → 1
    expect(taxOf(4, 1000)).toBe(0)
  })
  it('parses typed rupiah', () => {
    expect(parseRupiah('20.000')).toBe(20_000)
    expect(parseRupiah(' 5000 ')).toBe(5000)
    expect(Number.isNaN(parseRupiah('5,5'))).toBe(true)
    expect(Number.isNaN(parseRupiah(''))).toBe(true)
  })
})
