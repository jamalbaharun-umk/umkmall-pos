import { describe, expect, it } from 'vitest'
import { check } from '../../lib/form-checks'
import { validateOpname, validateOrder } from './-validate'

// The client checks mirror pos-api's zod rules and use the same field keys, so both land on the same field.
describe('purchase and opname form checks', () => {
  const line = { productId: 'p1', qty: '2', unitCost: '1500' }
  it('a complete order passes', () => {
    expect(validateOrder({ supplierId: 's1', lines: [line] })).toEqual({})
  })
  it('flags missing supplier, product, qty 0, a decimal cost and a duplicate product', () => {
    expect(
      validateOrder({
        supplierId: '',
        lines: [{ productId: '', qty: '0', unitCost: '1,5' }, line, { ...line }],
      }),
    ).toEqual({
      supplierId: 'Pilih pemasok',
      'lines.0.productId': 'Pilih produk',
      'lines.0.qty': 'Jumlah harus lebih dari 0',
      'lines.0.unitCost': 'Harga beli harus bilangan bulat',
      'lines.2.productId': 'Satu produk cukup satu baris',
    })
  })
  it('caps qty, unit cost and the order total like the server', () => {
    expect(validateOrder({ supplierId: 's', lines: [{ ...line, qty: '100001' }] })['lines.0.qty']).toBe(
      'Jumlah maksimal 100.000',
    )
    const big = Array.from({ length: 11 }, (_, i) => ({ productId: `p${i}`, qty: '100000', unitCost: '1000000000' }))
    expect(validateOrder({ supplierId: 's', lines: big }).lines).toBe('Total pembelian maksimal Rp1.000.000.000.000')
  })
  it('opname: counted 0 is fine, empty and negative are not', () => {
    expect(validateOpname([{ productId: 'p', countedQty: '0', reason: '' }])).toEqual({})
    expect(validateOpname([{ productId: 'p', countedQty: '', reason: '' }])).toEqual({
      'lines.0.countedQty': 'Jumlah dihitung wajib diisi',
    })
    expect(validateOpname([{ productId: 'p', countedQty: '-1', reason: '' }])).toEqual({
      'lines.0.countedQty': 'Jumlah dihitung tidak boleh negatif',
    })
  })
  it('empty line fields name what is missing', () => {
    expect(validateOrder({ supplierId: 's', lines: [{ productId: '', qty: '', unitCost: '' }] })).toEqual({
      'lines.0.productId': 'Pilih produk',
      'lines.0.qty': 'Jumlah wajib diisi',
      'lines.0.unitCost': 'Harga beli wajib diisi',
    })
    expect(validateOrder({ supplierId: 's', lines: [{ ...line, qty: '0' }] })['lines.0.qty']).toBe(
      'Jumlah harus lebih dari 0',
    )
  })
  it('phone like pos-api: digits, optional +, 8–15 digits; blank allowed', () => {
    for (const ok of ['', '081234567890', '+62 812-3456-7890']) expect(check.phone(ok)).toBeUndefined()
    for (const bad of ['abc12', '0812', '1'.repeat(16)]) expect(check.phone(bad)).toBe('Nomor telepon tidak valid')
  })
  it('wholeNumber', () => {
    expect(check.wholeNumber(' 7 ', { min: 1 })).toBeUndefined()
    expect(check.wholeNumber('abc')).toBe('Jumlah harus bilangan bulat')
  })
})
