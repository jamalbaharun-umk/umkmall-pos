import { describe, expect, it } from 'vitest'
import { PERIOD_CSV_PATHS, periodCsvFailure, periodCsvFilename, periodCsvQuery } from './-csv'

describe('period CSV', () => {
  it('maps the two period screens to pos-api csv routes', () => {
    expect(PERIOD_CSV_PATHS['untung-rugi']).toBe('/reports/profit-loss/csv')
    expect(PERIOD_CSV_PATHS.pengeluaran).toBe('/expenses/csv')
  })

  it('passes the shown period and treats anything unknown as today', () => {
    expect(periodCsvQuery('week')).toBe('period=week')
    expect(periodCsvQuery('month')).toBe('period=month')
    expect(periodCsvQuery('year')).toBe('period=today')
    expect(periodCsvQuery(null)).toBe('period=today')
  })

  it('names the file after the screen and period', () => {
    expect(periodCsvFilename('untung-rugi', 'month')).toBe('untung-rugi-month.csv')
    expect(periodCsvFilename('pengeluaran', 'bogus')).toBe('pengeluaran-today.csv')
  })

  it('turns a refusal into the dialog input', () => {
    expect(periodCsvFailure(0, null)).toEqual({ status: 0, offline: true })
    expect(periodCsvFailure(403, { message: 'Anda tidak punya izin melihat laporan.' }).error).toBe('Anda tidak punya izin melihat laporan.')
    expect(periodCsvFailure(500, { message: 'boom' }).error).toBeUndefined()
  })
})
