import { describe, expect, it } from 'vitest'
import { restoreCart } from './-cart'

describe('open bill restore', () => {
  const products = [
    { id: 'a', name: 'Es Teh' },
    { id: 'b', name: 'Kopi' },
  ]
  it('matches saved lines to current products and keeps the note', () => {
    const r = restoreCart({ lines: [{ productId: 'b', qty: 2 }], note: 'tanpa gula' }, products)
    expect(r).toEqual({ lines: [{ product: products[1], qty: 2 }], note: 'tanpa gula' })
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
    expect(r.lines).toEqual([{ product: products[1], qty: 3 }])
    expect(restoreCart(null, products)).toEqual({ lines: [], note: '' })
    expect(restoreCart('junk', products)).toEqual({ lines: [], note: '' })
  })
})
