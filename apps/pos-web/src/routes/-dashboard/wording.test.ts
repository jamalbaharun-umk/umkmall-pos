import { describe, expect, it } from 'vitest'
import {
  CARD_ROWS,
  agingFooter,
  deltaOf,
  expensesFooter,
  lowStockFooter,
  mixParts,
  noComparison,
  peakText,
  periodInfo,
  topRows,
  trendIsEmpty,
  trendLabel,
} from './wording'

// Design feature 35 (UMK-1972): the words around the figures pos-api computed.
describe('dashboard widget wording', () => {
  it('labels a trend bucket by its store date, with no timezone shift', () => {
    // 2026-11-25 is a Wednesday.
    expect(trendLabel('today', '2026-11-25')).toBe('Rab')
    expect(trendLabel('today', '2026-11-22')).toBe('Min')
    expect(trendLabel('week', '2026-11-09')).toBe('9 Nov')
    expect(trendLabel('month', '2026-06-01')).toBe('Jun')
    expect(trendLabel('year', '2026-01-01')).toBe('2026')
    expect(trendLabel('today', 'bukan tanggal')).toBe('bukan tanggal')
  })

  it('words the change against the period before; nothing before is a hint, not a number', () => {
    expect(deltaOf('today', 23)).toEqual({ value: 23, unit: 'percent', label: 'dari kemarin' })
    expect(deltaOf('month', -4)).toEqual({ value: -4, unit: 'percent', label: 'dari bulan lalu' })
    expect(deltaOf('today', 5, 'count')).toEqual({ value: 5, unit: 'count', label: 'dari kemarin' })
    expect(deltaOf('year', 0)).toMatchObject({ value: 0 })
    expect(deltaOf('today', null)).toBeUndefined()
    expect(noComparison('week')).toBe('Belum ada data minggu lalu')
  })

  it('has a heading and a trend title for each period', () => {
    expect(periodInfo('today').heading).toBe('Penjualan hari ini')
    expect(periodInfo('today').trend).toBe('Penjualan 7 hari')
    expect(periodInfo('year').trend).toBe('Penjualan 3 tahun')
  })

  it('writes the busiest hour in full rupiah, or says there is none', () => {
    expect(peakText({ hour: 15, sales: 260_000 })).toBe('Paling ramai jam 15 (Rp260.000). Makin gelap makin ramai.')
    expect(peakText(null)).toBe('Belum ada penjualan hari ini.')
  })

  it('keeps only positive payment parts, in the server order', () => {
    const parts = [
      { name: 'Tunai', value: 620_000 },
      { name: 'Bon', value: 0 },
      { name: 'Retur', value: -5000 },
      { name: 'QRIS', value: 410_000 },
    ]
    expect(mixParts(parts).map((p) => p.name)).toEqual(['Tunai', 'QRIS'])
  })

  it('shows at most five rows and never reorders them', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(CARD_ROWS).toBe(5)
    expect(topRows(rows)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(topRows(['z', 'a'])).toEqual(['z', 'a'])
  })

  it('writes the footers of the money and stock cards with the server totals', () => {
    expect(agingFooter(2_703_500, 4)).toBe('Total Rp2.703.500 · 4 pelanggan.')
    expect(expensesFooter(4_600_000)).toBe('Total Rp4.600.000.')
    expect(lowStockFooter(3, 3)).toBe('3 produk perlu diisi.')
    expect(lowStockFooter(12, 5)).toBe('Menampilkan 5 dari 12 produk yang perlu diisi.')
  })

  it('a trend with only zero buckets is empty; one sale makes it a chart', () => {
    const zero = { sales: 0, salesCount: 0 }
    expect(trendIsEmpty([zero, zero, zero])).toBe(true)
    expect(trendIsEmpty([zero, { sales: 5000, salesCount: 1 }])).toBe(false)
    // A day that only has a void is not empty: its figures are real.
    expect(trendIsEmpty([zero, { sales: -5000, salesCount: -1 }])).toBe(false)
  })
})
