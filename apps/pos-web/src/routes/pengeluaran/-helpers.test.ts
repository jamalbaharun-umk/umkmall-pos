import { describe, expect, it } from 'vitest'
import {
  amountError,
  asPeriod,
  barPercent,
  dayLabel,
  describeChanges,
  exceedsDrawer,
  formatAmountInput,
  groupByDate,
  parseAmount,
  periodNoun,
  profitChangeText,
  rupiah,
  sourceLabel,
  timeLabel,
} from './-helpers'

describe('period', () => {
  it('reads a period from the URL and falls back to today', () => {
    expect(asPeriod('week')).toBe('week')
    expect(asPeriod('month')).toBe('month')
    expect(asPeriod('year')).toBe('today')
    expect(asPeriod(undefined)).toBe('today')
    expect(periodNoun('week')).toBe('minggu ini')
  })
})

describe('amount input', () => {
  it('groups digits by thousands and drops everything else', () => {
    expect(formatAmountInput('45000')).toBe('45.000')
    expect(formatAmountInput('Rp 1.250.000')).toBe('1.250.000')
    expect(formatAmountInput('007')).toBe('7')
    expect(formatAmountInput('abc')).toBe('')
  })
  it('parses the grouped text to integer rupiah', () => {
    expect(parseAmount('45.000')).toBe(45000)
    expect(parseAmount('')).toBe(0)
  })
  it('asks for more than zero', () => {
    expect(amountError(0)).toBe('Harus lebih dari 0')
    expect(amountError(1)).toBeUndefined()
  })
  it('formats rupiah and names the sources', () => {
    expect(rupiah(1_390_000)).toBe('Rp1.390.000')
    expect(sourceLabel('drawer')).toBe('Dari laci')
    expect(sourceLabel('outside')).toBe('Di luar laci')
  })
})

describe('exceedsDrawer', () => {
  it('warns only for a drawer expense above the expected cash', () => {
    expect(exceedsDrawer('drawer', 1_400_000, 1_390_000)).toBe(true)
    expect(exceedsDrawer('drawer', 1_390_000, 1_390_000)).toBe(false)
    expect(exceedsDrawer('outside', 9_000_000, 1_390_000)).toBe(false)
    expect(exceedsDrawer('drawer', 9_000_000, null)).toBe(false)
  })
})

describe('groupByDate', () => {
  it('groups consecutive rows by date, totalling live rows only', () => {
    const rows = [
      { date: '2026-11-24', amount: 120_000 },
      { date: '2026-11-24', amount: 65_000 },
      { date: '2026-11-23', amount: 30_000 },
      { date: '2026-11-23', amount: 5_000, voidedAt: '2026-11-24T01:00:00Z' },
    ]
    expect(groupByDate(rows).map((x) => [x.date, x.rows.length, x.total])).toEqual([
      ['2026-11-24', 2, 185_000],
      ['2026-11-23', 2, 30_000],
    ])
    expect(groupByDate([])).toEqual([])
  })
})

describe('labels', () => {
  it('writes the day in Indonesian', () => {
    expect(dayLabel('2026-11-24')).toBe('Selasa, 24 Nov')
  })
  it('writes the time in the store timezone', () => {
    expect(timeLabel('2026-11-24T03:12:00Z', 'Asia/Jakarta')).toBe('10.12')
    expect(timeLabel('2026-11-24T03:12:00Z', 'Asia/Makassar')).toBe('11.12')
  })
  it('scales bars to the largest value', () => {
    expect(barPercent(400_000, 400_000)).toBe(100)
    expect(barPercent(240_000, 400_000)).toBe(60)
    expect(barPercent(5, 0)).toBe(0)
  })
  it('describes an edit field by field', () => {
    expect(
      describeChanges(
        { amount: { from: 10_000, to: 12_000 }, note: { from: null, to: 'token' }, category: { from: 'sewa', to: 'gaji' } },
        { sewa: 'Sewa', gaji: 'Gaji' },
      ),
    ).toEqual(['Kategori: Sewa menjadi Gaji', 'Jumlah: Rp10.000 menjadi Rp12.000', 'Catatan: (kosong) menjadi token'])
  })
  it('says how net profit moved', () => {
    expect(profitChangeText(50_000, 'month')).toBe('Naik Rp50.000 dari bulan lalu pada waktu yang sama')
    expect(profitChangeText(-1_000, 'today')).toBe('Turun Rp1.000 dari kemarin pada waktu yang sama')
    expect(profitChangeText(0, 'week')).toBe('Sama dengan minggu lalu pada waktu yang sama')
  })
})
