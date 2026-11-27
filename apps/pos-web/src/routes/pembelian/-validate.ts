import { check, compact, type FieldErrors } from '../../lib/form-checks'

/** `expiresAt` is `YYYY-MM-DD` or empty (UMK-2087: the batch does not expire). */
export type OrderLine = { productId: string; qty: string; unitCost: string; expiresAt?: string }
export type OpnameLine = { productId: string; countedQty: string; reason: string }
/** An empty date is fine; a filled one must be a real calendar day. Whether it is before today is the server's call. */
export function checkExpiry(v: string | undefined): string | undefined {
  if (!v) return undefined
  const t = Date.parse(`${v}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(t) && new Date(t).toISOString().startsWith(v)
    ? undefined
    : 'Tanggal kedaluwarsa tidak valid'
}
export const toInt = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN)

// Mirrors pos-api's OrderCreate: supplier required, qty 1–100.000, unit cost Rp0–1.000.000.000, one line per
// product, total ≤ Rp1 triliun. Field keys match the server's (`lines.0.qty`) so both land on the same field.
export function validateOrder(v: { supplierId: string; lines: OrderLine[] }): FieldErrors {
  const seen = new Set<string>()
  const e: Record<string, string | undefined> = { supplierId: v.supplierId ? undefined : 'Pilih pemasok' }
  v.lines.forEach((l, i) => {
    e[`lines.${i}.productId`] = !l.productId
      ? 'Pilih produk'
      : seen.has(l.productId)
        ? 'Satu produk cukup satu baris'
        : undefined
    seen.add(l.productId)
    e[`lines.${i}.qty`] = check.wholeNumber(l.qty, { min: 1, max: 100_000 })
    e[`lines.${i}.unitCost`] = check.wholeNumber(l.unitCost, { max: 1_000_000_000, label: 'Harga beli' })
    e[`lines.${i}.expiresAt`] = checkExpiry(l.expiresAt)
  })
  const total = v.lines.reduce((n, l) => n + (toInt(l.qty) * toInt(l.unitCost) || 0), 0)
  if (total > 1_000_000_000_000) e.lines = 'Total pembelian maksimal Rp1.000.000.000.000'
  return compact(e)
}

// Mirrors pos-api's OpnameCreate: product required once, counted 0–1.000.000, reason ≤ 200.
export function validateOpname(lines: OpnameLine[]): FieldErrors {
  const seen = new Set<string>()
  const e: Record<string, string | undefined> = {}
  lines.forEach((l, i) => {
    e[`lines.${i}.productId`] = !l.productId
      ? 'Pilih produk'
      : seen.has(l.productId)
        ? 'Satu produk cukup satu baris'
        : undefined
    seen.add(l.productId)
    e[`lines.${i}.countedQty`] = check.wholeNumber(l.countedQty, { max: 1_000_000, label: 'Jumlah dihitung' })
    e[`lines.${i}.reason`] = l.reason.trim().length > 200 ? 'Maksimal 200 karakter' : undefined
  })
  return compact(e)
}
