// UMK-1985: pure logic of the product form's "Satuan lain" and "Harga grosir" editors. The rules mirror
// pos-api's catalog/pricing.ts so an obviously wrong list never reaches the server; the server stays the authority.
import { check, compact, type FieldErrors } from '../../../lib/form-checks'
import { plainNumber } from '../../../lib/validate'

/** What the form holds: raw text, so "1,5" gets a message instead of silently becoming 15. */
export type UnitRow = { name: string; unitQty: string; price: string }
export type TierRow = { minQty: string; price: string }
export type UnitInput = { name: string; unitQty: number; price: number }
export type TierInput = { minQty: number; price: number }
export type SaveWarning = { code: string; field: string; message: string }

export const MAX_UNITS = 10
export const MAX_TIERS = 10

export const blankUnit = (): UnitRow => ({ name: '', unitQty: '', price: '' })
export const blankTier = (): TierRow => ({ minQty: '', price: '' })

export const unitRowsOf = (units: readonly UnitInput[] | undefined): UnitRow[] =>
  (units ?? []).map((u) => ({ name: u.name, unitQty: String(u.unitQty), price: String(u.price) }))
export const tierRowsOf = (tiers: readonly TierInput[] | undefined): TierRow[] =>
  (tiers ?? []).map((t) => ({ minQty: String(t.minQty), price: String(t.price) }))

const num = (text: string) => Number(plainNumber(text))

/** Rupiah with Indonesian thousand dots, independent of the runtime's locale data. */
export const formatRp = (n: number) => `Rp${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

/**
 * Errors keyed like pos-api's: `units.<i>.name|unitQty|price`. `baseUnit` is the base unit's name (a unit may not
 * repeat it); names are unique ignoring case.
 */
export function unitErrors(rows: readonly UnitRow[], baseUnit: string): FieldErrors {
  const e: Record<string, string | undefined> = {}
  const seen = new Set([baseUnit.trim().toLowerCase()])
  rows.forEach((r, i) => {
    const name = r.name.trim()
    const key = name.toLowerCase()
    e[`units.${i}.name`] = !name
      ? 'Nama satuan wajib diisi'
      : name.length > 20
        ? 'Maksimal 20 karakter'
        : seen.has(key)
          ? 'Nama satuan tidak boleh sama dengan satuan lain'
          : undefined
    seen.add(key)
    e[`units.${i}.unitQty`] = check.wholeNumber(plainNumber(r.unitQty), { min: 2, max: 10_000, label: 'Isi per satuan' })
    e[`units.${i}.price`] = check.wholeNumber(plainNumber(r.price), { min: 1, label: 'Harga satuan' })
  })
  return compact(e)
}

/**
 * Errors keyed `priceTiers.<i>.minQty|price`. Rows are checked in the order shown: the quantity must rise and the
 * price must fall from one row to the next, and no tier may cost more than the base price (`sellingPrice`, text).
 */
export function tierErrors(rows: readonly TierRow[], sellingPrice: string): FieldErrors {
  const e: Record<string, string | undefined> = {}
  const base = num(sellingPrice)
  const baseOk = Number.isFinite(base) && base > 0
  let prevQty: number | undefined
  let prevPrice: number | undefined
  rows.forEach((r, i) => {
    const qtyBad = check.wholeNumber(plainNumber(r.minQty), { min: 2, max: 1_000_000, label: 'Jumlah minimal' })
    const priceBad = check.wholeNumber(plainNumber(r.price), { min: 1, label: 'Harga grosir' })
    const qty = num(r.minQty)
    const price = num(r.price)
    e[`priceTiers.${i}.minQty`] =
      qtyBad ?? (prevQty !== undefined && qty <= prevQty ? 'Jumlah minimal harus lebih besar dari baris di atasnya' : undefined)
    e[`priceTiers.${i}.price`] =
      priceBad ??
      (baseOk && price > base
        ? 'Harga grosir tidak boleh melebihi harga jual'
        : prevPrice !== undefined && price >= prevPrice
          ? 'Harga grosir harus lebih murah dari baris di atasnya'
          : undefined)
    if (!qtyBad) prevQty = qty
    if (!priceBad) prevPrice = price
  })
  return compact(e)
}

export const unitsToInput = (rows: readonly UnitRow[]): UnitInput[] =>
  rows.map((r) => ({ name: r.name.trim(), unitQty: num(r.unitQty), price: num(r.price) }))
export const tiersToInput = (rows: readonly TierRow[]): TierInput[] =>
  rows.map((r) => ({ minQty: num(r.minQty), price: num(r.price) }))

/**
 * The hint under a unit's price: what one base unit costs in the pack and what the pack saves against buying loose
 * at the base price ("Setara Rp3.250 per pcs. Beli 1 Dus hemat Rp6.000."). Null until both numbers are valid.
 */
export function unitHint(row: UnitRow, baseUnit: string, sellingPrice: string): string | null {
  const qty = num(row.unitQty)
  const price = num(row.price)
  const base = num(sellingPrice)
  if (!Number.isInteger(qty) || qty < 2 || !Number.isInteger(price) || price < 1) return null
  const each = price / qty
  const per = Number.isInteger(each) ? formatRp(each) : `sekitar ${formatRp(each)}`
  const name = row.name.trim() || 'satuan'
  const saved = Number.isInteger(base) && base > 0 ? qty * base - price : 0
  return `Setara ${per} per ${baseUnit.trim() || 'satuan dasar'}.${saved > 0 ? ` Beli 1 ${name} hemat ${formatRp(saved)}.` : ''}`
}

/** Drops the errors of one list ("units", "priceTiers") or of one row of it, after an edit. */
export function clearRowErrors(errors: FieldErrors, list: string, row?: number): FieldErrors {
  const prefix = row === undefined ? `${list}.` : `${list}.${row}.`
  const next = Object.fromEntries(Object.entries(errors).filter(([k]) => k !== list && !k.startsWith(prefix)))
  return Object.keys(next).length === Object.keys(errors).length ? errors : next
}
