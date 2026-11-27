import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { refusalOf, type Refusal } from '@/lib/refusal'

// Server functions for the summaries above each menu (design feature 39). pos-api computes every figure (integer
// rupiah); these only relay it. A failure is a value, never a throw, so one summary cannot break its menu's list.

export type Day = { date: string; total: number; count: number }
export type SalesHistorySummary = {
  today: { count: number; total: number }
  days: Day[]
  methods: { name: string; amount: number }[]
}
export type MembersSummary = {
  total: number
  kasbonRest: number | null
  top: { name: string; amount: number }[]
  newCount: number
  returningCount: number
}
export type ProductsSummary = {
  total: number
  stock: { ok: number; low: number; out: number }
  attention: number
  margins: { name: string; percent: number }[] | null
  noCost: number | null
}
export type CategoriesSummary = {
  categories: {
    name: string
    products: number
    revenue: number | null
    stockValue: number | null
  }[]
}
export type PaymentMethodsSummary = {
  activeCount: number
  methods: { name: string; uses: number; amount: number }[]
}
export type StockOpnameSummary =
  | { opname: null }
  | {
      opname: { id: string; approvedAt: string }
      shortQty: number
      overQty: number
      shortValue: number | null
      lines: { name: string; diff: number }[]
    }
export type VouchersSummary = {
  vouchers: { name: string; code: string; used: number; quota: number }[]
  days: { date: string; count: number }[]
}
export type StaffSummary = {
  cashiers: { name: string; receipts: number; amount: number }[]
  hours: number[]
}
export type SuppliersSummary = {
  supplierCount: number
  months: { month: string; total: number }[]
}
export type SetupSummary = {
  steps: { key: string; label: string; done: boolean; to: string }[]
  doneCount: number
  complete: boolean
}
export type DailyTarget = {
  target: number | null
  today: number
  percent: number | null
}

export type SummaryKinds = {
  'sales-history': SalesHistorySummary
  members: MembersSummary
  products: ProductsSummary
  categories: CategoriesSummary
  'payment-methods': PaymentMethodsSummary
  'stock-opname': StockOpnameSummary
  vouchers: VouchersSummary
  staff: StaffSummary
  suppliers: SuppliersSummary
  setup: SetupSummary
  'daily-target': DailyTarget
}
export type SummaryKind = keyof SummaryKinds

export type SummaryResult<T> = { ok: true; data: T } | ({ ok: false } & Refusal)
/** What a save that failed here looks like when the call itself threw. */
export type SaveFailure = { ok: false } & Refusal

const OFFLINE = 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.'

async function load<T>(path: string): Promise<SummaryResult<T>> {
  const res = await api(path).catch((e: unknown) => {
    if (isRedirect(e)) throw e // session ended: let the router send the user to sign in
    return null
  })
  if (!res) return { ok: false, status: 0, error: OFFLINE }
  if (!res.ok) return { ok: false, ...(await refusalOf(res)) }
  return { ok: true, data: (await res.json()) as T }
}

const KINDS = [
  'sales-history',
  'members',
  'products',
  'categories',
  'payment-methods',
  'stock-opname',
  'vouchers',
  'staff',
  'suppliers',
  'setup',
  'daily-target',
] as const

export const loadSummary = createServerFn()
  .validator((kind: SummaryKind) => {
    if (!KINDS.includes(kind)) throw new Error('Ringkasan tidak dikenal')
    return kind
  })
  .handler(({ data }) => load<SummaryKinds[SummaryKind]>(`/summaries/${data}`))

/** Sets the daily sales target (rupiah), or clears it with `null`. Owner only (catalog.manage). */
export const saveDailyTarget = createServerFn({ method: 'POST' })
  .validator((target: number | null) => target)
  .handler(async ({ data }): Promise<SummaryResult<DailyTarget>> => {
    const res = await api('/summaries/daily-target', {
      method: 'PUT',
      body: JSON.stringify({ target: data }),
    }).catch((e: unknown) => {
      if (isRedirect(e)) throw e
      return null
    })
    if (!res) return { ok: false, status: 0, error: OFFLINE }
    if (!res.ok) return { ok: false, ...(await refusalOf(res)) }
    return { ok: true, data: (await res.json()) as DailyTarget }
  })
