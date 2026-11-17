import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'

// Server functions for the U3 cashier. pos-api computes every price and total; these only relay.

export type Shift = {
  id: string
  openingCash: number
  openedAt: string
  closedAt: string | null
  countedCash: number | null
  expectedCash: number | null
  cashSales: number | null
  salesCount: number | null
  difference: number | null
}
export type Product = {
  id: string
  name: string
  sku: string
  sellingPrice: number
  type: string
  isActive: boolean
  category: { id: string; name: string }
}
export type SaleRow = {
  id: string
  number: number
  cashier: string
  subtotal: number
  discount: number
  tax: number
  total: number
  paid: number
  change: number
  costTotal?: number
  createdAt: string
}
export type SalesSummary = { count: number; revenue: number; discount: number }
export type Receipt = {
  number: number
  createdAt: string
  cashier: string
  paymentMethod: string
  lines: { name: string; qty: number; unitPrice: number; lineTotal: number }[]
  subtotal: number
  discount: number
  taxBps: number
  tax: number
  total: number
  paid: number
  change: number
  note: string | null
}
export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const ERRORS: Record<number, string> = {
  403: 'Kamu tidak punya izin untuk berjualan.',
  404: 'Data tidak ditemukan.',
}

/** pos-api's 409/422 messages are Indonesian and internals-free: show them as they are. */
async function errorOf(res: Response): Promise<string> {
  if (res.status === 409 || res.status === 422) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null
    if (typeof body?.message === 'string' && body.message !== 'Data tidak valid') return body.message
    return 'Data belum benar. Periksa isian kamu.'
  }
  return ERRORS[res.status] ?? 'Gagal terhubung ke server, coba lagi.'
}

async function load<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error(await errorOf(res))
  return (await res.json()) as T
}

async function send<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  const res = await api(path, { method: 'POST', body: JSON.stringify(body), headers }).catch(() => null)
  if (!res) return { ok: false, error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }
  if (!res.ok) return { ok: false, error: await errorOf(res) }
  return { ok: true, data: (await res.json()) as T }
}

export const loadCashier = createServerFn().handler(async () => {
  const { shift } = await load<{ shift: (Shift & { expectedCash: number }) | null }>('/shifts/current')
  if (!shift) return { shift: null, products: [], taxBps: 0, methods: [] as PaymentMethod[] }
  // shortcut: first 100 active products, searched in the browser; add server search when catalogs grow.
  const [page, settings, methods] = await Promise.all([
    load<{ data: Product[] }>('/catalog/products?perPage=100'),
    load<{ taxBps: number }>('/sales/settings'),
    load<{ data: PaymentMethod[] }>('/payment-methods'),
  ])
  return { shift, products: page.data.filter((p) => p.isActive), taxBps: settings.taxBps, methods: methods.data }
})

export const openShift = createServerFn({ method: 'POST' })
  .validator((openingCash: number) => openingCash)
  .handler(({ data }) => send<Shift>('/shifts/open', { openingCash: data }))

export const closeShift = createServerFn({ method: 'POST' })
  .validator((countedCash: number) => countedCash)
  .handler(({ data }) => send<Shift>('/shifts/current/close', { countedCash: data }))

type SaleInput = {
  key: string
  lines: { productId: string; qty: number }[]
  paid: number
  note?: string
  // U7: member (required for a kasbon method), voucher code, payment method (default Tunai).
  memberId?: string
  voucherCode?: string
  paymentMethodId?: string
}
export const createSale = createServerFn({ method: 'POST' })
  .validator((d: SaleInput) => d)
  .handler(({ data: { key, ...body } }) => send<{ id: string }>('/sales', body, { 'idempotency-key': key }))

export const loadReceipt = createServerFn()
  .validator((id: string) => id)
  .handler(({ data }) => load<Receipt>(`/sales/${encodeURIComponent(data)}/receipt`))

export type HistoryQuery = { page: number; from?: string; to?: string }
export const loadHistory = createServerFn()
  .validator((q: HistoryQuery) => q)
  .handler(({ data: { page, from, to } }) => {
    const qs = new URLSearchParams({ page: String(page), perPage: '20' })
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    return load<{ data: SaleRow[]; total: number; summary: SalesSummary }>(`/sales?${qs}`)
  })

export const loadCurrentShift = createServerFn().handler(() =>
  load<{ shift: (Shift & { expectedCash: number; cashSales: number; salesCount: number }) | null }>('/shifts/current'),
)

export { rupiah } from '@/components/pos-page'

// ---- U7: member picker, voucher check, payment methods ----

export type PaymentMethod = { id: string; name: string; kind: 'cash' | 'debit' | 'credit' | 'wallet' }
export type MemberOption = { id: string; name: string; code: string }

/** Name and code only (GET /members/picker, sales.create): the till never loads phone or address. */
export const pickMembers = createServerFn()
  .validator((q: string) => q)
  .handler(async ({ data }) => (await load<{ data: MemberOption[] }>(`/members/picker?q=${encodeURIComponent(data)}`)).data)

/** The discount `code` gives on `amount`, without taking quota; the sale re-validates and takes it. */
export const checkVoucher = createServerFn({ method: 'POST' })
  .validator((d: { code: string; amount: number }) => d)
  .handler(({ data }) => send<{ discount: number }>('/vouchers/check', data))
