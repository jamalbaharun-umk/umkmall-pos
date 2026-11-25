import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'

// Server functions for U5 reports. pos-api computes every number (integer rupiah); these only relay.

export type Metrics = {
  salesCount: number
  grossSales: number
  discount: number
  voucher: number
  tax: number
  revenue: number
  cost: number
  grossProfit: number
  // UMK-1993: cash rounding, its own figure outside revenue and gross profit
  rounding: number
}
export type Period = 'today' | 'week' | 'month' | 'year'
export type Dashboard = { period: Period; timezone: string; from: string; to: string; current: Metrics; previous: Metrics }
export type Kind = 'sales' | 'products' | 'shifts' | 'purchasing'
export type Report = {
  from: string
  to: string
  timezone: string
  truncated?: boolean
  rows: Record<string, string | number | null>[]
  totals: Record<string, number>
}
export type FieldErrors = Record<string, string>
export type Failure = { ok: false; status: number; error: string; errors?: FieldErrors }
export type Result<T> = { ok: true; data: T } | Failure

const ERRORS: Record<number, string> = {
  403: 'Kamu tidak punya izin melihat laporan.',
}
const OFFLINE = 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.'

/** pos-api answers 422 as `{ message, errors: { field: message } }` in Indonesian: pass both through, nothing else. */
async function failure(res: Response, fallback: string): Promise<Failure> {
  if (res.status === 422) {
    const body = (await res.json().catch(() => null)) as { message?: unknown; errors?: unknown } | null
    const errors = body?.errors && typeof body.errors === 'object' ? (body.errors as FieldErrors) : undefined
    const error = typeof body?.message === 'string' ? body.message : 'Periksa kembali isian kamu'
    return { ok: false, status: 422, error, errors }
  }
  return { ok: false, status: res.status, error: ERRORS[res.status] ?? fallback }
}

async function load<T>(path: string): Promise<Result<T>> {
  const res = await api(path).catch((e: unknown) => {
    if (isRedirect(e)) throw e // session ended: let the router send the user to sign in
    return null
  })
  if (!res) return { ok: false, status: 0, error: OFFLINE }
  if (!res.ok) return failure(res, 'Gagal memuat laporan, coba lagi.')
  return { ok: true, data: (await res.json()) as T }
}

export const loadDashboard = createServerFn()
  .validator((p: Period) => p)
  .handler(({ data }) => load<Dashboard>(`/reports/dashboard?period=${encodeURIComponent(data)}`))

/** A report for `from..to`; with neither date, today in the store's timezone. Bad dates go to pos-api, which names them. */
export const loadReport = createServerFn()
  .validator((d: { kind: Kind; from?: string; to?: string }) => d)
  .handler(async ({ data }) => {
    let { from, to } = data
    if (from === undefined && to === undefined) {
      const s = await load<{ timezone: string }>('/reports/settings')
      if (!s.ok) return s
      from = to = new Intl.DateTimeFormat('en-CA', { timeZone: s.data.timezone }).format(new Date())
    }
    return load<Report>(`/reports/${data.kind}?${new URLSearchParams({ from: from ?? '', to: to ?? '' })}`)
  })

export const loadSettings = createServerFn().handler(() => load<{ timezone: string }>('/reports/settings'))

export type ProfitLossFigures = {
  from: string
  to: string
  revenue: number
  tax: number
  cost: number
  grossProfit: number
  expenses: number
  netProfit: number
  rounding: number
  supplierPayments: number
}
export type ProfitLoss = {
  period: 'today' | 'week' | 'month' | null
  from: string
  to: string
  taxIncluded: boolean
  labels: Record<'revenue' | 'cost' | 'grossProfit' | 'expenses' | 'netProfit' | 'tax' | 'rounding' | 'supplierPayments', string>
  current: ProfitLossFigures
  previous: ProfitLossFigures
  netProfitChange: number
  topExpenses: { category: string; label: string; total: number; count: number }[]
}

/** The simple profit and loss report (needs reports.view). */
export const loadProfitLoss = createServerFn()
  .validator((p: 'today' | 'week' | 'month') => p)
  .handler(({ data }) => load<ProfitLoss>(`/reports/profit-loss?period=${encodeURIComponent(data)}`))

export { rupiah } from '@/components/page'
