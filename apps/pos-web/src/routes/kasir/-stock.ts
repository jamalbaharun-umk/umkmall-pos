// UMK-1966: what the cashier grid, the cart and the catalog say about stock. Only a hint for the cashier: pos-api
// still refuses a sale that exceeds on-hand, inside the sale's transaction.

export type StockState = 'untracked' | 'out' | 'low' | 'enough'

/** `stock` is on-hand for a tracked product (0 included) and null for service and non-stock products. */
export function stockState(stock: number | null | undefined, threshold: number): StockState {
  if (stock === null || stock === undefined) return 'untracked'
  if (stock <= 0) return 'out'
  return stock <= threshold ? 'low' : 'enough'
}

export const stockOverMessage = (stock: number) => `Stok hanya ${stock}. Kurangi jumlah atau perbarui stok dulu.`

export type StockLine = { name: string; stock: number | null | undefined; qty: number }

/** The cart lines asking for more than the stock on hand (untracked products have no limit). */
export function overStock<L extends StockLine>(lines: L[]): L[] {
  return lines.filter((l) => l.stock !== null && l.stock !== undefined && l.qty > Math.max(0, l.stock))
}

/** Counts for the catalog's "Menipis (n)" / "Habis (n)" chips come from pos-api; this is the label only. */
export const filterLabel = (name: string, n: number | undefined) => (n === undefined ? name : `${name} (${n})`)
