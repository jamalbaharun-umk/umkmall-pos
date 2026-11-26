import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { searchPath } from '@/lib/product-search'

// Server functions for the U6 screens (pemasok, pembelian, stok opname). pos-api validates and computes
// every total; these only relay. Mutations return a Result instead of throwing, for forms.

export type Supplier = { id: string; name: string; phone: string | null; address: string | null }
export type OrderStatus = 'draft' | 'approved' | 'cancelled'
export type OrderSummary = {
  id: string
  status: OrderStatus
  supplierName: string
  paymentMethod: string | null
  total?: number // absent without purchasing.manage / reports.view
  createdAt: string
}
export type Order = OrderSummary & {
  note: string | null
  approvedAt: string | null
  supplierId: string
  lines: { id: string; productId: string; productName: string; sku: string; qty: number; unitCost?: number }[]
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

export const loadOrders = createServerFn().handler(
  async () => (await load<{ data: OrderSummary[] }>('/purchasing/orders')).data,
)

export const loadOrderForm = createServerFn().handler(async () => ({
  suppliers: (await load<{ data: Supplier[] }>('/suppliers')).data,
  ...(await productsForForm()),
}))

export const loadOrder = createServerFn()
  .validator((id: string) => id)
  .handler(({ data }) => load<Order>(`/purchasing/orders/${enc(data)}`))

type OrderInput = {
  id?: string
  supplierId: string
  paymentMethod: string | null
  note: string | null
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
