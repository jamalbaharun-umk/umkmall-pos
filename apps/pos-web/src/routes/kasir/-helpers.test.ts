import { describe, expect, it } from 'vitest'
import {
  addEntry,
  baseQtyInCart,
  canProceedToPayment,
  cartSignature,
  entryKey,
  needsUnitPicker,
  nextTierHint,
  priceEntries,
  requestLines,
  savingsNote,
  setEntryQty,
  soldQtyText,
  soldPriceNote,
  soldWholesaleNote,
  stockLines,
  subtotalOf,
  unitOptions,
  wholesaleHints,
  type CartEntry,
  type Quote,
  type UnitProduct,
} from './-helpers'

const teh: UnitProduct = {
  id: 'teh',
  name: 'Teh Botol',
  unit: 'pcs',
  sellingPrice: 3500,
  stock: 100,
  units: [{ name: 'Dus', unitQty: 24, price: 78000 }],
}
const minyak: UnitProduct = { id: 'minyak', name: 'Minyak', unit: 'pcs', sellingPrice: 14000, stock: 3 }

// The design cart: 12 pcs (wholesale 3.300) + 1 dus (fixed 78.000).
const cart: CartEntry[] = [
  { product: teh, unit: null, qty: 12 },
  { product: teh, unit: 'Dus', qty: 1 },
]
const quote: Quote = {
  lines: [
    {
      productId: 'teh',
      unit: 'pcs',
      qty: 12,
      unitQty: 1,
      baseQty: 12,
      normalUnitPrice: 3500,
      unitPrice: 3300,
      lineTotal: 39600,
      appliedTier: { minQty: 12, price: 3300 },
      savings: 2400,
      nextTier: { minQty: 48, price: 3200, remaining: 12 },
    },
    {
      productId: 'teh',
      unit: 'Dus',
      qty: 1,
      unitQty: 24,
      baseQty: 24,
      normalUnitPrice: 78000,
      unitPrice: 78000,
      lineTotal: 78000,
      appliedTier: null,
      savings: 0,
      nextTier: { minQty: 48, price: 3200, remaining: 12 },
    },
  ],
  subtotal: 117600,
}

describe('unit options', () => {
  it('lists the base unit first, then the units smallest pack first, with the saving against loose pcs', () => {
    const o = unitOptions({
      ...teh,
      units: [
        { name: 'Karton', unitQty: 96, price: 300000 },
        { name: 'Dus', unitQty: 24, price: 78000 },
      ],
    })
    expect(o.map((x) => [x.unit, x.label, x.unitQty, x.price, x.saving])).toEqual([
      [null, 'pcs', 1, 3500, 0],
      ['Dus', 'Dus', 24, 78000, 6000],
      ['Karton', 'Karton', 96, 300000, 36000],
    ])
  })
  it('never reports a negative saving', () => {
    expect(unitOptions({ ...teh, units: [{ name: 'Dus', unitQty: 2, price: 9000 }] })[1].saving).toBe(0)
  })
  it('asks for a unit only when the product has another one', () => {
    expect(needsUnitPicker(teh)).toBe(true)
    expect(needsUnitPicker(minyak)).toBe(false)
  })
})

describe('cart lines', () => {
  it('adds a line per unit and adds quantities on the same unit (any case)', () => {
    let c: CartEntry[] = []
    c = addEntry(c, teh, null, 12)
    c = addEntry(c, teh, 'Dus', 1)
    c = addEntry(c, teh, 'Dus', 2)
    expect(c.map((l) => [l.unit, l.qty])).toEqual([
      [null, 12],
      ['Dus', 3],
    ])
    expect(entryKey(c[1])).toBe('teh:dus')
  })
  it('removes a line at zero and leaves the other unit of the product', () => {
    const c = setEntryQty(cart, entryKey(cart[0]), 0)
    expect(c).toHaveLength(1)
    expect(c[0].unit).toBe('Dus')
  })
  it('sends the base unit as no unit and the others by name', () => {
    expect(requestLines(cart)).toEqual([
      { productId: 'teh', qty: 12 },
      { productId: 'teh', qty: 1, unit: 'Dus' },
    ])
    expect(cartSignature(cart)).not.toBe(cartSignature([cart[0]]))
  })
})

describe('stock in base units', () => {
  it('counts 1 dus as 24 and sums a product over its lines', () => {
    expect(stockLines(cart)).toEqual([{ name: 'Teh Botol', stock: 100, qty: 36 }])
    expect(baseQtyInCart(cart, 'teh')).toBe(36)
    expect(baseQtyInCart(cart, 'minyak')).toBe(0)
  })
})

