import { check } from './form-checks'

/**
 * Client checks that mirror pos-api's zod rules and messages, so a form answers before the round trip. The server
 * stays the authority: its 422/409 field errors land on the same fields.
 */
export type Errors = Record<string, string>

export const required = (value: string, message: string): string | undefined =>
  value.trim() ? undefined : message

function code(value: string, what: string): string | undefined {
  if (/\s/.test(value)) return `${what} tidak boleh berisi spasi`
  if (value.length < 3) return `${what} minimal 3 karakter`
  if (value.length > 64) return `${what} maksimal 64 karakter`
}

/**
 * Accepts Indonesian thousand dots only when they group correctly ("5.000", "1.250.000" → digits); anything else
 * ("1.5", "-2", "1,5") is returned unchanged so the whole-number check names it.
 */
export const plainNumber = (text: string) => {
  const t = text.trim()
  return /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t
}

const compact = (e: Record<string, string | undefined>): Errors =>
  Object.fromEntries(Object.entries(e).filter((kv): kv is [string, string] => Boolean(kv[1])))

export type ProductFields = {
  name: string
  categoryId: string
  sku: string
  unit: string
  costPrice: string
  sellingPrice: string
  barcodes: string[]
  stock: string
  lowStockThreshold: string
}

/**
 * Same rules as `ProductCreate`/`ProductUpdate`. Prices and stock arrive as the raw text typed, never silently
 * cleaned: "-2" or "1,5" gets a message instead of becoming 2 or 15.
 */
export function productErrors(f: ProductFields, editing: boolean): Errors {
  const sellingText = plainNumber(f.sellingPrice)
  const costText = plainNumber(f.costPrice) || '0'
  const sellingBad = sellingText === '' ? 'Harga jual wajib diisi' : check.wholeNumber(sellingText, { min: 1, label: 'Harga jual' })
  const costBad = check.wholeNumber(costText, { label: 'Harga modal' })
  const selling = Number(sellingText)
  const cost = Number(costText)
  const e: Record<string, string | undefined> = {
    name: required(f.name, 'Nama produk wajib diisi') ?? (f.name.trim().length > 120 ? 'Maksimal 120 karakter' : undefined),
    categoryId: f.categoryId ? undefined : 'Pilih kategori',
    unit: required(f.unit, 'Satuan wajib diisi') ?? (f.unit.trim().length > 20 ? 'Maksimal 20 karakter' : undefined),
    sellingPrice: sellingBad,
    costPrice: costBad ?? (!sellingBad && cost > selling ? 'Harga modal tidak boleh melebihi harga jual' : undefined),
    sku: f.sku === '' ? (editing ? 'SKU wajib diisi' : undefined) : code(f.sku, 'SKU'),
  }
  const seen = new Set<string>()
  f.barcodes.forEach((b, i) => {
    const v = b.trim()
    e[`barcodes.${i}`] = code(v, 'Barcode') ?? (seen.has(v) ? 'Barcode tidak boleh ganda' : undefined)
    seen.add(v)
  })
  if (f.lowStockThreshold.trim() !== '')
    e.lowStockThreshold = check.wholeNumber(plainNumber(f.lowStockThreshold), {
      label: 'Batas stok menipis',
      max: 1_000_000,
    })
  if (f.stock.trim() !== '') e.stock = check.wholeNumber(plainNumber(f.stock), { label: 'Stok awal' })
  return compact(e)
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const IMAGE_ERROR = 'Gambar harus JPG, PNG atau WebP, maksimal 2 MB'

/** pos-api's image rule (type sniffed server-side, 2 MB cap): split picked files into accepted and refused. */
export function splitImages<F extends { type: string; size: number }>(files: readonly F[]) {
  const ok = (f: F) => IMAGE_TYPES.includes(f.type) && f.size <= 2 * 1024 * 1024
  return { accepted: files.filter(ok), refused: files.filter((f) => !ok(f)) }
}

/** Same rules as the staff schema: name, 4–8 digit PIN (optional when editing), matching confirmation. */
export function staffErrors(f: { name: string; pin: string; pin2: string }, editing: boolean): Errors {
  return compact({
    name: required(f.name, 'Nama wajib diisi') ?? (f.name.trim().length > 100 ? 'Maksimal 100 karakter' : undefined),
    pin: editing && f.pin === '' ? undefined : /^\d{4,8}$/.test(f.pin) ? undefined : 'PIN harus 4 sampai 8 angka',
    pin2: f.pin !== f.pin2 ? 'Konfirmasi PIN tidak sama' : undefined,
  })
}

/** Same rules as pos-api's store profile schema. */
export function storeProfileErrors(f: {
  name: string
  businessType: string
  otherBusinessType: string
  address: string
}): Errors {
  return compact({
    name: required(f.name, 'Nama toko wajib diisi') ?? (f.name.trim().length > 120 ? 'Maksimal 120 karakter' : undefined),
    businessType: f.businessType ? undefined : 'Pilih jenis usaha',
    otherBusinessType:
      f.businessType === 'other' ? required(f.otherBusinessType, 'Jenis usaha lainnya wajib diisi') : undefined,
    address:
      required(f.address, 'Alamat toko wajib diisi') ?? (f.address.trim().length > 500 ? 'Maksimal 500 karakter' : undefined),
  })
}

/** Tax as typed in percent ("11", "11,5", "11.25") → basis points (pos-api's taxBps, 0–10.000), or the message. */
export function taxToBps(text: string): { bps: number } | { error: string } {
  const t = text.trim().replace(',', '.')
  if (!t) return { error: 'Pajak wajib diisi' }
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return { error: 'Pajak harus angka 0 sampai 100, paling banyak 2 desimal' }
  const bps = Math.round(Number(t) * 100)
  return bps > 10_000 ? { error: 'Pajak maksimal 100%' } : { bps }
}
