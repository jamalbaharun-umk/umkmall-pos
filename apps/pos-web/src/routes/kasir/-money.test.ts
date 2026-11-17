import { describe, expect, it } from 'vitest'
import { numpadEdit, parseRupiah, quickAmounts, taxOf } from './-money'

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
  it('numpad: appends digits and 000 without leading zeros, ⌫ deletes, caps the length', () => {
    expect(['5', '000'].reduce(numpadEdit, '')).toBe('5000')
    expect(['0', '0', '7'].reduce(numpadEdit, '')).toBe('7')
    expect(numpadEdit('5000', 'hapus')).toBe('500')
    expect(numpadEdit('', 'hapus')).toBe('')
    expect(numpadEdit('9'.repeat(13), '1')).toHaveLength(13)
  })
})
