// The open bill survives leaving /kasir (Lakasir keeps cart_items; Moka and Pawoon keep the open bill). v1 keeps it
// per browser tab in sessionStorage: only product ids, quantities and the note, re-read against today's products.

export type SavedCart = { lines: { productId: string; qty: number }[]; note: string }

const KEY = 'pos.kasir.cart'

/** Saved lines matched to the products on sale now; unknown or inactive products and bad quantities are dropped. */
export function restoreCart<P extends { id: string }>(
  saved: unknown,
  products: P[],
): { lines: { product: P; qty: number }[]; note: string } {
  const s = saved as Partial<SavedCart> | null
  const byId = new Map(products.map((p) => [p.id, p]))
  const lines = (Array.isArray(s?.lines) ? s.lines : []).flatMap((l) => {
    const product = byId.get(l?.productId)
    return product && Number.isInteger(l.qty) && l.qty >= 1 && l.qty <= 100_000 ? [{ product, qty: l.qty }] : []
  })
  return { lines, note: typeof s?.note === 'string' ? s.note.slice(0, 200) : '' }
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
