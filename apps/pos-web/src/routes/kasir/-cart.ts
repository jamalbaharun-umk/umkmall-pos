// The open bill survives leaving /kasir (Lakasir keeps cart_items; Moka and Pawoon keep the open bill). v1 keeps it
// per browser tab in sessionStorage: only product ids, units, quantities and the note, re-read against today's products.
import { entryKey, findUnit, type SavedLine, type UnitProduct } from './-helpers'
import type { LineDiscount } from './-discount'

// UMK-1990: a line's discount is kept with its line (kind and value only). A PIN approval is never kept: a discount
// above 30% comes back without it and asks for the PIN again before the sale.
export type SavedDiscount = Pick<LineDiscount, 'kind' | 'value'>
export type SavedCart = { lines: SavedLine[]; note: string; discounts?: Record<string, SavedDiscount> }

const isSavedDiscount = (d: unknown): d is SavedDiscount => {
  const x = d as Partial<SavedDiscount> | null
  return (
    !!x &&
    (x.kind === 'percent' || x.kind === 'amount') &&
    Number.isInteger(x.value) &&
    (x.value as number) >= 1 &&
    (x.kind === 'amount' || (x.value as number) <= 99)
  )
}

const KEY = 'pos.kasir.cart'

/** Saved lines matched to the products on sale now; unknown or inactive products and bad quantities are dropped. */
export function restoreCart<P extends UnitProduct>(
  saved: unknown,
  products: P[],
): {
  lines: { product: P; unit: string | null; qty: number }[]
  note: string
  discounts: Record<string, SavedDiscount>
} {
  const s = saved as Partial<SavedCart> | null
  const byId = new Map(products.map((p) => [p.id, p]))
  const seen = new Set<string>()
  const lines = (Array.isArray(s?.lines) ? s.lines : []).flatMap((l) => {
    const product = byId.get(l?.productId)
    if (!product || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 100_000) return []
    // A unit the product no longer has drops the line (the price would be a guess); no unit = the base unit.
    const unit = typeof l.unit === 'string' ? (findUnit(product, l.unit)?.name ?? undefined) : null
    if (unit === undefined) return []
    const line = { product, unit, qty: l.qty }
    if (seen.has(entryKey(line))) return []
    seen.add(entryKey(line))
    return [line]
  })
  const keptDiscounts = s?.discounts && typeof s.discounts === 'object' ? s.discounts : {}
  const discounts: Record<string, SavedDiscount> = {}
  for (const k of seen) {
    const d = (keptDiscounts as Record<string, unknown>)[k]
    if (isSavedDiscount(d)) discounts[k] = { kind: d.kind, value: d.value }
  }
  return { lines, note: typeof s?.note === 'string' ? s.note.slice(0, 200) : '', discounts }
}

export function readCart(): unknown {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
  } catch {
    return null // private mode or bad JSON: start empty
  }
}

export function writeCart(cart: SavedCart) {
  try {
    if (cart.lines.length === 0 && !cart.note) sessionStorage.removeItem(KEY)
    else sessionStorage.setItem(KEY, JSON.stringify(cart))
  } catch {
    // storage unavailable: the bill just is not kept across pages
  }
}
