import { Alert, Button, CheckBox, Icon, Select, TextField, Upload, toast } from '@umkmall/ui/primitives'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { notifySuccess, showError, type FailureLike } from '@/lib/feedback'
import { useConfirm } from '@/components/confirm'
import { Panel, RequiredLabel } from '@/components/page'
import { GENERIC_ERROR, placeErrors } from '@/lib/refusal'
import { IMAGE_ERROR, plainNumber, productErrors, splitImages, type Errors } from '@/lib/validate'
import {
  deleteImage,
  findBarcodeHolder,
  isStockedType,
  recordOpeningStock,
  saveProduct,
  uploadImage,
  type Category,
  type Product,
  type ProductInput,
  type ProductType,
} from '../-api'
import {
  MAX_TIERS,
  MAX_UNITS,
  blankTier,
  blankUnit,
  clearRowErrors,
  tierErrors,
  tierRowsOf,
  tiersToInput,
  unitErrors,
  unitHint,
  unitRowsOf,
  unitsToInput,
  type TierRow,
  type UnitRow,
} from './-helpers'
import { ActionRow } from '@/components/action-row'
import { BarcodeScanSheet, canShowScan, useScanSupport } from '@/components/barcode-scanner'
import { fieldScanResult, normalizeCode, type ScanResult } from '@/lib/barcode-scan'

export const TYPE_LABEL: Record<ProductType, string> = {
  product: 'Barang',
  service: 'Jasa',
  non_stock: 'Tanpa stok',
  ingredient: 'Bahan baku',
}
const TYPES = (Object.keys(TYPE_LABEL) as ProductType[]).map((value) => ({ value, label: TYPE_LABEL[value] }))

const FIELDS = ['name', 'categoryId', 'sku', 'unit', 'costPrice', 'sellingPrice', 'type', 'barcodes', 'lowStockThreshold', 'file', 'units', 'priceTiers'] as const

/**
 * Lakasir's product form: images, name, barcodes (repeater), SKU (blank = generated), category, stock (create only),
 * unit, initial and selling price, type. Create saves first, then records opening stock and uploads the images.
 */
