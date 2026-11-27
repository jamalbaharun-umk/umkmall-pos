import type { FailureLike } from '@/lib/describe-error'
import { exportFailure } from './-kasbon'

// The CSV of the two screens that show a period ("Hari ini", "Minggu ini", "Bulan ini") instead of a date range:
// Untung rugi and Pengeluaran. The screen asks the session route `/laporan/csv/<jenis>?period=…`, which streams pos-api's
// CSV for the same period the screen shows. These are the pure parts.

export const PERIOD_CSV_PATHS: Record<string, string> = {
  'untung-rugi': '/reports/profit-loss/csv',
  pengeluaran: '/expenses/csv',
}

const PERIODS = ['today', 'week', 'month']

/** The query pos-api reads for a period; anything unknown is today, like the screens' own `asPeriod`. */
export function periodCsvQuery(period: string | null | undefined): string {
  return new URLSearchParams({ period: PERIODS.includes(period ?? '') ? period! : 'today' }).toString()
}

/** `untung-rugi-week.csv`, the name the browser saves the file under. */
export const periodCsvFilename = (jenis: string, period: string) => `${jenis}-${periodCsvQuery(period).slice('period='.length)}.csv`

/** A failed period CSV as the error dialog's input. */
export const periodCsvFailure = (status: number, body: { message?: unknown; code?: unknown } | null): FailureLike =>
  status === 0 ? { status: 0, offline: true } : exportFailure(status, body)