describe('priced lines', () => {
  it('shows the server quote: wholesale on pcs, fixed price on dus, subtotal 117.600', () => {
    const p = priceEntries(cart, quote)
    expect(p.map((x) => [x.unitPrice, x.lineTotal, x.appliedTier?.minQty ?? null])).toEqual([
      [3300, 39600, 12],
      [78000, 78000, null],
    ])
    expect(subtotalOf(p)).toBe(117600)
    expect(savingsNote(p[0])).toBe('Harga normal Rp3.500, hemat Rp2.400')
    expect(savingsNote(p[1])).toBeNull()
  })
  it('falls back to the unit list price, with no badge, when there is no quote for this cart', () => {
    const p = priceEntries(cart, null)
    expect(p.map((x) => x.lineTotal)).toEqual([42000, 78000])
    expect(p.every((x) => x.appliedTier === null)).toBe(true)
    // A quote of an older cart (other quantity) is not used either.
    const stale = priceEntries([{ product: teh, unit: null, qty: 13 }, cart[1]], quote)
    expect(stale[0].lineTotal).toBe(45500)
    expect(priceEntries([cart[0]], quote)[0].lineTotal).toBe(42000)
  })
  it('shows no tier when the server applied none', () => {
    const none: Quote = {
      lines: [{ ...quote.lines[0], unitPrice: 3500, lineTotal: 7000, qty: 2, appliedTier: null, savings: 0 }],
      subtotal: 7000,
    }
    const p = priceEntries([{ product: teh, unit: null, qty: 2 }], none)
    expect(p[0].appliedTier).toBeNull()
    expect(savingsNote(p[0])).toBeNull()
  })
})

describe('wholesale hint', () => {
  it('says how many more base units reach the next tier, once per product', () => {
    expect(nextTierHint('pcs', { minQty: 48, price: 3200, remaining: 36 })).toBe(
      'Tambah 36 pcs lagi untuk harga Rp3.200 per pcs.',
    )
    expect(wholesaleHints(cart, quote)).toEqual([
      { productId: 'teh', text: 'Tambah 12 pcs lagi untuk harga Rp3.200 per pcs.' },
    ])
  })
  it('has no hint at the top tier, without a quote, or for a stale quote', () => {
    const top: Quote = { ...quote, lines: quote.lines.map((l) => ({ ...l, nextTier: null })) }
    expect(wholesaleHints(cart, top)).toEqual([])
    expect(wholesaleHints(cart, null)).toEqual([])
    expect(wholesaleHints([cart[0]], quote)).toEqual([])
  })
})

describe('sold lines (receipt and sale detail)', () => {
  const tiered = {
    qty: 12,
    unit: 'pcs',
    unitPrice: 3300,
    normalUnitPrice: 3500,
    appliedTier: { minQty: 12, price: 3300 },
    savings: 2400,
  }
  it('words the quantity in the line unit and the wholesale saving', () => {
    expect(soldQtyText(tiered)).toBe('12 pcs × Rp3.300')
    expect(soldWholesaleNote(tiered)).toBe('Harga grosir (normal Rp3.500, hemat Rp2.400)')
    expect(soldQtyText({ qty: 1, unit: 'Dus', unitPrice: 78000 })).toBe('1 Dus × Rp78.000')
  })
  it('has no wholesale note without a tier', () => {
    expect(soldWholesaleNote({ ...tiered, appliedTier: null, savings: 0 })).toBeNull()
  })
  it('a manual price is noted as manual, never as wholesale; other lines keep their note', () => {
    const manual = { ...tiered, unitPrice: 3000, appliedTier: null, savings: 0, manualPrice: true }
    expect(soldPriceNote(manual)).toBe('Harga manual (normal Rp3.500)')
    expect(soldPriceNote({ ...tiered, manualPrice: false })).toBe('Harga grosir (normal Rp3.500, hemat Rp2.400)')
    expect(soldPriceNote(tiered)).toBe('Harga grosir (normal Rp3.500, hemat Rp2.400)')
    expect(soldPriceNote({ ...tiered, appliedTier: null, savings: 0 })).toBeNull()
  })
})

describe('canProceedToPayment', () => {
  const ok = { cartSize: 2, overCount: 0, quoteState: 'idle' as const }
  it('allows a priced, in-stock cart', () => {
    expect(canProceedToPayment(ok)).toBe(true)
  })
  it('blocks an empty cart, over-stock lines, a pending quote and a failed quote', () => {
    expect(canProceedToPayment({ ...ok, cartSize: 0 })).toBe(false)
    expect(canProceedToPayment({ ...ok, overCount: 1 })).toBe(false)
    expect(canProceedToPayment({ ...ok, quoteState: 'loading' })).toBe(false)
    expect(canProceedToPayment({ ...ok, quoteState: 'error' })).toBe(false)
  })
})