export function ProductForm({ categories, product }: { categories: Category[]; product?: Product }) {
  const navigate = useNavigate()
  const router = useRouter()
  const confirm = useConfirm()
  // UMK-1986: the camera fills one barcode row at a time.
  const scanSupport = useScanSupport()
  const [scanRow, setScanRow] = useState<number | null>(null)
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
    lowStockThreshold: '5',
    units: [] as UnitRow[],
    priceTiers: [] as TierRow[],
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
          lowStockThreshold: String(product.lowStockThreshold),
          units: unitRowsOf(product.units),
          priceTiers: tierRowsOf(product.priceTiers),
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
  const verb = product ? 'menyimpan produk' : 'membuat produk'
  const fail = (failure: FailureLike | string) => {
    const f = typeof failure === 'string' ? { error: failure } : failure
    setError(f.error)
    showError(f, verb)
  }

  async function submit(e: FormEvent, again = false) {
    e.preventDefault()
    if (busy) return
    setError(undefined)
    const found = {
      ...productErrors(form, Boolean(product)),
      ...unitErrors(form.units, form.unit || 'PCS'),
      ...tierErrors(form.priceTiers, form.sellingPrice),
    }
    setErrors(found)
    if (Object.keys(found).length) return showError({ status: 422, error: 'Beberapa isian belum benar. Periksa yang ditandai merah.' }, verb)
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
      lowStockThreshold: Number(plainNumber(form.lowStockThreshold) || '5'),
      barcodes: form.barcodes.map((b) => b.trim()).filter(Boolean),
      units: unitsToInput(form.units),
      priceTiers: tiersToInput(form.priceTiers),
    }
    setBusy(true)
    try {
      const saved = await saveProduct({ data: { id: product?.id, input } })
      if (saved.error) {
        const placed = placeErrors({ error: saved.error, errors: saved.errors }, FIELDS)
        setErrors(placed.byField)
        if (placed.formError) setError(placed.formError)
        showError(saved, verb)
        return
      }
      const id = product?.id ?? saved.id
      if (!id) return fail({ error: GENERIC_ERROR, status: 500 })
      const problems: string[] = []
      const qty = Number(plainNumber(form.stock) || '0')
      if (!product && isStockedType(form.type) && qty > 0) {
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
      notifySuccess(product ? `Produk ${input.name} disimpan` : `Produk ${input.name} dibuat`)
      if (problems.length)
        showError(
          { error: problems.join(' ') },
          { action: 'mencatat stok awal atau gambar', fallback: 'Produk tersimpan, tetapi stok awal atau gambar belum tercatat.' },
        )
      // Saved, but a unit costs more than buying loose at the best price: the server says so, the owner decides.
      for (const w of saved.warnings ?? []) toast(w.message, { variant: 'warning' })
      if (again) {
        setForm(blank)
        setFiles([])
      } else await navigate({ to: '/catalog/products/$id', params: { id } })
    } catch {
      fail({ error: GENERIC_ERROR, status: 0 })
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
                      if (r.error) return r
                      notifySuccess('Gambar dihapus')
                      await router.invalidate()
                    }, { action: 'menghapus gambar' })
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
              {canShowScan(scanSupport) && (
                <Button
                  type="outline"
                  color="light"
                  iconOnly
                  aria-label={`Scan barcode ${i + 1}`}
                  onClick={() => setScanRow(i)}
                >
                  <Icon name="camera" size="sm" />
                </Button>
              )}
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
          <ActionRow align="start">
            <Button
              type="outline"
              color="light"
              width="auto"
              onClick={() => set('barcodes', [...form.barcodes, ''])}
            >
              <Plus className="size-4" aria-hidden /> Tambah barcode
            </Button>
            {canShowScan(scanSupport) && (
              <Button
                type="outline"
                color="light"
                width="auto"
                onClick={() => {
                  // A new empty row, scanned into at once.
                  set('barcodes', [...form.barcodes, ''])
                  setScanRow(form.barcodes.length)
                }}
              >
                <Icon name="camera" size="sm" /> Scan barcode
              </Button>
            )}
          </ActionRow>
          <BarcodeScanSheet
            open={scanRow !== null}
            closeOnOk
            title="Scan barcode"
            onClose={() => setScanRow(null)}
            onCode={async (code): Promise<ScanResult> => {
              const row = scanRow
              const holder = await findBarcodeHolder({ data: code })
              // The product being edited holding its own code is not a clash.
              const other = holder && holder.id !== product?.id ? holder.name : null
              const r = fieldScanResult(
                code,
                form.barcodes.filter((_, j) => j !== row),
                other,
              )
              if (r.kind === 'ok' && row !== null) {
                setForm((f) => ({ ...f, barcodes: f.barcodes.map((b, j) => (j === row ? normalizeCode(code) : b)) }))
                setErrors(({ [`barcodes.${row}`]: _gone, ...rest }) => rest)
              }
              return r
            }}
          />
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
            disabled={!isStockedType(form.type)}
            placeholder={isStockedType(form.type) ? '0' : 'Tidak memakai stok'}
            error={errors.stock}
          />
        )}
        <TextField
          label="Batas stok menipis"
          inputMode="numeric"
          value={form.lowStockThreshold}
          onChange={(e) => set('lowStockThreshold', e.target.value)}
          disabled={!isStockedType(form.type)}
          placeholder="5"
          error={errors.lowStockThreshold}
        />
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

      <UnitsEditor
        baseUnit={form.unit}
        sellingPrice={form.sellingPrice}
        rows={form.units}
        errors={errors}
        onChange={(rows, i) => {
          set('units', rows)
          setErrors((all) => clearRowErrors(all, 'units', i))
        }}
      />
      <TiersEditor
        baseUnit={form.unit}
        rows={form.priceTiers}
        errors={errors}
        onChange={(rows, i) => {
          set('priceTiers', rows)
          setErrors((all) => clearRowErrors(all, 'priceTiers', i))
        }}
      />

      {error && <Alert variant="danger">{error}</Alert>}

      <ActionRow>
        <Button asChild type="outline" color="light" size="small" width="auto">
          <Link to={product ? '/catalog/products/$id' : '/catalog/products'} params={{ id: product?.id ?? '' }}>
            Batal
          </Link>
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
        <Button htmlType="submit" type="primary" color="primary" size="small" width="auto" isLoading={busy}>
          {product ? 'Simpan perubahan' : 'Simpan'}
        </Button>
      </ActionRow>
      {confirm.dialog}
    </form>
  )
}

