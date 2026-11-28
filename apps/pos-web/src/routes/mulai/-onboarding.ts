import { parseRupiah } from '../kasir/-money'
import type { ApplyResult, PricesResult } from './-api'

// UMK-2128 (design 44): pure rules of the template and "Isi harga" screens.

/** "Toko siap: 24 produk ditambahkan"; a second apply that added nothing says so. */
export function applyToast(r: ApplyResult): string {
  if (r.created === 0) return 'Semua produk template ini sudah ada di toko'
  return `Toko siap: ${r.created} produk ditambahkan`
}

/** The template button: "Pakai template Warung makan". */
export const templateButtonLabel = (name: string) => `Pakai template ${name}`

export type PriceErrors = Record<string, string>

/**
 * The prices to send from the typed texts (blank = fill later), or the errors to show under each field.
 * Whole rupiah above 0, like pos-api.
 */
export function pricesBody(
  texts: Record<string, string>,
): { ok: true; items: { id: string; sellingPrice: number }[] } | { ok: false; errors: PriceErrors } {
  const errors: PriceErrors = {}
  const items: { id: string; sellingPrice: number }[] = []
  for (const [id, text] of Object.entries(texts)) {
    if (!text.trim()) continue
    const n = parseRupiah(text)
    if (Number.isNaN(n)) errors[id] = 'Harus bilangan bulat rupiah, misalnya 12.000'
    else if (n <= 0) errors[id] = 'Harga harus lebih dari 0'
    else if (n > 1_000_000_000_000) errors[id] = 'Harga terlalu besar'
    else items.push({ id, sellingPrice: n })
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, items }
}

/** The line under the list: how many are still without a price, and what that means at the till. */
export function remainingText(left: number): string {
  if (left === 0) return 'Semua produk sudah punya harga.'
  return `Sisa ${left} produk tanpa harga. Bisa diisi nanti; produk tanpa harga tidak tampil di kasir.`
}

/** The toast after a save: "3 harga disimpan". */
export function pricesToast(r: PricesResult): string {
  return `${r.priced} harga disimpan`
}

/** Products in their categories, in the order the list came (pos-api sorts by category, then name). */
export function byCategory<T extends { category: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(item.category, [...(groups.get(item.category) ?? []), item])
  return [...groups]
}
