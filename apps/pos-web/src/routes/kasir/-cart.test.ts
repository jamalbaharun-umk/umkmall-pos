import { describe, expect, it } from 'vitest'
import { restoreCart } from './-cart'

describe('open bill restore', () => {
  const products = [
    { id: 'a', name: 'Es Teh', sellingPrice: 3500, stock: null },
    { id: 'b', name: 'Kopi', sellingPrice: 5000, stock: null, units: [{ name: 'Dus', unitQty: 24, price: 100000 }] },
  ]
  it('matches saved lines to current products and keeps the note', () => {
    const r = restoreCart({ lines: [{ productId: 'b', qty: 2 }], note: 'tanpa gula' }, products)
    expect(r).toEqual({ lines: [{ product: products[1], unit: null, qty: 2 }], note: 'tanpa gula' })
  })
  it('drops products no longer on sale and bad quantities; survives garbage', () => {
    const r = restoreCart(
      {
        lines: [
          { productId: 'x', qty: 1 },
          { productId: 'a', qty: 0 },
          { productId: 'a', qty: 1.5 },
          { productId: 'b', qty: 3 },
        ],
      },
      products,
    )
    expect(r.lines).toEqual([{ product: products[1], unit: null, qty: 3 }])
    expect(restoreCart(null, products)).toEqual({ lines: [], note: '' })
    expect(restoreCart('junk', products)).toEqual({ lines: [], note: '' })
  })
  it('keeps a unit the product still has (any case, spelled as the product does) and drops one it lost', () => {
    const r = restoreCart(
      {
        lines: [
          { productId: 'b', qty: 1, unit: 'dus' },
          { productId: 'b', qty: 2, unit: 'karton' },
          { productId: 'a', qty: 1, unit: 'dus' },
        ],
      },
      products,
    )
    expect(r.lines).toEqual([{ product: products[1], unit: 'Dus', qty: 1 }])
  })
  it('keeps pcs and dus of one product as two lines, and drops a repeated pair', () => {
    const r = restoreCart(
      {
        lines: [
          { productId: 'b', qty: 12 },
          { productId: 'b', qty: 1, unit: 'Dus' },
          { productId: 'b', qty: 5, unit: 'DUS' },
        ],
      },
      products,
    )
    expect(r.lines.map((l) => [l.unit, l.qty])).toEqual([
      [null, 12],
      ['Dus', 1],
    ])
  })
})
