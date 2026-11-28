import { describe, expect, it } from 'vitest'
import { quickProductBody, quickProductServerErrors } from './-quick-product'

describe('quick product form (UMK-2130)', () => {
  it('sends name and price, cost only when typed, the scanned barcode when there is one', () => {
    expect(quickProductBody({ name: ' Nasi uduk ', price: '15.000', cost: '' })).toEqual({
      ok: true,
      body: { name: 'Nasi uduk', sellingPrice: 15000 },
    })
    expect(quickProductBody({ name: 'Kerupuk', price: '2000', cost: '1.200' }, '899123')).toEqual({
      ok: true,
      body: { name: 'Kerupuk', sellingPrice: 2000, costPrice: 1200, barcode: '899123' },
    })
  })

  it('says what is wrong per field, in Indonesian', () => {
    expect(quickProductBody({ name: '', price: '', cost: '' })).toEqual({
      ok: false,
      errors: { name: 'Nama produk wajib diisi', sellingPrice: 'Harga jual wajib diisi' },
    })
    expect(quickProductBody({ name: 'X', price: '1,5', cost: '' })).toMatchObject({
      errors: { sellingPrice: expect.stringContaining('bilangan bulat') },
    })
    expect(quickProductBody({ name: 'X', price: '0', cost: '' })).toMatchObject({
      errors: { sellingPrice: 'Harga jual harus lebih dari 0' },
    })
    expect(quickProductBody({ name: 'X', price: '1000', cost: '2000' })).toMatchObject({
      errors: { costPrice: 'Harga modal tidak boleh melebihi harga jual' },
    })
    expect(quickProductBody({ name: 'X'.repeat(121), price: '1000', cost: '' })).toMatchObject({
      errors: { name: 'Maksimal 120 karakter' },
    })
  })

  it("keeps only the form's fields from pos-api's 422", () => {
    expect(quickProductServerErrors({ name: 'Nama wajib', barcode: 'x', costPrice: 'Terlalu besar' })).toEqual({
      name: 'Nama wajib',
      costPrice: 'Terlalu besar',
    })
    expect(quickProductServerErrors(undefined)).toEqual({})
  })
})
