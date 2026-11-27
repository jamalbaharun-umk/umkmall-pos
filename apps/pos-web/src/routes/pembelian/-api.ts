import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { searchPath } from '@/lib/product-search'
import type { Payment, PaymentStatus, PaySource, Refund, RefundDestination, Return } from './-debt'

// Server functions for the U6 screens (pemasok, pembelian, stok opname). pos-api validates and computes
// every total; these only relay. Mutations return a Result instead of throwing, for forms.

export type Supplier = { id: string; name: string; phone: string | null; address: string | null }
export type OrderStatus = 'draft' | 'approved' | 'cancelled'
export type OrderSummary = {
  id: string
  /** "PB-0012" (UMK-1970). */
  code?: string
  status: OrderStatus
  supplierName: string
  paymentMethod: string | null
  total?: number // absent without purchasing.manage / reports.view, like every money figure below
  createdAt: string
  approvedAt?: string | null
  dueDate: string | null
  dueInDays: number | null
  paid?: number
  returned?: number
  /** Still owed; null for a draft or cancelled purchase. */
  remaining?: number | null
  credit?: number
  /** Of the credit, what the supplier handed back, and what is still to come back (UMK-1970 additions). */
  refunded?: number
  refundDue?: number
  paymentStatus: PaymentStatus | null
  overdueDays: number | null
}
export type DebtSummary = { total: number; overdue: number; dueSoon: number; openCount: number; overdueCount: number }
export type Order = OrderSummary & {
  note: string | null
  approvedAt: string | null
  supplierId: string
  lines: {
    id: string
    productId: string
    productName: string
    sku: string
    qty: number
    unitCost?: number
    /** Units sent back so far, and what is left in the line's stock batch (the most a return may take). */
    returnedQty: number
    returnable: number
  }[]
  payments?: Payment[]
  returns?: Return[]
  refunds?: Refund[]
}
export type OpnameSummary = { id: string; status: 'draft' | 'approved'; note: string | null; createdAt: string }
export type Opname = OpnameSummary & {
  approvedAt: string | null
  lines: {
    id: string
    productName: string
    sku: string
    systemQty: number
    countedQty: number
    difference: number
    reason: string | null
  }[]
}
export type StockProduct = { id: string; name: string; sku: string; costPrice: number }
export type Result = { ok: true; id?: string } | { ok: false; error: string; errors?: Record<string, string>; status?: number }

const ERRORS: Record<number, string> = {
  403: 'Anda tidak punya izin untuk ini.',
  404: 'Data tidak ditemukan, mungkin sudah dihapus.',
  422: 'Data belum benar. Periksa isian Anda.',
}

async function load<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error(ERRORS[res.status] ?? 'Gagal memuat data.')
  return (await res.json()) as T
}

async function mutate(path: string, method: string, body?: unknown): Promise<Result> {
  const res = await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  if (res.ok) {
    const json = (await res.json().catch(() => ({}))) as { id?: string }
    return { ok: true, id: json.id }
  }
  const err = (await res.json().catch(() => ({}))) as { message?: unknown; errors?: unknown }
  // 409 and 422 carry a safe Indonesian message and per-field errors from pos-api.
  if ((res.status === 409 || res.status === 422) && typeof err.message === 'string')
    return {
      ok: false,
      status: res.status,
      error: err.message,
      errors: err.errors && typeof err.errors === 'object' ? (err.errors as Record<string, string>) : undefined,
    }
  return { ok: false, status: res.status, error: ERRORS[res.status] ?? 'Gagal menyimpan, coba lagi.' }
}

const enc = encodeURIComponent

// Stock-tracked products for the line pickers: one searched page (name, SKU or barcode), never the whole catalogue.
type ProductPage = { data: StockProduct[]; total: number }
async function stockProducts(q = ''): Promise<ProductPage> {
  const page = await load<ProductPage>(searchPath(q))
  return {
    data: page.data.map((p) => ({ id: p.id, name: p.name, sku: p.sku, costPrice: p.costPrice })),
    total: page.total,
  }
}

