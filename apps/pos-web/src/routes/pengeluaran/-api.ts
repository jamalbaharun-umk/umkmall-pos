import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { refusalOf, type Refusal } from '@/lib/refusal'
import type { EditChanges, ExpensePeriod, ExpenseSource } from './-helpers'

// Server functions for the expense screens (UMK-1984). pos-api validates and computes every figure; these relay.

export type Category = { category: string; label: string; kind: 'expense' | 'supplier_payment' }
export type ExpenseRow = {
  id: string
  kind: 'expense' | 'supplier_payment'
  category: string
  categoryLabel: string
  amount: number
  note: string | null
  date: string
  source: ExpenseSource
  actorName: string
  createdAt: string
  voidedAt: string | null
  exceedsDrawerCash: boolean
}
export type ExpenseEdit = { id: string; changes: EditChanges; actorName: string; createdAt: string }
export type ExpenseDetail = ExpenseRow & {
  voidedByName: string | null
  voidReason: string | null
  drawerReversed: boolean
  /** Where a voided drawer expense's cash went; null when none was returned. */
  cashReturnedTo: 'drawer' | 'store_cash' | null
  edits: ExpenseEdit[]
}
export type ExpenseSummary = {
  count: number
  expenses: number
  supplierPayments: number
  fromDrawer: number
  outside: number
}
export type ExpenseList = {
  from: string
  to: string
  data: ExpenseRow[]
  total: number
  page: number
  perPage: number
  summary: ExpenseSummary
}

export type Result<T = undefined> = { ok: true; data: T } | ({ ok: false } & Refusal)

const OFFLINE = 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.'
const LOAD_ERRORS: Record<number, string> = {
  403: 'Anda tidak punya izin untuk ini',
  404: 'Pengeluaran tidak ditemukan, mungkin sudah dihapus.',
}
const enc = encodeURIComponent

async function load<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error(LOAD_ERRORS[res.status] ?? 'Gagal memuat data, coba lagi.')
  return (await res.json()) as T
}

async function send<T>(path: string, method: string, body: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  const res = await api(path, { method, body: JSON.stringify(body), headers }).catch((e: unknown) => {
    if (isRedirect(e)) throw e // session ended: go to sign-in
    return null
  })
  if (!res) return { ok: false, status: 0, error: OFFLINE }
  if (res.ok) return { ok: true, data: (await res.json().catch(() => undefined)) as T }
  if (res.status === 403) return { ok: false, status: 403, error: 'Anda tidak punya izin untuk ini.' }
  if (res.status === 404) return { ok: false, status: 404, error: LOAD_ERRORS[404] }
  return { ok: false, ...(await refusalOf(res)) }
}

/** The store's timezone for the times in the list; `reports.view` may be missing, then WIB. */
async function timezone(): Promise<string> {
  const res = await api('/reports/settings').catch(() => null)
  const body = res?.ok ? ((await res.json().catch(() => null)) as { timezone?: unknown } | null) : null
  return typeof body?.timezone === 'string' ? body.timezone : 'Asia/Jakarta'
}

export const loadExpenses = createServerFn()
  .validator((period: ExpensePeriod) => period)
  .handler(async ({ data }) => {
    const [list, timeZone] = await Promise.all([
      load<ExpenseList>(`/expenses?period=${enc(data)}&perPage=100`),
      timezone(),
    ])
    return { list, timeZone }
  })

/** Categories, today's date in the store's timezone and the open shift's expected cash (null without a shift). */
export const loadExpenseForm = createServerFn().handler(async () => {
  const [categories, today, shift] = await Promise.all([
    load<{ data: Category[] }>('/expenses/categories'),
    load<{ to: string }>('/expenses?period=today&perPage=1'),
    // /shifts/current needs sales.create: an actor without it simply gets no warning before saving.
    api('/shifts/current')
      .then(async (r) => (r.ok ? ((await r.json()) as { shift: { expectedCash: number } | null }).shift : null))
      .catch(() => null),
  ])
  return { categories: categories.data, today: today.to, expectedCash: shift ? shift.expectedCash : null, hasShift: !!shift }
})

export const loadExpense = createServerFn()
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const [expense, categories, today] = await Promise.all([
      load<ExpenseDetail>(`/expenses/${enc(data)}`),
      load<{ data: Category[] }>('/expenses/categories'),
      load<{ to: string }>('/expenses?period=today&perPage=1'),
    ])
    return { expense, categories: categories.data, today: today.to }
  })

export type NewExpense = { amount: number; category: string; source: ExpenseSource; note?: string; date?: string }
// `key` is made once per form submit, so a double tap or a retry records one expense.
export const createExpense = createServerFn({ method: 'POST' })
  .validator((d: { key: string; body: NewExpense }) => d)
  .handler(({ data }) => send<ExpenseDetail>('/expenses', 'POST', data.body, { 'idempotency-key': data.key }))

export const updateExpense = createServerFn({ method: 'POST' })
  .validator((d: { id: string; body: { category?: string; note?: string | null; amount?: number; date?: string } }) => d)
  .handler(({ data }) => send<ExpenseDetail>(`/expenses/${enc(data.id)}`, 'PATCH', data.body))

export const voidExpense = createServerFn({ method: 'POST' })
  .validator((d: { id: string; reason?: string }) => d)
  .handler(({ data }) => send<ExpenseDetail>(`/expenses/${enc(data.id)}/void`, 'POST', data.reason ? { reason: data.reason } : {}))
