import { parseRupiah } from './-money'

// UMK-2130 "Produk cepat" (design 44, screen 5): pure checks for the till's quick product form. pos-api checks the
// same again (422) and puts the product in "Lainnya" as a non-stock product.

export type QuickProductForm = { name: string; price: string; cost: string }
export type QuickProductErrors = Partial<Record<'name' | 'sellingPrice' | 'costPrice', string>>
export type QuickProductBody = { name: string; sellingPrice: number; costPrice?: number; barcode?: string }

/** The body to send, or the errors to show under each field. Cost is optional: blank means "Belum diisi". */
export function quickProductBody(
  form: QuickProductForm,
  barcode?: string,
): { ok: true; body: QuickProductBody } | { ok: false; errors: QuickProductErrors } {
  const errors: QuickProductErrors = {}
  const name = form.name.trim()
  if (!name) errors.name = 'Nama produk wajib diisi'
  else if (name.length > 120) errors.name = 'Maksimal 120 karakter'
  const price = parseRupiah(form.price)
  if (!form.price.trim()) errors.sellingPrice = 'Harga jual wajib diisi'
  else if (Number.isNaN(price)) errors.sellingPrice = 'Harus bilangan bulat rupiah, misalnya 15.000'
  else if (price <= 0) errors.sellingPrice = 'Harga jual harus lebih dari 0'
  let cost: number | undefined
  if (form.cost.trim()) {
    cost = parseRupiah(form.cost)
    if (Number.isNaN(cost)) errors.costPrice = 'Harus bilangan bulat rupiah, misalnya 9.000'
    else if (!errors.sellingPrice && cost > price) errors.costPrice = 'Harga modal tidak boleh melebihi harga jual'
  }
  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    body: { name, sellingPrice: price, ...(cost ? { costPrice: cost } : {}), ...(barcode ? { barcode } : {}) },
  }
}

/** pos-api's field errors (`errors` by field name) mapped onto the form's fields; other keys are dropped. */
export function quickProductServerErrors(errors: Record<string, string> | undefined): QuickProductErrors {
  const out: QuickProductErrors = {}
  for (const k of ['name', 'sellingPrice', 'costPrice'] as const) if (errors?.[k]) out[k] = errors[k]
  return out
}
