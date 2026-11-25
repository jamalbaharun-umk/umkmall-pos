// UMK-1985: pure logic of the cashier's units and wholesale prices. The server picks every unit price and tier
// (POST /sales/quote); this only builds the request, matches the answer to the cart's lines and words the hints.

export type SaleUnit = { id?: string; name: string; unitQty: number; price: number }
export type UnitProduct = {
  id: string
  name: string
  /** Base unit name (pcs). */
  unit?: string
  sellingPrice: number
  stock: number | null
  units?: SaleUnit[]
}

/** `unit` is null for the base unit; otherwise the name of one of the product's units, as the product spells it. */
export type CartEntry<P extends UnitProduct = UnitProduct> = { product: P; unit: string | null; qty: number }

export type Tier = { minQty: number; price: number }
export type NextTier = Tier & { remaining: number }
export type QuoteLine = {
  productId: string
  unit: string
  qty: number
  unitQty: number
  baseQty: number
  normalUnitPrice: number
  unitPrice: number
  lineTotal: number
  appliedTier: Tier | null
  savings: number
  nextTier: NextTier | null
}
export type Quote = { lines: QuoteLine[]; subtotal: number }

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** One cart line per product and unit (the server refuses the same pair twice), compared ignoring case. */
export const lineKey = (productId: string, unit: string | null) => `${productId}:${(unit ?? '').toLowerCase()}`
export const entryKey = (e: { product: { id: string }; unit: string | null }) => lineKey(e.product.id, e.unit)

/** The product's unit named `name` (any case), or undefined for the base unit or an unknown name. */
export const findUnit = (p: UnitProduct, name: string | null) =>
  name === null ? undefined : p.units?.find((u) => same(u.name, name))

/** Base units per unit of the line: 1 for the base unit. */
export const unitQtyOf = (p: UnitProduct, unit: string | null) => findUnit(p, unit)?.unitQty ?? 1

/** The list price of the line's unit, before any wholesale tier (what the cart shows until the quote arrives). */
export const normalPriceOf = (p: UnitProduct, unit: string | null) => findUnit(p, unit)?.price ?? p.sellingPrice

/** The name to show for a line's unit. */
export const unitLabel = (p: UnitProduct, unit: string | null) => findUnit(p, unit)?.name ?? p.unit ?? 'pcs'

export type UnitOption = {
  /** null = base unit. */
  unit: string | null
  label: string
  unitQty: number
  price: number
  /** What buying one of this unit saves against the same quantity loose at the base price; 0 when nothing. */
  saving: number
}

/** The picker's choices: the base unit first (the default), then the product's units, smallest pack first. */
export function unitOptions(p: UnitProduct): UnitOption[] {
  const base: UnitOption = { unit: null, label: p.unit ?? 'pcs', unitQty: 1, price: p.sellingPrice, saving: 0 }
  const others = [...(p.units ?? [])]
    .sort((a, b) => a.unitQty - b.unitQty)
    .map<UnitOption>((u) => ({
      unit: u.name,
      label: u.name,
      unitQty: u.unitQty,
      price: u.price,
      saving: Math.max(0, u.unitQty * p.sellingPrice - u.price),
    }))
  return [base, ...others]
}

/** A product with only its base unit adds straight to the cart; otherwise the cashier picks a unit first. */
export const needsUnitPicker = (p: UnitProduct) => (p.units?.length ?? 0) > 0

/** Adds `qty` of a unit: onto the product's line for that unit when there is one, else a new line at the end. */
export function addEntry<P extends UnitProduct>(cart: CartEntry<P>[], product: P, unit: string | null, qty: number) {
  const key = lineKey(product.id, unit)
  return cart.some((l) => entryKey(l) === key)
    ? cart.map((l) => (entryKey(l) === key ? { ...l, qty: l.qty + qty } : l))
    : [...cart, { product, unit, qty }]
}

/** Sets a line's quantity; zero or less removes the line. */
export function setEntryQty<P extends UnitProduct>(cart: CartEntry<P>[], key: string, qty: number) {
  return qty <= 0 ? cart.filter((l) => entryKey(l) !== key) : cart.map((l) => (entryKey(l) === key ? { ...l, qty } : l))
}

/** Body of POST /sales/quote (and the sale's lines): the base unit is sent as no unit at all. */
export const requestLines = (cart: CartEntry[]) =>
  cart.map((l) => ({ productId: l.product.id, qty: l.qty, ...(l.unit === null ? {} : { unit: l.unit }) }))

/** Changes whenever the request would: identifies which cart a quote answered. */
export const cartSignature = (cart: CartEntry[]) => JSON.stringify(requestLines(cart))

/**
 * Stock hint per product in BASE units (1 dus = 24 pcs), summed over the product's lines, one entry per product
 * in cart order. pos-api still refuses an oversold sale.
 */
export function stockLines(cart: CartEntry[]) {
  const byProduct = new Map<string, { name: string; stock: number | null; qty: number }>()
  for (const l of cart) {
    const base = l.qty * unitQtyOf(l.product, l.unit)
    const had = byProduct.get(l.product.id)
    if (had) had.qty += base
    else byProduct.set(l.product.id, { name: l.product.name, stock: l.product.stock, qty: base })
  }
  return [...byProduct.values()]
}

