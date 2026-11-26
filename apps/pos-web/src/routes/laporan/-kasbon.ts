import type { FailureLike } from '@/lib/describe-error'

// Pure helpers of the kasbon report (UMK-1964, design feature 28). pos-api computes every number and the store-day
// status; these only word them.

export type KasbonFilter = 'all' | 'due' | 'not_due'
export type KasbonStatus = 'due' | 'not_due'

export type KasbonSummary = {
  timezone: string
  today: string
  totalRest: number
  dueRest: number
  customers: number
  dueCustomers: number
  paidThisMonth: number
  collectorHeld: number
}
export type KasbonCustomer = {
  memberId: string
  name: string
  kasbonCount: number
  total: number
  paid: number
  rest: number
  dueRest: number
  oldestDueDate: string | null
  overdueDays: number | null
  status: KasbonStatus
}
export type KasbonReport = { filter: KasbonFilter; summary: KasbonSummary; truncated: boolean; rows: KasbonCustomer[] }
export type KasbonPayment = { id: string; paidOn: string; amount: number; method: string; byCollector: boolean }
export type KasbonItem = {
  id: string
  saleNumber: number
  createdOn: string
  dueDate: string | null
  total: number
  paid: number
  rest: number
  overdueDays: number | null
  status: KasbonStatus
  payments: KasbonPayment[]
}
export type KasbonDetail = { timezone: string; memberId: string; name: string; rest: number; receivables: KasbonItem[] }

export const FILTERS: { value: KasbonFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'due', label: 'Jatuh tempo' },
  { value: 'not_due', label: 'Belum jatuh tempo' },
]

export const parseFilter = (v: unknown): KasbonFilter => (v === 'due' || v === 'not_due' ? v : 'all')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** `2026-11-14` → `14 Nov` (a store calendar date, no timezone shift), with a no-break space so it never wraps. */
export function shortDate(d: string | null): string {
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(d) : null
  if (!m) return '–'
  return `${Number(m[3])}\u00a0${MONTHS[Number(m[2]) - 1]}`
}

/** "Terlambat 12 hari", "Jatuh tempo hari ini" or "Belum jatuh tempo". */
export function statusLabel(r: { status: KasbonStatus; overdueDays: number | null }): string {
  if (r.status === 'not_due' || r.overdueDays === null) return 'Belum jatuh tempo'
  return r.overdueDays === 0 ? 'Jatuh tempo hari ini' : `Terlambat ${r.overdueDays} hari`
}

/** "2 kasbon · jatuh tempo terlama 14 Nov" (several) or "1 kasbon · jatuh tempo 23 Nov". */
export function customerLine(r: Pick<KasbonCustomer, 'kasbonCount' | 'oldestDueDate'>): string {
  const due = r.oldestDueDate
    ? ` · jatuh tempo ${r.kasbonCount > 1 ? 'terlama ' : ''}${shortDate(r.oldestDueDate)}`
    : ' · tanpa jatuh tempo'
  return `${r.kasbonCount} kasbon${due}`
}

/** The empty state of the list: no kasbon at all, or none under the chosen filter. */
export function emptyState(filter: KasbonFilter, customers: number): { title: string; body: string; showAll: boolean } {
  if (customers === 0 || filter === 'all')
    return { title: 'Belum ada kasbon', body: 'Penjualan kasbon akan muncul di sini.', showAll: false }
  return {
    title: filter === 'due' ? 'Tidak ada pelanggan yang jatuh tempo.' : 'Tidak ada pelanggan yang belum jatuh tempo.',
    body: 'Pilih Tampilkan semua untuk melihat semua pelanggan yang masih berhutang.',
    showAll: true,
  }
}

/** The dashboard card's second line: "4 pelanggan · Rp2.053.500 jatuh tempo". */
export function cardLine(s: Pick<KasbonSummary, 'customers' | 'dueRest'>, rupiah: (n: number) => string): string {
  if (s.customers === 0) return 'Tidak ada kasbon yang belum dibayar'
  return `${s.customers} pelanggan · ${rupiah(s.dueRest)} jatuh tempo`
}

export const EXPORT_TOO_LARGE_TEXT = 'Laporan terlalu besar untuk satu file (lebih dari 10.000 baris).'
export const EXPORT_TOO_LARGE_TODO = 'Persempit pilihan atau pilih satu pelanggan, lalu ekspor lagi.'

/**
 * A failed CSV download as the error dialog's input. `EXPORT_TOO_LARGE` gets the design's own wording; anything else
 * keeps its status (403: no permission, 0: no connection) and only our relay's short message.
 */
export function exportFailure(status: number, body: { message?: unknown; code?: unknown } | null): FailureLike {
  if (status === 422 && body?.code === 'EXPORT_TOO_LARGE')
    return { status, code: 'EXPORT_TOO_LARGE', error: EXPORT_TOO_LARGE_TEXT, todo: EXPORT_TOO_LARGE_TODO }
  const message = typeof body?.message === 'string' ? body.message : undefined
  return { status, error: [403, 422, 502].includes(status) ? message : undefined }
}
