import { describe, expect, it } from 'vitest'
import { closeDayToast, drawerDifferenceText, openedBeforeToday, storeDayText, summaryText, summaryUrl, takeOf } from './-close-day'

describe('Tutup hari helpers (UMK-2122)', () => {
  it('names the store day in Jakarta time', () => {
    expect(storeDayText('2026-11-26T10:00:00Z')).toBe('Kamis, 26 Nov 2026')
    // 23:30 UTC on the 25th is already the 26th in Jakarta
    expect(storeDayText('2026-11-25T23:30:00Z')).toBe('Kamis, 26 Nov 2026')
  })

  it('offers "Tutup kemarin dulu" only for a shift opened on an earlier store day', () => {
    const now = new Date('2026-11-26T02:00:00Z') // 09:00 in Jakarta
    expect(openedBeforeToday('2026-11-25T12:00:00Z', now)).toBe(true)
    expect(openedBeforeToday('2026-11-25T18:00:00Z', now)).toBe(false) // 01:00 on the 26th in Jakarta
    expect(openedBeforeToday('2026-11-26T01:00:00Z', now)).toBe(false)
  })

  it('checks the amount taken against the count', () => {
    expect(takeOf('keep', 'abc', 1000)).toEqual({ amount: 0 })
    expect(takeOf('take', '685.000', 1_185_000)).toEqual({ amount: 685_000 })
    expect(takeOf('take', '', 1000).error).toBe('Isi jumlah yang diambil')
    expect(takeOf('take', '1,5', 1000).error).toMatch(/bilangan bulat/)
    expect(takeOf('take', '0', 1000).error).toMatch(/lebih dari 0/)
    expect(takeOf('take', '2000', 1000).error).toBe('Lebih besar dari uang di laci (Rp1.000)')
  })

  it('words the drawer difference and the toast', () => {
    expect(drawerDifferenceText(0)).toBe('Selisih laci Rp0')
    expect(drawerDifferenceText(-1000)).toBe('Laci kurang Rp1.000')
    expect(drawerDifferenceText(500)).toBe('Laci lebih Rp500')
    expect(closeDayToast(0)).toBe('Hari ditutup. Selisih laci Rp0')
  })

  it('writes a WhatsApp summary of figures only', () => {
    const d = { openedAt: '2026-11-26T01:00:00Z', revenue: 1_350_000, grossProfit: 540_000, counted: 1_185_000, taken: 685_000, difference: 0 }
    expect(summaryText(d)).toBe(
      [
        'Tutup hari Kamis, 26 Nov 2026',
        'Penjualan: Rp1.350.000',
        'Untung (tanpa pajak): Rp540.000',
        'Uang di laci: Rp1.185.000',
        'Diambil pemilik: Rp685.000',
        'Uang awal besok: Rp500.000',
        'Selisih laci Rp0',
      ].join('\n'),
    )
    expect(summaryText({ ...d, taken: 0 })).not.toContain('Diambil pemilik')
    expect(summaryUrl(d).startsWith('https://wa.me/?text=Tutup%20hari')).toBe(true)
  })
})