/** Base units of a product in the cart (for the grid's count badge). */
export const baseQtyInCart = (cart: CartEntry[], productId: string) =>
  cart.filter((l) => l.product.id === productId).reduce((n, l) => n + l.qty * unitQtyOf(l.product, l.unit), 0)

export type PricedEntry = {
  key: string
  unitPrice: number
  lineTotal: number
  normalUnitPrice: number
  appliedTier: Tier | null
  savings: number
}

/**
 * What to show per cart line: the server's quote while it answers this very cart, else a local estimate at the
 * unit's list price with no tier (the order is never priced by the browser; pos-api prices the sale itself).
 */
export function priceEntries(cart: CartEntry[], quote: Quote | null | undefined): PricedEntry[] {
  const fresh = quote && quote.lines.length === cart.length ? quote : null
  return cart.map((l, i) => {
    const q = fresh?.lines[i]
    if (q && q.productId === l.product.id && q.qty === l.qty && same(q.unit, unitLabel(l.product, l.unit))) {
      return {
        key: entryKey(l),
        unitPrice: q.unitPrice,
        lineTotal: q.lineTotal,
        normalUnitPrice: q.normalUnitPrice,
        appliedTier: q.appliedTier,
        savings: q.savings,
      }
    }
    const price = normalPriceOf(l.product, l.unit)
    return {
      key: entryKey(l),
      unitPrice: price,
      lineTotal: price * l.qty,
      normalUnitPrice: price,
      appliedTier: null,
      savings: 0,
    }
  })
}

export const subtotalOf = (priced: PricedEntry[]) => priced.reduce((n, l) => n + l.lineTotal, 0)

const rp = (n: number) => `Rp${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

/** "Tambah 36 pcs lagi untuk harga Rp3.200 per pcs." */
export const nextTierHint = (unitName: string, t: NextTier) =>
  `Tambah ${t.remaining} ${unitName} lagi untuk harga ${rp(t.price)} per ${unitName}.`

/**
 * The wholesale hints of a cart: one per product (the quote repeats `nextTier` on each of its lines), in cart order,
 * only for a product whose total is short of its next tier. Needs a quote that answers this cart.
 */
export function wholesaleHints(cart: CartEntry[], quote: Quote | null | undefined): { productId: string; text: string }[] {
  if (!quote || quote.lines.length !== cart.length) return []
  const hints: { productId: string; text: string }[] = []
  cart.forEach((l, i) => {
    const next = quote.lines[i]?.nextTier
    if (next && !hints.some((h) => h.productId === l.product.id))
      hints.push({ productId: l.product.id, text: nextTierHint(l.product.unit ?? 'pcs', next) })
  })
  return hints
}

/** The "Harga normal Rp3.500, hemat Rp2.400" line under a tiered cart line; null without a tier. */
export const savingsNote = (e: PricedEntry) =>
  e.appliedTier ? `Harga normal ${rp(e.normalUnitPrice)}, hemat ${rp(e.savings)}` : null

export type SavedLine = { productId: string; qty: number; unit?: string | null }

export const savedLines = (cart: CartEntry[]): SavedLine[] =>
  cart.map((l) => ({ productId: l.product.id, qty: l.qty, ...(l.unit === null ? {} : { unit: l.unit }) }))

type SoldLine = {
  qty: number
  unit: string
  unitPrice: number
  normalUnitPrice: number
  appliedTier: Tier | null
  savings: number
}

/** "12 pcs × Rp3.300": a sold line's quantity in its own unit at the price charged per unit. */
export const soldQtyText = (l: Pick<SoldLine, 'qty' | 'unit' | 'unitPrice'>) => `${l.qty} ${l.unit} × ${rp(l.unitPrice)}`

/** Receipt note of a wholesale line, null for any other: "Harga grosir (normal Rp3.500, hemat Rp2.400)". */
export const soldWholesaleNote = (l: Pick<SoldLine, 'normalUnitPrice' | 'appliedTier' | 'savings'>) =>
  l.appliedTier ? `Harga grosir (normal ${rp(l.normalUnitPrice)}, hemat ${rp(l.savings)})` : null

/**
 * The note under a sold line: the wholesale note, or "Harga manual" when the price was typed by someone
 * allowed to (owner ruling 2026-11-25: a manual price is never shown as wholesale); null for a plain line.
 */
export const soldPriceNote = (l: Pick<SoldLine, 'normalUnitPrice' | 'appliedTier' | 'savings'> & { manualPrice?: boolean }) =>
  l.manualPrice ? `Harga manual (normal ${rp(l.normalUnitPrice)})` : soldWholesaleNote(l)

export type QuoteState = 'idle' | 'loading' | 'error'

/**
 * "Lanjut ke pembayaran" is allowed only with a priced cart: not empty, in stock, and the server quote neither
 * pending nor failed (the no-tier estimate can show a higher total than the server charges).
 */
export const canProceedToPayment = (s: { cartSize: number; overCount: number; quoteState: QuoteState }) =>
  s.cartSize > 0 && s.overCount === 0 && s.quoteState === 'idle'
