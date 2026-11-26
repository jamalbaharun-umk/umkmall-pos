import { describe, expect, it } from 'vitest'
import { cashRounding } from './-money'
import {
  approvalBps,
  breakdown,
  discountFields,
  discountLabel,
  discountOf,
  discountTextError,
  discountToast,
  lineDiscountState,
  needsApproval,
  percentText,
  pruneDiscounts,
  receiptDiscounts,
  soldDiscountLabel,
  type LineDiscount,
} from './-discount'

describe('line discount (UMK-1990)', () => {
  it('computes like pos-api: an amount as given, a percent half up on the line total', () => {
    expect(discountOf(20_000, { kind: 'percent', value: 10 })).toBe(2000)
    expect(discountOf(9999, { kind: 'percent', value: 15 })).toBe(1500) // 1.499,85
    expect(discountOf(9999, { kind: 'percent', value: 5 })).toBe(500) // 499,95
    expect(discountOf(50, { kind: 'percent', value: 1 })).toBe(1) // 0,5
    expect(discountOf(49, { kind: 'percent', value: 1 })).toBe(0)
    expect(discountOf(20_000, { kind: 'amount', value: 999 })).toBe(999)
  })

  it('refuses what pos-api refuses: empty, not whole, 100% or the whole line, more than the line', () => {
    expect(discountTextError('percent', '10', 20_000)).toBeUndefined()
    expect(discountTextError('amount', '2.000', 20_000)).toBeUndefined()
    expect(discountTextError('percent', '', 20_000)).toBe('Wajib diisi')
    expect(discountTextError('percent', '10.5', 20_000)).toBe('Isi persen bilangan bulat, misalnya 10')
    expect(discountTextError('amount', '1.5', 20_000)).toBe('Harus bilangan bulat rupiah, misalnya 2.000')
    expect(discountTextError('percent', '0', 20_000)).toBe('Diskon minimal 1%')
    expect(discountTextError('percent', '100', 20_000)).toBe('Diskon 100% tidak diperbolehkan untuk satu baris')
    expect(discountTextError('amount', '20.000', 20_000)).toBe('Diskon 100% tidak diperbolehkan untuk satu baris')
    expect(discountTextError('amount', '20001', 20_000)).toBe('Diskon melebihi harga baris')
    expect(discountTextError('amount', '-5', 20_000)).toBe('Diskon tidak boleh negatif')
    // 99% of Rp1 rounds to the whole line
    expect(discountTextError('percent', '99', 1)).toBe('Diskon 100% tidak diperbolehkan untuk satu baris')
  })

  it('more than 30% needs a PIN; the approval covers the share rounded up', () => {
    expect(needsApproval(6000, 20_000)).toBe(false)
    expect(needsApproval(6001, 20_000)).toBe(true)
    expect(approvalBps(8000, 20_000)).toBe(4000)
    expect(approvalBps(8001, 20_000)).toBe(4001) // 40,005% → 4001
    expect(percentText(8000, 20_000)).toBe('40%')
  })

  it('a discount that no longer fits its line (quantity changed) is a problem, not sent', () => {
    const amount: LineDiscount = { kind: 'amount', value: 6000 }
    expect(lineDiscountState(20_000, amount)).toEqual({ discount: 6000, netTotal: 14_000 })
    // 2 items instead of 4: Rp6.000 of Rp10.000 is 60%, above 30% without an approval
    expect(lineDiscountState(10_000, amount).problem).toMatch(/PIN admin lagi/)
    expect(lineDiscountState(5000, amount)).toMatchObject({ discount: 0, netTotal: 5000, problem: expect.stringMatching(/melebihi/) })
    const approved: LineDiscount = { kind: 'percent', value: 40, approval: { id: 'a', maxBps: 4000, approverName: 'Rina' } }
    // a percent keeps its share at any quantity
    expect(lineDiscountState(20_000, approved)).toEqual({ discount: 8000, netTotal: 12_000 })
    expect(lineDiscountState(5000, approved)).toEqual({ discount: 2000, netTotal: 3000 })
    expect(lineDiscountState(20_000, undefined)).toEqual({ discount: 0, netTotal: 20_000 })
  })

  it('builds the request fields; the quote takes no approval', () => {
    const d: LineDiscount = { kind: 'percent', value: 40, approval: { id: 'ap', maxBps: 4000, approverName: 'Rina' } }
    expect(discountFields(d, true)).toEqual({ discountPercent: 40, discountApprovalId: 'ap' })
    expect(discountFields(d, false)).toEqual({ discountPercent: 40 })
    expect(discountFields({ kind: 'amount', value: 2000 }, true)).toEqual({ discountAmount: 2000 })
    expect(discountFields(undefined, true)).toEqual({})
  })

  it('words the line and the toast', () => {
    expect(discountLabel({ kind: 'percent', value: 10 })).toBe('diskon 10%')
    expect(discountLabel({ kind: 'amount', value: 2000 })).toBe('diskon Rp2.000')
    expect(discountToast('Teh Botol', { kind: 'percent', value: 10 })).toBe('Diskon 10% diterapkan pada Teh Botol')
  })

  it('keeps only the discounts of lines still in the cart', () => {
    const all = { a: { kind: 'percent' as const, value: 10 }, b: { kind: 'amount' as const, value: 5 } }
    expect(pruneDiscounts(all, ['a', 'b'])).toBe(all)
    expect(pruneDiscounts(all, ['b'])).toEqual({ b: all.b })
  })

  it('the design breakdown, in order: line discount, voucher, tax after both, cash rounding last', () => {
    const b = breakdown({ subtotal: 50_000, lineDiscount: 2000, voucherDiscount: 3000, taxBps: 1100 })
    expect(b).toEqual({ afterDiscount: 45_000, tax: 4950, total: 49_950 })
    expect(cashRounding(b.total)).toBe(50)
  })

  it('the receipt: the line note and the split of the sale discount', () => {
    expect(soldDiscountLabel({ discount: 2000, discountPercent: 10 })).toBe('Diskon 10%')
    expect(soldDiscountLabel({ discount: 999, discountPercent: null })).toBe('Diskon')
    expect(soldDiscountLabel({ discount: 0, discountPercent: null })).toBeNull()
    expect(soldDiscountLabel({})).toBeNull()
    expect(receiptDiscounts({ discount: 2000, lineDiscount: 2000 })).toEqual({ lines: 2000, order: 0 })
    // a receipt from before line discounts: all of it was an order discount
    expect(receiptDiscounts({ discount: 5000 })).toEqual({ lines: 0, order: 5000 })
  })
})
