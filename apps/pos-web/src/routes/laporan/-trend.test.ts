import { describe, expect, it } from 'vitest'
import { asMetric, asScale, changeWord, comparison, hasNext, isEmptyReport, shiftAnchor, visibleVisual, type TrendReport } from './-trend'
import type { BarsVisual } from './-visuals'

describe('shiftAnchor', () => {
  it('moves a whole window of days', () => {
    expect(shiftAnchor('day', '2026-11-26', 7, -1)).toBe('2026-11-19')
    expect(shiftAnchor('day', '2026-11-19', 7, 1)).toBe('2026-11-26')
    expect(shiftAnchor('day', '2026-03-03', 7, -1)).toBe('2026-02-24')
  })
  it('moves months across a year end and years', () => {
    expect(shiftAnchor('month', '2026-02-14', 6, -1)).toBe('2025-08-01')
    expect(shiftAnchor('month', '2025-08-01', 6, 1)).toBe('2026-02-01')
    expect(shiftAnchor('year', '2026-11-26', 3, -1)).toBe('2023-01-01')
  })
})

describe('wording', () => {
  it('says naik, turun or tetap, and nothing without a base', () => {
    expect(changeWord(8)).toBe('naik 8%')
    expect(changeWord(-12)).toBe('turun 12%')
    expect(changeWord(0)).toBe('tetap')
    expect(changeWord(null)).toBeNull()
  })
  it('writes the design sentence', () => {
    const r = { change: { sales: 8, expenses: -12 }, previous: { periodLabel: '13 sampai 19 Nov' } } as Pick<TrendReport, 'change' | 'previous'>
    expect(comparison(r)).toBe('Penjualan naik 8% dari 13 sampai 19 Nov. Pengeluaran turun 12%.')
    expect(comparison({ change: { sales: null, expenses: null }, previous: r.previous })).toMatch(/Belum ada data/)
  })
})

describe('window and metric', () => {
  it('has a next window only before today', () => {
    expect(hasNext({ to: '2026-11-19', today: '2026-11-26' })).toBe(true)
    expect(hasNext({ to: '2026-11-26', today: '2026-11-26' })).toBe(false)
  })
  it('falls back to the safe choices for a bad URL', () => {
    expect(asScale('week')).toBe('day')
    expect(asScale('year')).toBe('year')
    expect(asMetric('x')).toBe('both')
    expect(asMetric('sales')).toBe('sales')
  })
  const v: BarsVisual = {
    id: 'p',
    kind: 'bars',
    title: 'Penjualan dan pengeluaran per hari',
    unit: 'rupiah',
    orientation: 'vertical',
    categories: ['Rab', 'Kam'],
    series: [
      { label: 'Penjualan', values: [1, 2], color: 1 },
      { label: 'Pengeluaran', values: [3, 4], color: 2 },
    ],
  }
  it('shows one series without recolouring it', () => {
    const e = visibleVisual(v, 'expenses')
    expect(e.series).toEqual([{ label: 'Pengeluaran', values: [3, 4], color: 2 }])
    expect(e.title).toBe('Pengeluaran per hari')
    expect(visibleVisual(v, 'both')).toBe(v)
  })
  it('knows an empty report', () => {
    const zero = { totals: { sales: 0, expenses: 0 }, buckets: [{ sales: 0, expenses: 0 }] } as Pick<TrendReport, 'totals' | 'buckets'>
    expect(isEmptyReport(zero)).toBe(true)
    expect(isEmptyReport({ totals: { sales: 1, expenses: 0 }, buckets: zero.buckets } as Pick<TrendReport, 'totals' | 'buckets'>)).toBe(false)
  })
})
