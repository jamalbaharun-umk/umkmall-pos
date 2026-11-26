import { describe, expect, it } from 'vitest'
import { describeError } from '../../lib/describe-error'
import { cardLine, customerLine, emptyState, exportFailure, parseFilter, shortDate, statusLabel } from './-kasbon'

const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`

// shortDate joins day and month with a no-break space; the tests write it as a plain one.
const plain = (s: string) => s.replace(/\u00a0/g, ' ')

describe('kasbon report wording (UMK-1964)', () => {
  it('words the store-day status pos-api computed', () => {
    expect(statusLabel({ status: 'due', overdueDays: 12 })).toBe('Terlambat 12 hari')
    expect(statusLabel({ status: 'due', overdueDays: 1 })).toBe('Terlambat 1 hari')
    expect(statusLabel({ status: 'due', overdueDays: 0 })).toBe('Jatuh tempo hari ini')
    expect(statusLabel({ status: 'not_due', overdueDays: null })).toBe('Belum jatuh tempo')
  })

  it('shows store dates as day and month, without a timezone shift', () => {
    expect(plain(shortDate('2026-11-14'))).toBe('14 Nov')
    expect(plain(shortDate('2026-12-01'))).toBe('1 Des')
    expect(plain(shortDate('2027-01-31'))).toBe('31 Jan')
    expect(shortDate(null)).toBe('–')
    expect(shortDate('14/11')).toBe('–')
  })

  it('summarises a customer as in the design', () => {
    expect(plain(customerLine({ kasbonCount: 2, oldestDueDate: '2026-11-14' }))).toBe('2 kasbon · jatuh tempo terlama 14 Nov')
    expect(plain(customerLine({ kasbonCount: 1, oldestDueDate: '2026-11-23' }))).toBe('1 kasbon · jatuh tempo 23 Nov')
    expect(customerLine({ kasbonCount: 1, oldestDueDate: null })).toBe('1 kasbon · tanpa jatuh tempo')
  })

  it('reads the filter from the address, anything unknown is Semua', () => {
    expect(parseFilter('due')).toBe('due')
    expect(parseFilter('not_due')).toBe('not_due')
    expect(parseFilter('late')).toBe('all')
    expect(parseFilter(undefined)).toBe('all')
  })

  it('tells an empty store from an empty filter', () => {
    expect(emptyState('all', 0)).toMatchObject({ title: 'Belum ada kasbon', showAll: false })
    expect(emptyState('due', 0)).toMatchObject({ title: 'Belum ada kasbon', showAll: false })
    expect(emptyState('due', 3)).toMatchObject({ title: 'Tidak ada pelanggan yang jatuh tempo.', showAll: true })
    expect(emptyState('not_due', 3)).toMatchObject({ showAll: true })
  })

  it('the dashboard card line', () => {
    expect(cardLine({ customers: 4, dueRest: 2_053_500 }, rupiah)).toBe('4 pelanggan · Rp2.053.500 jatuh tempo')
    expect(cardLine({ customers: 0, dueRest: 0 }, rupiah)).toBe('Tidak ada kasbon yang belum dibayar')
  })

  it('an export over the row limit gets the design dialog text and its code', () => {
    const d = describeError(exportFailure(422, { code: 'EXPORT_TOO_LARGE', message: 'x' }), 'fallback')
    expect(d).toEqual({
      what: 'Laporan terlalu besar untuk satu file (lebih dari 10.000 baris).',
      todo: 'Persempit pilihan atau pilih satu pelanggan, lalu ekspor lagi.',
      code: 'EXPORT_TOO_LARGE',
      primary: 'none',
    })
    expect(describeError(exportFailure(403, { message: 'Anda tidak punya izin melihat laporan.' }), 'f').code).toBe('403')
    expect(exportFailure(0, null)).toEqual({ status: 0, error: undefined })
    // A proxy's text on a 500 is never shown.
    expect(exportFailure(500, { message: 'stack trace' }).error).toBeUndefined()
  })
})
