import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { refusalOf } from '@/lib/refusal'

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
  categoryId: string
  category: Category
  barcodes: string[]
  images?: { id: string }[]
}
export type ProductPage = { data: Product[]; page: number; perPage: number; total: number }
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
  barcodes: string[]
}
type Result = { error?: string; errors?: Record<string, string>; id?: string }

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
  const json = (await res.json().catch(() => null)) as { id?: string } | null
  return { id: json?.id }
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

export type ProductSearch = { q?: string; categoryId?: string; page?: number }

export const PER_PAGE = 10

/** A product page plus on-hand per tracked product (Lakasir's "stocks" column). */
export const listProducts = createServerFn({ method: 'GET' })
  .validator((d: ProductSearch) => d)
  .handler(async ({ data }) => {
    const qs = new URLSearchParams()
    if (data.q) qs.set('q', data.q)
    if (data.categoryId) qs.set('categoryId', data.categoryId)
    qs.set('page', String(data.page ?? 1))
    qs.set('perPage', String(PER_PAGE))
    const page = await read<ProductPage>(`/catalog/products?${qs}`)
    const ids = page.data.map((p) => p.id).join(',')
    const stock = ids ? await read<Record<string, number>>(`/stock/on-hand?ids=${ids}`) : {}
    return { ...page, stock }
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

export const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`
