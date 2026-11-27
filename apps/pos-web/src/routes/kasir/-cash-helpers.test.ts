import { describe, expect, it } from 'vitest'
import {
  cashFormErrors,
  cashToast,
  drawerAfter,
  drawerPreview,
  manualEntries,
  signedRupiah,
  withCode,
  type CashReasons,
} from './-cash-helpers'

const reasons: CashReasons = {
  in: [
    { reason: 'tambah_modal', label: 'Tambah modal laci', noteRequired: false },
    { reason: 'lainnya', label: 'Lainnya', noteRequired: true },
  ],
  out: [
    { reason: 'setor_bank', label: 'Setor ke bank', noteRequired: false },
    { reason: 'lainnya', label: 'Lainnya', noteRequired: true },
  ],
}
const form = { direction: 'out' as const, amount: 500_000, reason: 'setor_bank', note: '' }

describe('cashFormErrors', () => {
  it('accepts a cash-out up to exactly the drawer cash', () => {
    expect(cashFormErrors({ ...form, amount: 1_390_000 }, reasons, 1_390_000)).toEqual({})
  })
  it('refuses a cash-out above the drawer cash, naming the limit', () => {
    expect(cashFormErrors({ ...form, amount: 1_390_001 }, reasons, 1_390_000).amount).toBe(
      'Jumlah lebih besar dari uang di laci (Rp1.390.000)',
    )
  })
  it('never lets a cash-in hit the drawer limit', () => {
    expect(cashFormErrors({ ...form, direction: 'in', reason: 'tambah_modal', amount: 9_000_000 }, reasons, 10)).toEqual(
      {},
    )
  })
  it('needs an amount above 0 and a reason of this direction', () => {
    expect(cashFormErrors({ ...form, amount: 0 }, reasons, 100).amount).toBe('Harus lebih dari Rp0')
    expect(cashFormErrors({ ...form, reason: 'tambah_modal' }, reasons, 1_000_000).reason).toBe('Pilih salah satu alasan')
    expect(cashFormErrors({ ...form, reason: '' }, reasons, 1_000_000).reason).toBe('Pilih salah satu alasan')
  })
  it('Lainnya needs a note, a blank one does not count', () => {
    expect(cashFormErrors({ ...form, reason: 'lainnya', note: '  ' }, reasons, 1_000_000).note).toBe(
      'Catatan wajib diisi untuk alasan Lainnya',
    )
    expect(cashFormErrors({ ...form, reason: 'lainnya', note: 'tukar receh' }, reasons, 1_000_000)).toEqual({})
  })
  it('an empty drawer refuses any cash-out with a Rp0 limit', () => {
    expect(cashFormErrors({ ...form, amount: 1 }, reasons, -50).amount).toContain('(Rp0)')
  })
})

describe('drawer figures', () => {
  it('moves the drawer by the amount, and says nothing before an amount', () => {
    expect(drawerAfter('in', 200_000, 1_390_000)).toBe(1_590_000)
    expect(drawerAfter('out', 500_000, 1_390_000)).toBe(890_000)
    expect(drawerAfter('out', 0, 1_390_000)).toBeUndefined()
    expect(drawerPreview('out', 500_000, 1_390_000)).toBe('Uang di laci langsung berkurang Rp500.000, tersisa Rp890.000.')
    expect(drawerPreview('in', 200_000, 1_390_000)).toBe('Uang di laci bertambah Rp200.000, menjadi Rp1.590.000.')
  })
  it('words the success toast with the server figures', () => {
    expect(
      cashToast({ direction: 'out', amount: 500_000, reasonLabel: 'Setor ke bank', drawerCashAfter: 890_000 }),
    ).toBe('Uang Rp500.000 diambil dari laci (Setor ke bank). Sisa Rp890.000')
    expect(cashToast({ direction: 'in', amount: 200_000, reasonLabel: 'Tambah modal laci', drawerCashAfter: 1_590_000 })).toBe(
      'Uang Rp200.000 ditambahkan ke laci (Tambah modal laci). Uang di laci Rp1.590.000',
    )
  })
  it('signs the list amounts', () => {
    expect(signedRupiah('in', 200_000)).toBe('+Rp200.000')
    expect(signedRupiah('out', 500_000)).toBe('−Rp500.000')
  })
})

describe('withCode', () => {
  it('codes a refused amount and a missing shift, leaves other failures alone', () => {
    expect(withCode({ status: 422, error: 'x', errors: { amount: 'y' } }).code).toBe('DRAWER_INSUFFICIENT')
    expect(withCode({ status: 422, error: 'Buka shift dulu untuk mencatat kas masuk atau keluar' }).code).toBe(
      'SHIFT_REQUIRED',
    )
    expect(withCode({ status: 500, error: 'x', errors: { amount: 'y' } }).code).toBeUndefined()
    expect(withCode({ status: 0, error: '' }).code).toBeUndefined()
  })
})

describe('manualEntries', () => {
  it('keeps only manual kinds, newest first', () => {
    const rows = [
      { kind: 'receivable_payment', createdAt: '2026-11-25T03:00:00Z' },
      { kind: 'manual_in', createdAt: '2026-11-25T02:30:00Z' },
      { kind: 'manual_out', createdAt: '2026-11-25T04:00:00Z' },
    ]
    expect(manualEntries(rows).map((r) => r.kind)).toEqual(['manual_out', 'manual_in'])
  })
  it('also lists a collector deposit the drawer received', () => {
    const rows = [
      { kind: 'manual_in', createdAt: '2026-11-25T02:30:00Z' },
      { kind: 'collector_deposit', createdAt: '2026-11-25T05:00:00Z' },
    ]
    expect(manualEntries(rows).map((r) => r.kind)).toEqual(['collector_deposit', 'manual_in'])
  })
  it('also lists supplier payments and supplier refunds through the drawer, and their reversals (UMK-2083)', () => {
    const rows = [
      { kind: 'purchase_payment', createdAt: '2026-11-25T01:00:00Z' },
      { kind: 'purchase_payment_reversal', createdAt: '2026-11-25T02:00:00Z' },
      { kind: 'purchase_refund', createdAt: '2026-11-25T03:00:00Z' },
      { kind: 'purchase_refund_reversal', createdAt: '2026-11-25T04:00:00Z' },
      { kind: 'expense', createdAt: '2026-11-25T05:00:00Z' },
    ]
    expect(manualEntries(rows).map((r) => r.kind)).toEqual([
      'purchase_refund_reversal',
      'purchase_refund',
      'purchase_payment_reversal',
      'purchase_payment',
    ])
  })
})
