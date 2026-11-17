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
}

/** Same rules as `ProductCreate`/`ProductUpdate`; prices and stock arrive as digit strings. */
export function productErrors(f: ProductFields, editing: boolean): Errors {
  const selling = f.sellingPrice === '' ? NaN : Number(f.sellingPrice)
  const cost = Number(f.costPrice || '0')
  const e: Record<string, string | undefined> = {
    name: required(f.name, 'Nama produk wajib diisi') ?? (f.name.trim().length > 120 ? 'Maksimal 120 karakter' : undefined),
    categoryId: f.categoryId ? undefined : 'Pilih kategori',
    unit: required(f.unit, 'Satuan wajib diisi') ?? (f.unit.trim().length > 20 ? 'Maksimal 20 karakter' : undefined),
    sellingPrice: Number.isNaN(selling)
      ? 'Harga jual wajib diisi'
      : selling <= 0
        ? 'Harga jual harus lebih dari 0'
        : undefined,
    costPrice: !Number.isNaN(selling) && cost > selling ? 'Harga modal tidak boleh melebihi harga jual' : undefined,
    sku: f.sku === '' ? (editing ? 'SKU wajib diisi' : undefined) : code(f.sku, 'SKU'),
  }
  const seen = new Set<string>()
  f.barcodes.forEach((b, i) => {
    const v = b.trim()
    e[`barcodes.${i}`] = code(v, 'Barcode') ?? (seen.has(v) ? 'Barcode tidak boleh ganda' : undefined)
    seen.add(v)
  })
  if (f.stock !== '' && !/^\d+$/.test(f.stock)) e.stock = 'Stok harus bilangan bulat'
  return compact(e)
}

/** Same rules as the staff schema: name, 4–8 digit PIN (optional when editing), matching confirmation. */
export function staffErrors(f: { name: string; pin: string; pin2: string }, editing: boolean): Errors {
  return compact({
    name: required(f.name, 'Nama wajib diisi') ?? (f.name.trim().length > 100 ? 'Maksimal 100 karakter' : undefined),
    pin: editing && f.pin === '' ? undefined : /^\d{4,8}$/.test(f.pin) ? undefined : 'PIN harus 4 sampai 8 angka',
    pin2: f.pin !== f.pin2 ? 'Konfirmasi PIN tidak sama' : undefined,
  })
}
