import { Alert, Button, CheckBox, Select, TextField, Upload, toast } from '@umkmall/ui/primitives'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useConfirm } from '@/components/confirm'
import { Panel, RequiredLabel } from '@/components/page'
import { GENERIC_ERROR, placeErrors } from '@/lib/refusal'
import { IMAGE_ERROR, plainNumber, productErrors, splitImages, type Errors } from '@/lib/validate'
import {
  deleteImage,
  recordOpeningStock,
  saveProduct,
  uploadImage,
  type Category,
  type Product,
  type ProductInput,
  type ProductType,
} from '../-api'

export const TYPE_LABEL: Record<ProductType, string> = { product: 'Barang', service: 'Jasa', non_stock: 'Tanpa stok' }
const TYPES = (Object.keys(TYPE_LABEL) as ProductType[]).map((value) => ({ value, label: TYPE_LABEL[value] }))

const FIELDS = ['name', 'categoryId', 'sku', 'unit', 'costPrice', 'sellingPrice', 'type', 'barcodes', 'file'] as const

/**
 * Lakasir's product form: images, name, barcodes (repeater), SKU (blank = generated), category, stock (create only),
 * unit, initial and selling price, type. Create saves first, then records opening stock and uploads the images.
 */
export function ProductForm({ categories, product }: { categories: Category[]; product?: Product }) {
  const navigate = useNavigate()
  const router = useRouter()
  const confirm = useConfirm()
  const blank = {
    name: '',
    sku: '',
    categoryId: categories[0]?.id ?? '',
    unit: 'PCS',
    costPrice: '0',
    sellingPrice: '',
    type: 'product' as ProductType,
    isActive: true,
    barcodes: [] as string[],
    stock: '',
  }
  const [form, setForm] = useState(
    product
      ? {
          ...blank,
          name: product.name,
          sku: product.sku,
          categoryId: product.categoryId,
          unit: product.unit,
          costPrice: String(product.costPrice ?? 0),
          sellingPrice: String(product.sellingPrice),
          type: product.type,
          isActive: product.isActive,
          barcodes: product.barcodes,
        }
      : blank,
  )
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [errors, setErrors] = useState<Errors>({})
  // Editing a field clears its message; the next submit checks again.
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors(({ [k]: _gone, ...rest }) => rest)
  }
  const fail = (message: string) => {
    setError(message)
    toast(message, { variant: 'danger' })
  }

  async function submit(e: FormEvent, again = false) {
    e.preventDefault()
    if (busy) return
    setError(undefined)
    const found = productErrors(form, Boolean(product))
    setErrors(found)
    if (Object.keys(found).length) return toast('Periksa kembali isian kamu', { variant: 'danger' })
    const costPrice = Number(plainNumber(form.costPrice) || '0')
    const sellingPrice = Number(plainNumber(form.sellingPrice))
    const input: ProductInput = {
      categoryId: form.categoryId,
      name: form.name.trim(),
      sku: form.sku.trim(),
      unit: form.unit.trim() || 'PCS',
      costPrice,
      sellingPrice,
      type: form.type,
      isActive: form.isActive,
      barcodes: form.barcodes.map((b) => b.trim()).filter(Boolean),
    }
    setBusy(true)
    try {
      const saved = await saveProduct({ data: { id: product?.id, input } })
      if (saved.error) {
        const placed = placeErrors({ error: saved.error, errors: saved.errors }, FIELDS)
        setErrors(placed.byField)
        if (placed.formError) setError(placed.formError)
        toast(saved.error, { variant: 'danger' })
        return
      }
      const id = product?.id ?? saved.id
      if (!id) return fail(GENERIC_ERROR)
      const problems: string[] = []
      const qty = Number(plainNumber(form.stock) || '0')
      if (!product && form.type === 'product' && qty > 0) {
        const r = await recordOpeningStock({ data: { productId: id, qty } })
        if (r.error) problems.push(`Stok awal belum tercatat: ${r.error}`)
      }
      for (const file of files) {
        const body = new FormData()
        body.set('productId', id)
        body.set('file', file)
        const r = await uploadImage({ data: body })
        if (r.error) problems.push(`${file.name}: ${r.error}`)
      }
      toast(product ? 'Produk disimpan' : 'Produk dibuat', { variant: 'success' })
      if (problems.length) toast(problems.join(' '), { variant: 'warning' })
      if (again) {
        setForm(blank)
        setFiles([])
      } else await navigate({ to: '/catalog/products/$id', params: { id } })
    } catch {
      fail(GENERIC_ERROR)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
      <Panel className="grid gap-5 p-6 md:grid-cols-2">
        <div className="flex flex-col gap-3 md:col-span-2">
          <Upload
            label="Gambar produk"
            accept="image/jpeg,image/png,image/webp"
            multiple
            filled={files.length > 0}
            onFilesChange={(picked) => {
              const { accepted, refused } = splitImages(picked)
              setFiles((f) => [...f, ...accepted])
              setErrors(({ file: _gone, ...rest }) => (refused.length ? { ...rest, file: IMAGE_ERROR } : rest))
            }}
            helperText="JPG, PNG atau WebP, paling besar 2 MB per gambar."
            browseLabel="Pilih"
            error={errors.file}
          >
            {files.length ? `${files.length} gambar siap diunggah` : 'Tarik gambar ke sini atau pilih dari perangkat'}
          </Upload>
          {(files.length > 0 || (product?.images?.length ?? 0) > 0) && (
            <ul className="flex flex-wrap gap-3">
              {product?.images?.map((img) => (
                <Thumb
                  key={img.id}
                  src={`/catalog/products/${product.id}/gambar/${img.id}`}
                  label="Hapus gambar"
                  onRemove={() =>
                    confirm.ask('Hapus gambar ini?', async () => {
                      const r = await deleteImage({ data: { productId: product.id, imageId: img.id } })
                      if (r.error) return r.error
                      await router.invalidate()
                    })
                  }
                />
              ))}
              {files.map((f, i) => (
                <Thumb
                  key={`${f.name}-${i}`}
                  src={URL.createObjectURL(f)}
                  label={`Batalkan ${f.name}`}
                  onRemove={() => setFiles((all) => all.filter((_, j) => j !== i))}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="md:col-span-2">
          <TextField
            label="Nama"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Contoh: Es Teh Manis"
            maxLength={120}
            required
            error={errors.name}
          />
        </div>

        <fieldset className="flex flex-col gap-2 md:col-span-2">
          <legend className="mb-2 text-sm font-medium text-default-primary">Barcode</legend>
          {form.barcodes.map((code, i) => (
            <div key={i} className="flex items-center gap-2">
              <TextField
                aria-label={`Barcode ${i + 1}`}
                value={code}
                onChange={(e) => {
                  set(
                    'barcodes',
                    form.barcodes.map((b, j) => (j === i ? e.target.value.replace(/\s/g, '') : b)),
                  )
                  setErrors(({ [`barcodes.${i}`]: _gone, ...rest }) => rest)
                }}
                maxLength={64}
                className="flex-1"
                error={errors[`barcodes.${i}`] ?? (i === 0 ? errors.barcodes : undefined)}
              />
              <Button
                type="text"
                color="danger"
                iconOnly
                aria-label={`Hapus barcode ${i + 1}`}
                onClick={() => {
                  set('barcodes', form.barcodes.filter((_, j) => j !== i))
                  setErrors((all) => Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith('barcodes'))))
                }}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="outline"
            color="light"
            size="small"
            width="auto"
            className="self-center"
            onClick={() => set('barcodes', [...form.barcodes, ''])}
          >
            <Plus className="size-4" aria-hidden /> Tambah barcode
          </Button>
        </fieldset>

        <div className="flex flex-col gap-1">
          <TextField
            label="SKU"
            value={form.sku}
            onChange={(e) => set('sku', e.target.value.replace(/\s/g, ''))}
            maxLength={64}
            required={Boolean(product)}
            error={errors.sku}
          />
          {!product && <span className="text-xs text-default-secondary">Kosongkan agar dibuat otomatis.</span>}
        </div>
        <Select
          label={<RequiredLabel>Kategori</RequiredLabel>}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={form.categoryId}
          onValueChange={(v) => set('categoryId', v)}
          showSearch
          searchPlaceholder="Cari kategori"
          emptyMessage="Kategori tidak ditemukan"
          error={errors.categoryId}
        />

        {!product && (
          <TextField
            label="Stok awal"
            inputMode="numeric"
            value={form.stock}
            onChange={(e) => set('stock', e.target.value)}
            disabled={form.type !== 'product'}
            placeholder={form.type === 'product' ? '0' : 'Tidak memakai stok'}
            error={errors.stock}
          />
        )}
        <TextField
          label="Satuan"
          value={form.unit}
          onChange={(e) => set('unit', e.target.value)}
          maxLength={20}
          required
          error={errors.unit}
        />

        <TextField
          label="Harga modal"
          prefix="Rp"
          inputMode="numeric"
          value={form.costPrice}
          onChange={(e) => set('costPrice', e.target.value)}
          required
          error={errors.costPrice}
        />
        <TextField
          label="Harga jual"
          prefix="Rp"
          inputMode="numeric"
          value={form.sellingPrice}
          onChange={(e) => set('sellingPrice', e.target.value)}
          placeholder="5000"
          required
          error={errors.sellingPrice}
        />

        <Select
          label="Jenis"
          options={TYPES}
          value={form.type}
          onValueChange={(v) => set('type', v as ProductType)}
        />
        <div className="flex items-end pb-3">
          <CheckBox
            label="Aktif (tampil di kasir)"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />
        </div>
      </Panel>

      {error && <Alert variant="danger">{error}</Alert>}

      <div className="flex flex-wrap gap-2">
        <Button htmlType="submit" type="primary" color="primary" size="small" width="auto" isLoading={busy}>
          {product ? 'Simpan perubahan' : 'Simpan'}
        </Button>
        {!product && (
          <Button
            type="outline"
            color="light"
            size="small"
            width="auto"
            disabled={busy}
            onClick={(e) => void submit(e as unknown as FormEvent, true)}
          >
            Simpan & buat lagi
          </Button>
        )}
        <Button asChild type="outline" color="light" size="small" width="auto">
          <Link to={product ? '/catalog/products/$id' : '/catalog/products'} params={{ id: product?.id ?? '' }}>
            Batal
          </Link>
        </Button>
      </div>
      {confirm.dialog}
    </form>
  )
}

function Thumb({ src, label, onRemove }: { src: string; label: string; onRemove: () => void }) {
  return (
    <li className="relative size-24 overflow-hidden rounded-lg border border-border-light bg-default-secondary">
      <img src={src} alt="" className="size-full object-cover" />
      <button
        type="button"
        aria-label={label}
        onClick={onRemove}
        className="absolute top-1 right-1 rounded-full bg-default-primary p-1 text-default-error shadow"
      >
        <X className="size-3" aria-hidden />
      </button>
    </li>
  )
}
