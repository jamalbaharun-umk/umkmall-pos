import { describe, expect, it } from 'vitest'
import { discountError, numpadEdit, parseRupiah, qtyError, quickAmounts, taxOf } from './-money'

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
    expect(parseRupiah('1.250.000')).toBe(1_250_000)
    expect(Number.isNaN(parseRupiah('5,5'))).toBe(true)
    expect(Number.isNaN(parseRupiah('1.5'))).toBe(true) // not 15
    expect(Number.isNaN(parseRupiah('2.00'))).toBe(true)
    expect(Number.isNaN(parseRupiah('20.0000'))).toBe(true)
    expect(Number.isNaN(parseRupiah(''))).toBe(true)
  })
  it('numpad: appends digits and 000 without leading zeros, ⌫ deletes, caps the length', () => {
    expect(['5', '000'].reduce(numpadEdit, '')).toBe('5000')
    expect(['0', '0', '7'].reduce(numpadEdit, '')).toBe('7')
    expect(numpadEdit('5000', 'hapus')).toBe('500')
    expect(numpadEdit('', 'hapus')).toBe('')
    expect(numpadEdit('9'.repeat(13), '1')).toHaveLength(13)
  })
  it('cart qty: only a whole number 1–100.000 is applied ("1.5" is not 15)', () => {
    expect(qtyError('3')).toBeUndefined()
    expect(qtyError('1.5')).toBe('Harus bilangan bulat')
    expect(qtyError('')).toBe('Wajib diisi')
    expect(qtyError('0')).toBe('Minimal 1')
    expect(qtyError('100001')).toBe('Maksimal 100.000')
  })
  it('order discount: whole rupiah, not negative, not above the subtotal', () => {
    expect(discountError('', 4000)).toBeUndefined()
    expect(discountError('500', 4000)).toBeUndefined()
    expect(discountError('4.000', 4000)).toBeUndefined()
    expect(discountError('-500', 4000)).toBe('Diskon tidak boleh negatif')
    expect(discountError('1.5', 4000)).toBe('Harus bilangan bulat rupiah, misalnya 5.000')
    expect(discountError('4001', 4000)).toBe('Diskon melebihi subtotal')
  })
  it('the U7 case: 2 × Rp2.000, discount Rp500, voucher 10 %, tax 10 % → Rp3.465 (as pos-api)', () => {
    const subtotal = 4000
    const discount = 500
    const voucher = Math.floor(((subtotal - discount) * 10) / 100) // 350, computed by pos-api /vouchers/check
    const taxable = subtotal - discount - voucher
    expect(taxable + taxOf(taxable, 1000)).toBe(3465)
  })
})
