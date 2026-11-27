// Pure helpers of the summaries (no React, no I/O), unit-tested in -summary.test.ts.

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** "2026-11-27" -> "Jum". The date is the store's calendar date, so no timezone is applied. */
export function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** "2026-11" -> "Nov". */
export function monthName(month: string): string {
  return MONTHS[Number(month.split('-')[1]) - 1] ?? month
}

/** True when no number in the list is above zero: a chart of that says nothing, so it shows the empty state. */
export const allZero = (values: number[]): boolean => values.every((v) => v <= 0)

/** A bar's label: the full voucher name is long, so a phone gets it cut with an ellipsis. */
export const clip = (text: string, max = 22): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** The share of a quota used, 0 to 100 (whole numbers; a quota of 0 is full). */
export const usedPercent = (used: number, quota: number): number =>
  quota <= 0 ? 100 : Math.min(100, Math.floor((used * 100) / quota))

/** A voucher meter's status: `empty` when nothing is left, `low` from 90% used, else `ok`. */
export function voucherStatus(used: number, quota: number): 'ok' | 'low' | 'empty' {
  if (used >= quota) return 'empty'
  return usedPercent(used, quota) >= 90 ? 'low' : 'ok'
}

/** Whether "Kelengkapan toko" shows: not while loading or failed, and never once every step is done. */
export const showSetupBoard = (s: { complete: boolean } | undefined): boolean => s !== undefined && !s.complete

/** The text under the board's meter. */
export const setupProgress = (done: number, total: number): string => `${done} dari ${total} langkah selesai.`

/** The daily target as typed (digits, dots, "Rp"): whole rupiah, or null when empty or not a positive whole number. */
export function parseTarget(text: string): number | null | 'invalid' {
  const digits = text.replace(/[\s.]/g, '').replace(/^rp/i, '')
  if (digits === '') return null
  if (!/^\d+$/.test(digits)) return 'invalid'
  const n = Number(digits)
  return n >= 1 && n <= 1_000_000_000 ? n : 'invalid'
}

/** Whether a summary's rows carry rupiah (`reports.view`); without it they come with counts only. */
export const withMoney = (rows: { amount: number | null }[]): boolean => rows.every((r) => r.amount !== null)
