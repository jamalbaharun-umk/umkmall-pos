import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import {
  deleteProduct,
  getProduct,
  listCategories,
  saveProduct,
  type ProductInput,
  type ProductType,
} from '../-api'
import { Alert, BackLink, Card, Empty, ErrorState, Field, Loading, danger, input, primary } from '../-ui'

// `/catalog/products/baru` creates; any other id edits.
export const Route = createFileRoute('/catalog/products/$id')({
  loader: async ({ params }) => {
    const [categories, product] = await Promise.all([
      listCategories(),
      params.id === 'baru' ? Promise.resolve(null) : getProduct({ data: params.id }),
    ])
    return { categories, product }
  },
  pendingComponent: Loading,
  errorComponent: ErrorState,
  component: ProductForm,
})

const TYPES: { value: ProductType; label: string }[] = [
  { value: 'product', label: 'Barang (pakai stok)' },
  { value: 'service', label: 'Jasa' },
  { value: 'non_stock', label: 'Barang tanpa stok' },
]

// Whole rupiah only: digits, no decimals (the API refuses fractions too).
const toRupiah = (s: string) => (s === '' ? NaN : Number(s.replace(/\D/g, '')))

function ProductForm() {
  const { categories, product } = Route.useLoaderData()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    categoryId: product?.categoryId ?? categories[0]?.id ?? '',
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    unit: product?.unit ?? 'PCS',
    costPrice: String(product?.costPrice ?? 0),
    sellingPrice: product ? String(product.sellingPrice) : '',
    type: product?.type ?? ('product' as ProductType),
    isActive: product?.isActive ?? true,
    barcodes: product?.barcodes.join('\n') ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  if (categories.length === 0) {
    return (
      <Card>
        <Empty title="Belum ada kategori">Buat kategori dulu sebelum menambah produk.</Empty>
        <div className="text-center">
          <BackLink to="/catalog/categories">Ke halaman kategori</BackLink>
        </div>
      </Card>
    )
  }

  async function run(action: () => Promise<{ error?: string }>) {
    setBusy(true)
    setError(undefined)
    try {
      const res = await action()
      if (res.error) return setError(res.error)
      await navigate({ to: '/catalog/products' })
    } catch {
      setError('Terjadi kesalahan. Coba lagi sebentar lagi.')
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const costPrice = toRupiah(form.costPrice)
    const sellingPrice = toRupiah(form.sellingPrice)
    if (!Number.isSafeInteger(sellingPrice) || !Number.isSafeInteger(costPrice))
      return setError('Harga harus berupa angka rupiah tanpa desimal.')
    if (costPrice > sellingPrice) return setError('Harga modal tidak boleh melebihi harga jual.')
    const input: ProductInput = {
      categoryId: form.categoryId,
      name: form.name.trim(),
      sku: form.sku.trim(),
      unit: form.unit.trim() || 'PCS',
      costPrice,
      sellingPrice,
      type: form.type,
      isActive: form.isActive,
      barcodes: form.barcodes.split(/\s+/).filter(Boolean),
    }
    void run(() => saveProduct({ data: { id: product?.id, input } }))
  }

  return (
    <div className="flex flex-col gap-4">
      <BackLink to="/catalog/products">Daftar produk</BackLink>
      <Card>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <h2 className="text-lg font-semibold text-ink sm:col-span-2">{product ? 'Ubah produk' : 'Produk baru'}</h2>
          <div className="sm:col-span-2">
            <Field label="Nama produk">
              <input
                className={input}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Contoh: Es Teh Manis"
                maxLength={120}
                required
              />
            </Field>
          </div>
          <Field label="Kategori">
            <select className={input} value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Jenis">
            <select className={input} value={form.type} onChange={(e) => set('type', e.target.value as ProductType)}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Harga modal (Rp)">
            <input
              className={input}
              inputMode="numeric"
              pattern="[0-9.]*"
              value={form.costPrice}
              onChange={(e) => set('costPrice', e.target.value)}
            />
          </Field>
          <Field label="Harga jual (Rp)">
            <input
              className={input}
              inputMode="numeric"
              pattern="[0-9.]*"
              value={form.sellingPrice}
              onChange={(e) => set('sellingPrice', e.target.value)}
              placeholder="5000"
              required
            />
          </Field>
          <Field label="SKU" hint={product ? undefined : 'Kosongkan agar dibuat otomatis.'}>
            <input
              className={input}
              value={form.sku}
              onChange={(e) => set('sku', e.target.value.replace(/\s/g, ''))}
              maxLength={64}
              required={Boolean(product)}
            />
          </Field>
          <Field label="Satuan">
            <input className={input} value={form.unit} onChange={(e) => set('unit', e.target.value)} maxLength={20} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Barcode" hint="Satu barcode per baris, tanpa spasi.">
              <textarea
                className={input}
                rows={2}
                value={form.barcodes}
                onChange={(e) => set('barcodes', e.target.value)}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-ink sm:col-span-2">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
              className="size-4 accent-brand"
            />
            Aktif (tampil di kasir)
          </label>
          {error && (
            <div className="sm:col-span-2">
              <Alert>{error}</Alert>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            {product ? (
              <button
                type="button"
                className={danger}
                disabled={busy}
                onClick={() => {
                  if (confirm(`Hapus produk “${product.name}”?`)) void run(() => deleteProduct({ data: product.id }))
                }}
              >
                Hapus produk
              </button>
            ) : (
              <span />
            )}
            <button type="submit" className={primary} disabled={busy}>
              {busy ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}