async function productsForForm() {
  const page = await stockProducts()
  return { products: page.data, productTotal: page.total }
}

export const searchStockProducts = createServerFn()
  .validator((d: { q: string }) => ({ q: String(d.q ?? '') }))
  .handler(({ data }) => stockProducts(data.q))

export const loadSuppliers = createServerFn().handler(async () => (await load<{ data: Supplier[] }>('/suppliers')).data)

export const saveSupplier = createServerFn({ method: 'POST' })
  .validator((d: { id?: string; name: string; phone: string | null; address: string | null }) => d)
  .handler(({ data: { id, ...body } }) =>
    id ? mutate(`/suppliers/${enc(id)}`, 'PATCH', body) : mutate('/suppliers', 'POST', body),
  )

export const deleteSupplier = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data }) => mutate(`/suppliers/${enc(data)}`, 'DELETE'))

export const loadOrders = createServerFn().handler(async () => {
  const body = await load<{ data: OrderSummary[]; summary?: DebtSummary }>('/purchasing/orders')
  return { orders: body.data, summary: body.summary ?? null }
})

export const loadOrderForm = createServerFn().handler(async () => ({
  suppliers: (await load<{ data: Supplier[] }>('/suppliers')).data,
  ...(await productsForForm()),
}))

export const loadOrder = createServerFn()
  .validator((id: string) => id)
  .handler(({ data }) => load<Order>(`/purchasing/orders/${enc(data)}`))

/** The order plus the actor's open drawer (expected cash), for "Bayar pemasok"; null without an open shift. */
export const loadOrderPage = createServerFn()
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const [order, drawerCash] = await Promise.all([
      load<Order>(`/purchasing/orders/${enc(data)}`),
      // /shifts/current needs sales.create: without it the form simply shows no drawer figure.
      api('/shifts/current')
        .then(async (r) =>
          r.ok ? (((await r.json()) as { shift: { expectedCash: number } | null }).shift?.expectedCash ?? null) : null,
        )
        .catch(() => null),
    ])
    return { order, drawerCash }
  })

/** A refused payment or return: pos-api's text, its stable code and the figure that helps recover. */
export type MoneyResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      status: number
      error: string
      code?: string
      errors?: Record<string, string>
      remaining?: number
      drawerCash?: number
      available?: number
      refundDue?: number
      refunded?: number
    }

const num = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined)

async function sendMoney<T>(path: string, body: unknown, key?: string): Promise<MoneyResult<T>> {
  const res = await api(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: key ? { 'idempotency-key': key } : {},
  }).catch((e: unknown) => {
    if (isRedirect(e)) throw e // session ended: go to sign-in
    return null
  })
  if (!res) return { ok: false, status: 0, error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }
  if (res.ok) return { ok: true, data: (await res.json()) as T }
  const err = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const safe = (res.status === 409 || res.status === 422) && typeof err.message === 'string'
  return {
    ok: false,
    status: res.status,
    error: safe ? (err.message as string) : (ERRORS[res.status] ?? 'Gagal menyimpan, coba lagi.'),
    code: typeof err.code === 'string' ? err.code : undefined,
    errors: safe && err.errors && typeof err.errors === 'object' ? (err.errors as Record<string, string>) : undefined,
    remaining: num(err.remaining),
    drawerCash: num(err.drawerCash),
    available: num(err.available),
    refundDue: num(err.refundDue),
    refunded: num(err.refunded),
  }
}

// `key` is made once per form attempt, so a double tap or a retry records one payment / one return.
export const payOrder = createServerFn({ method: 'POST' })
  .validator((d: { id: string; key: string; body: { amount: number; source: PaySource; note?: string } }) => d)
  .handler(({ data }) => sendMoney<Payment>(`/purchasing/orders/${enc(data.id)}/payments`, data.body, data.key))

