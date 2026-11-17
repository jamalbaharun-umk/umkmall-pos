import { describe, expect, it } from 'vitest'
import { change, checkRange } from './-reports'

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
