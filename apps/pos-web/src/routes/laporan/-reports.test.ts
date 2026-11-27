import { describe, expect, it } from 'vitest'
import { cashDiff, change, checkRange, REPORTS } from './-reports'

describe('change', () => {
  it('rounds the percentage and refuses a zero base', () => {
    expect(change(15_000, 10_000)).toBe(50)
    expect(change(5_000, 10_000)).toBe(-50)
    expect(change(1, 3)).toBe(-67)
    expect(change(100, 0)).toBeNull()
    expect(change(-50, -100)).toBe(50)
  })
})

describe('checkRange (mirrors pos-api DateRange)', () => {
  it('accepts a valid range up to 366 days', () => {
    expect(checkRange('2026-11-01', '2026-11-01')).toEqual({})
    expect(checkRange('2025-11-17', '2026-11-17')).toEqual({})
  })
  it('names each problem on its field, with the server’s words', () => {
    expect(checkRange('', '')).toEqual({ from: 'Tanggal mulai wajib diisi', to: 'Tanggal akhir wajib diisi' })
    expect(checkRange('2026-11-1', '2026-11-02')).toEqual({ from: 'Tanggal mulai harus berformat TTTT-BB-HH' })
    expect(checkRange('2026-02-30', '2026-03-01')).toEqual({ from: 'Tanggal mulai tidak ada di kalender' })
    expect(checkRange('2026-11-10', '2026-11-01')).toEqual({ to: 'Tanggal akhir tidak boleh sebelum tanggal mulai' })
    expect(checkRange('2025-11-16', '2026-11-17')).toEqual({ to: 'Rentang tanggal paling lama 366 hari' })
  })
})

describe('cashDiff', () => {
  it('words the drawer difference like the shift close screen (D16)', () => {
    expect(cashDiff(-500)).toBe('Kurang Rp500')
    expect(cashDiff(2500)).toBe('Lebih Rp2.500')
    expect(cashDiff(0)).toBe('Pas')
  })
})

describe('rounding in reports (UMK-1993)', () => {
  it('is its own total line, apart from revenue and profit, on sales, products and shift reports', () => {
    for (const k of ['penjualan', 'produk', 'shift']) {
      const keys = REPORTS[k].totals.map((t) => t.key)
      expect(keys).toContain('rounding')
      expect(REPORTS[k].totals.find((t) => t.key === 'rounding')).toMatchObject({ label: 'Pembulatan', money: true })
    }
    expect(REPORTS.pembelian.totals.map((t) => t.key)).not.toContain('rounding')
  })
  it('shows rounding per shift row', () => {
    expect(REPORTS.shift.columns.find((c) => c.key === 'rounding')).toMatchObject({ label: 'Pembulatan', money: true })
  })
})

describe('Laporan kasir columns (UMK-2088)', () => {
  it('shows the drawer in and out columns the checklist and the CSV have', () => {
    const keys = REPORTS.shift.columns.map((c) => c.key)
    expect(keys).toEqual(expect.arrayContaining(['receivablePayments', 'cashIn', 'cashOut']))
    expect(keys.indexOf('cashOut')).toBeLessThan(keys.indexOf('expectedCash'))
  })

  it('product report: Total penjualan is the sum of net rows, the discount is the order one', () => {
    const labels = Object.fromEntries(REPORTS.produk.totals.map((t) => [t.key, t.label]))
    expect(labels.netSales).toBe('Total penjualan')
    expect(labels.orderDiscount).toBe('Diskon pesanan')
    expect(labels.grossSales).toBeUndefined()
    expect(REPORTS.penjualan.totals.find((t) => t.key === 'grossSales')?.label).toBe('Penjualan kotor')
  })
})