/** UMK-1985 "Satuan lain": a pack of the base unit with its own fixed price (1 dus = 24 pcs). */
function UnitsEditor({
  baseUnit,
  sellingPrice,
  rows,
  errors,
  onChange,
}: {
  baseUnit: string
  sellingPrice: string
  rows: UnitRow[]
  errors: Errors
  onChange: (rows: UnitRow[], changedRow?: number) => void
}) {
  const patch = (i: number, p: Partial<UnitRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)), i)
  return (
    <Panel className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-semibold text-default-primary">Satuan lain</h2>
        <p className="text-sm text-default-secondary">
          Jual juga per kemasan, misalnya dus. Stok tetap dihitung dalam {baseUnit.trim() || 'satuan dasar'}.
        </p>
      </div>
      {errors.units && <Alert variant="danger" size="small">{errors.units}</Alert>}
      {rows.length === 0 && <p className="text-sm text-default-secondary">Belum ada satuan lain.</p>}
      {rows.map((r, i) => {
        const hint = unitHint(r, baseUnit, sellingPrice)
        return (
          <fieldset key={i} className="grid gap-3 rounded-lg border border-border-light p-4 md:grid-cols-3">
            <legend className="px-1 text-sm font-medium text-default-primary">Satuan {i + 1}</legend>
            <TextField
              label="Nama satuan"
              value={r.name}
              onChange={(e) => patch(i, { name: e.target.value })}
              placeholder="Contoh: Dus"
              maxLength={20}
              required
              error={errors[`units.${i}.name`]}
            />
            <TextField
              label={`Isi (${baseUnit.trim() || 'satuan dasar'})`}
              inputMode="numeric"
              value={r.unitQty}
              onChange={(e) => patch(i, { unitQty: e.target.value })}
              placeholder="24"
              required
              error={errors[`units.${i}.unitQty`]}
            />
            <TextField
              label="Harga per satuan"
              prefix="Rp"
              inputMode="numeric"
              value={r.price}
              onChange={(e) => patch(i, { price: e.target.value })}
              placeholder="78000"
              required
              error={errors[`units.${i}.price`]}
            />
            <div className="flex items-center justify-between gap-2 md:col-span-3">
              <span className="text-xs text-default-secondary">{hint}</span>
              <Button
                type="text"
                color="danger"
                size="small"
                width="auto"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                Hapus
              </Button>
            </div>
          </fieldset>
        )
      })}
      <Button
        type="outline"
        color="light"
        size="small"
        width="auto"
        className="self-start"
        disabled={rows.length >= MAX_UNITS}
        onClick={() => onChange([...rows, blankUnit()])}
      >
        <Plus className="size-4" aria-hidden /> Tambah satuan
      </Button>
    </Panel>
  )
}

/** UMK-1985 "Harga grosir": the base unit's price per unit once the cart holds at least `minQty` of the product. */
function TiersEditor({
  baseUnit,
  rows,
  errors,
  onChange,
}: {
  baseUnit: string
  rows: TierRow[]
  errors: Errors
  onChange: (rows: TierRow[], changedRow?: number) => void
}) {
  const unit = baseUnit.trim() || 'satuan dasar'
  const patch = (i: number, p: Partial<TierRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)), i)
  return (
    <Panel className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-semibold text-default-primary">Harga grosir per {unit}</h2>
        <p className="text-sm text-default-secondary">
          Harga turun saat jumlah di keranjang (dihitung dalam {unit}) mencapai batas. Urutkan dari jumlah terkecil;
          harga makin murah.
        </p>
      </div>
      {errors.priceTiers && <Alert variant="danger" size="small">{errors.priceTiers}</Alert>}
      {rows.length === 0 && <p className="text-sm text-default-secondary">Belum ada harga grosir.</p>}
      {rows.map((r, i) => (
        <div key={i} className="grid items-start gap-3 md:grid-cols-[1fr_1fr_auto]">
          <TextField
            label={`Beli mulai (${unit})`}
            inputMode="numeric"
            value={r.minQty}
            onChange={(e) => patch(i, { minQty: e.target.value })}
            placeholder="12"
            required
            error={errors[`priceTiers.${i}.minQty`]}
          />
          <TextField
            label={`Harga per ${unit}`}
            prefix="Rp"
            inputMode="numeric"
            value={r.price}
            onChange={(e) => patch(i, { price: e.target.value })}
            placeholder="3300"
            required
            error={errors[`priceTiers.${i}.price`]}
          />
          <Button
            type="text"
            color="danger"
            size="small"
            width="auto"
            className="md:mt-7"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            Hapus
          </Button>
        </div>
      ))}
      <Button
        type="outline"
        color="light"
        size="small"
        width="auto"
        className="self-start"
        disabled={rows.length >= MAX_TIERS}
        onClick={() => onChange([...rows, blankTier()])}
      >
        <Plus className="size-4" aria-hidden /> Tambah harga grosir
      </Button>
    </Panel>
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