export const voidPayment = createServerFn({ method: 'POST' })
  .validator((d: { id: string; paymentId: string; reason: string }) => d)
  .handler(({ data }) =>
    sendMoney<Payment>(`/purchasing/orders/${enc(data.id)}/payments/${enc(data.paymentId)}/void`, {
      reason: data.reason,
    }),
  )

export const returnGoods = createServerFn({ method: 'POST' })
  .validator(
    (d: { id: string; key: string; body: { reason: string; note?: string; lines: { lineId: string; qty: number }[] } }) => d,
  )
  .handler(({ data }) => sendMoney<Return>(`/purchasing/orders/${enc(data.id)}/returns`, data.body, data.key))

export const reverseReturn = createServerFn({ method: 'POST' })
  .validator((d: { id: string; returnId: string; reason: string }) => d)
  .handler(({ data }) =>
    sendMoney<Return>(`/purchasing/orders/${enc(data.id)}/returns/${enc(data.returnId)}/reverse`, {
      reason: data.reason,
    }),
  )

export const receiveRefund = createServerFn({ method: 'POST' })
  .validator((d: { id: string; key: string; body: { amount: number; destination: RefundDestination; note?: string } }) => d)
  .handler(({ data }) => sendMoney<Refund>(`/purchasing/orders/${enc(data.id)}/refunds`, data.body, data.key))

export const voidRefund = createServerFn({ method: 'POST' })
  .validator((d: { id: string; refundId: string; reason: string }) => d)
  .handler(({ data }) =>
    sendMoney<Refund>(`/purchasing/orders/${enc(data.id)}/refunds/${enc(data.refundId)}/void`, {
      reason: data.reason,
    }),
  )

export const setDueDate = createServerFn({ method: 'POST' })
  .validator((d: { id: string; dueDate: string | null }) => d)
  .handler(({ data }) => mutate(`/purchasing/orders/${enc(data.id)}`, 'PATCH', { dueDate: data.dueDate }))

type OrderInput = {
  id?: string
  supplierId: string
  paymentMethod: string | null
  note: string | null
  dueDate: string | null
  lines: { productId: string; qty: number; unitCost: number }[]
}
export const updateOrder = createServerFn({ method: 'POST' })
  .validator((d: OrderInput & { id?: string }) => d)
  .handler(({ data: { id, ...body } }) => mutate(`/purchasing/orders/${enc(id ?? '')}`, 'PATCH', body))

export const createOrder = createServerFn({ method: 'POST' })
  .validator((d: OrderInput) => d)
  .handler(({ data }) => mutate('/purchasing/orders', 'POST', data))

export const orderAction = createServerFn({ method: 'POST' })
  .validator((d: { id: string; action: 'approve' | 'cancel' | 'delete' }) => d)
  .handler(({ data }) =>
    data.action === 'delete'
      ? mutate(`/purchasing/orders/${enc(data.id)}`, 'DELETE')
      : mutate(`/purchasing/orders/${enc(data.id)}/${data.action}`, 'POST'),
  )

export const loadOpnames = createServerFn().handler(
  async () => (await load<{ data: OpnameSummary[] }>('/stock-opnames')).data,
)

export const loadOpnameForm = createServerFn().handler(() => productsForForm())

export const loadOpname = createServerFn()
  .validator((id: string) => id)
  .handler(({ data }) => load<Opname>(`/stock-opnames/${enc(data)}`))

type OpnameInput = { note: string | null; lines: { productId: string; countedQty: number; reason: string | null }[] }
export const createOpname = createServerFn({ method: 'POST' })
  .validator((d: OpnameInput) => d)
  .handler(({ data }) => mutate('/stock-opnames', 'POST', data))

export const opnameAction = createServerFn({ method: 'POST' })
  .validator((d: { id: string; action: 'approve' | 'delete' }) => d)
  .handler(({ data }) =>
    data.action === 'delete'
      ? mutate(`/stock-opnames/${enc(data.id)}`, 'DELETE')
      : mutate(`/stock-opnames/${enc(data.id)}/approve`, 'POST'),
  )
