import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'

// Server functions for U5 reports. pos-api computes every number (integer rupiah); these only relay.

export type Metrics = {
  salesCount: number
  grossSales: number
  discount: number
  tax: number
  revenue: number
  cost: number
  grossProfit: number
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
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

const ERRORS: Record<number, string> = {
  403: 'Kamu tidak punya izin melihat laporan.',
  422: 'Rentang tanggal belum benar (paling lama 366 hari).',
}

async function load<T>(path: string): Promise<Result<T>> {
  const res = await api(path).catch((e: unknown) => {
    if (isRedirect(e)) throw e // session ended: let the router send the user to sign in
    return null
  })
  if (!res) return { ok: false, status: 0, error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }
  if (!res.ok) return { ok: false, status: res.status, error: ERRORS[res.status] ?? 'Gagal memuat laporan, coba lagi.' }
  return { ok: true, data: (await res.json()) as T }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export const loadDashboard = createServerFn()
  .validator((p: Period) => p)
  .handler(({ data }) => load<Dashboard>(`/reports/dashboard?period=${encodeURIComponent(data)}`))

/** A report for `from..to`; without dates, today in the store's timezone. */
export const loadReport = createServerFn()
  .validator((d: { kind: Kind; from?: string; to?: string }) => d)
  .handler(async ({ data }) => {
    let { from, to } = data
    if (!from || !to || !DATE.test(from) || !DATE.test(to)) {
      const s = await load<{ timezone: string }>('/reports/settings')
      if (!s.ok) return s
      from = to = new Intl.DateTimeFormat('en-CA', { timeZone: s.data.timezone }).format(new Date())
    }
    return load<Report>(`/reports/${data.kind}?${new URLSearchParams({ from, to })}`)
  })

export const loadSettings = createServerFn().handler(() => load<{ timezone: string }>('/reports/settings'))

export const saveTimezone = createServerFn({ method: 'POST' })
  .validator((tz: string) => tz)
  .handler(async ({ data }) => {
    const res = await api('/reports/settings', { method: 'PUT', body: JSON.stringify({ timezone: data }) }).catch((e: unknown) => {
      if (isRedirect(e)) throw e
      return null
    })
    if (!res) return { ok: false as const, error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }
    if (res.status === 403) return { ok: false as const, error: 'Hanya pemilik yang bisa mengubah zona waktu.' }
    if (!res.ok) return { ok: false as const, error: 'Zona waktu tidak dikenal.' }
    return { ok: true as const }
  })

export { rupiah } from '@/components/page'
