import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'

// Server functions for the catalog screens: every call goes server-side through the session client,
// so the browser never holds the POS token. Mutations return { error } instead of throwing, for forms.

export type Category = { id: string; name: string }
export type ProductType = 'product' | 'service' | 'non_stock'
export type Product = {
  id: string
  name: string
  sku: string
  unit: string
  costPrice: number
  sellingPrice: number
  type: ProductType
  isActive: boolean
  categoryId: string
  category: Category
  barcodes: string[]
}
export type ProductPage = { data: Product[]; page: number; perPage: number; total: number }
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
type Result = { error?: string }

const FIELD_LABELS: Record<string, string> = {
  name: 'nama',
  categoryId: 'kategori',
  sku: 'SKU',
  unit: 'satuan',
  costPrice: 'harga modal (tidak boleh melebihi harga jual)',
  sellingPrice: 'harga jual',
  type: 'jenis',
  barcodes: 'barcode',
}

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: unknown; fields?: string[] }
  if (res.status === 409 && typeof body.message === 'string') return body.message
  if (res.status === 422) {
    const fields = [...new Set((body.fields ?? []).map((f) => FIELD_LABELS[f.split('.')[0]] ?? f))]
    return fields.length ? `Periksa lagi: ${fields.join(', ')}.` : 'Data tidak valid.'
  }
  if (res.status === 404) return 'Data tidak ditemukan. Mungkin sudah dihapus.'
  if (res.status === 403) return 'Kamu tidak punya izin untuk mengubah katalog.'
  return 'Terjadi kesalahan. Coba lagi sebentar lagi.'
}

async function read<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error(await errorOf(res))
  return (await res.json()) as T
}

async function write(path: string, method: string, body?: unknown): Promise<Result> {
  const res = await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  return res.ok ? {} : { error: await errorOf(res) }
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

export const listProducts = createServerFn({ method: 'GET' })
  .validator((d: ProductSearch) => d)
  .handler(({ data }) => {
    const qs = new URLSearchParams()
    if (data.q) qs.set('q', data.q)
    if (data.categoryId) qs.set('categoryId', data.categoryId)
    qs.set('page', String(data.page ?? 1))
    return read<ProductPage>(`/catalog/products?${qs}`)
  })

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
