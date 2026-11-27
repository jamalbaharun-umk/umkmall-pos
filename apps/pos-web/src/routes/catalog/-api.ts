import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { refusalOf } from '@/lib/refusal'
import type { SaveWarning, TierInput, UnitInput } from './products/-helpers'

// Server functions for the catalog screens: every call goes server-side through the session client,
// so the browser never holds the POS token. Mutations return { error } instead of throwing, for forms.

export type Category = { id: string; name: string }
export type ProductType = 'product' | 'service' | 'non_stock'
export type Product = {
  id: string
  name: string
  sku: string
  unit: string
  /** Absent for actors without catalog.manage, reports.view or purchasing.manage (pos-api hides it). */
  costPrice?: number
  sellingPrice: number
  type: ProductType
  isActive: boolean
  lowStockThreshold: number
  /** List responses only: on-hand for a tracked product, null for service and non-stock. */
  stock?: number | null
  categoryId: string
  category: Category
  barcodes: string[]
  images?: { id: string }[]
  // UMK-1985: other units (smallest pack first) and wholesale tiers per base unit (lowest quantity first).
  units: (UnitInput & { id: string })[]
  priceTiers: TierInput[]
}
export type ProductPage = {
  data: Product[]
  page: number
  perPage: number
  total: number
  stockCounts: { low: number; out: number }
}
export type Movement = { id: string; delta: number; reason: string; createdAt: string }
export type Batch = { id: string; qtyInitial: number; qtyRemaining: number; unitCost: number; source: string; receivedAt: string }
export type ProductStock = { tracked: boolean; onHand: number | null; batches: Batch[] }
export type ProductInput = {
  categoryId: string
  name: string
  sku: string
  unit: string
  costPrice: number
  sellingPrice: number
  type: ProductType
  isActive: boolean
  lowStockThreshold: number
  barcodes: string[]
  // Each list replaces the stored one.
  units: UnitInput[]
  priceTiers: TierInput[]
}
type Result = { error?: string; errors?: Record<string, string>; status?: number; id?: string; warnings?: SaveWarning[] }

async function errorOf(res: Response): Promise<string> {
  return (await refusalOf(res)).error
}

async function read<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error(await errorOf(res))
  return (await res.json()) as T
}

async function write(path: string, method: string, body?: unknown): Promise<Result> {
  const res = await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!res.ok) return refusalOf(res)
  const json = (await res.json().catch(() => null)) as { id?: string; warnings?: SaveWarning[] } | null
  return { id: json?.id, warnings: Array.isArray(json?.warnings) ? json.warnings : undefined }
}

export const listCategories = createServerFn({ method: 'GET' }).handler(async () =>
  (await read<{ data: Category[] }>('/catalog/categories')).data,
)

export const saveCategory = createServerFn({ method: 'POST' })
  .validator((d: { id?: string; name: string }) => d)
  .handler(({ data }) =>
    data.id
      ? write(`/catalog/categories/${encodeURIComponent(data.id)}`, 'PATCH', { name: data.name })
      : write('/catalog/categories', 'POST', { name: data.name }),
  )

export const deleteCategory = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data }) => write(`/catalog/categories/${encodeURIComponent(data)}`, 'DELETE'))

export type ProductSearch = { q?: string; categoryId?: string; stock?: 'low' | 'out'; page?: number }

export const PER_PAGE = 10

/** A product page; each row carries its on-hand (Lakasir's "stocks" column), the page the Menipis/Habis counts. */
export const listProducts = createServerFn({ method: 'GET' })
  .validator((d: ProductSearch) => d)
  .handler(async ({ data }) => {
    const qs = new URLSearchParams()
    if (data.q) qs.set('q', data.q)
    if (data.categoryId) qs.set('categoryId', data.categoryId)
    if (data.stock) qs.set('stock', data.stock)
    qs.set('page', String(data.page ?? 1))
    qs.set('perPage', String(PER_PAGE))
    return read<ProductPage>(`/catalog/products?${qs}`)
  })

export const getProductDetail = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const id = encodeURIComponent(data)
    const [product, stock, movements] = await Promise.all([
      read<Product>(`/catalog/products/${id}`),
      read<ProductStock>(`/stock/products/${id}`),
      read<Movement[]>(`/stock/products/${id}/movements`),
    ])
    return { product, stock, movements }
  })

/** Lakasir's "Stock" field on create: recorded as the product's opening stock (once, at its cost price). */
export const recordOpeningStock = createServerFn({ method: 'POST' })
  .validator((d: { productId: string; qty: number }) => d)
  .handler(({ data }) => write('/stock/opening', 'POST', data))

export const uploadImage = createServerFn({ method: 'POST' })
  .validator((d: FormData) => d)
  .handler(async ({ data }): Promise<Result> => {
    const id = data.get('productId')
    const file = data.get('file')
    if (typeof id !== 'string' || !(file instanceof File)) return { error: 'Gambar tidak valid.' }
    const body = new FormData()
    body.set('file', file)
    const res = await api(`/catalog/products/${encodeURIComponent(id)}/images`, { method: 'POST', body })
    return res.ok ? {} : refusalOf(res)
  })

export const deleteImage = createServerFn({ method: 'POST' })
  .validator((d: { productId: string; imageId: string }) => d)
  .handler(({ data }) =>
    write(`/catalog/products/${encodeURIComponent(data.productId)}/images/${encodeURIComponent(data.imageId)}`, 'DELETE'),
  )

export const getProduct = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(({ data }) => read<Product>(`/catalog/products/${encodeURIComponent(data)}`))

export const saveProduct = createServerFn({ method: 'POST' })
  .validator((d: { id?: string; input: ProductInput }) => d)
  .handler(({ data }) => {
    const { sku, ...rest } = data.input
    if (data.id) return write(`/catalog/products/${encodeURIComponent(data.id)}`, 'PATCH', sku ? data.input : rest)
    return write('/catalog/products', 'POST', data.input)
  })

export const deleteProduct = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data }) => write(`/catalog/products/${encodeURIComponent(data)}`, 'DELETE'))

export { rupiah } from '../../lib/rupiah'
