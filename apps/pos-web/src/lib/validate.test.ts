import { describe, expect, it } from 'vitest'
import { productErrors, required, splitImages, staffErrors } from './validate'

const product = {
  name: 'Es Teh',
  categoryId: 'c1',
  sku: '',
  unit: 'PCS',
  costPrice: '3000',
  sellingPrice: '5000',
  barcodes: [] as string[],
  stock: '',
}

describe('client validation mirrors the API', () => {
  it('accepts a valid product and names each bad field', () => {
    expect(productErrors(product, false)).toEqual({})
    expect(productErrors({ ...product, name: ' ', categoryId: '', unit: '', sellingPrice: '' }, false)).toEqual({
      name: 'Nama produk wajib diisi',
      categoryId: 'Pilih kategori',
      unit: 'Satuan wajib diisi',
      sellingPrice: 'Harga jual wajib diisi',
    })
    expect(productErrors({ ...product, sellingPrice: '0', costPrice: '0' }, false)).toEqual({
      sellingPrice: 'Harga jual harus lebih dari 0',
    })
    expect(productErrors({ ...product, costPrice: '6000' }, false)).toEqual({
      costPrice: 'Harga modal tidak boleh melebihi harga jual',
    })
    expect(productErrors({ ...product, sku: 'A B' }, false).sku).toBe('SKU tidak boleh berisi spasi')
    expect(productErrors(product, true).sku).toBe('SKU wajib diisi')
    expect(productErrors({ ...product, barcodes: ['12', '899', '899'] }, false)).toEqual({
      'barcodes.0': 'Barcode minimal 3 karakter',
      'barcodes.2': 'Barcode tidak boleh ganda',
    })
  })

  it('checks staff name, PIN and its confirmation', () => {
    expect(staffErrors({ name: 'Sari', pin: '1234', pin2: '1234' }, false)).toEqual({})
    expect(staffErrors({ name: '', pin: '12', pin2: '1' }, false)).toEqual({
      name: 'Nama wajib diisi',
      pin: 'PIN harus 4 sampai 8 angka',
      pin2: 'Konfirmasi PIN tidak sama',
    })
    expect(staffErrors({ name: 'Sari', pin: '', pin2: '' }, true)).toEqual({})
  })

  it('refuses non-images and images over 2 MB before upload', () => {
    const png = { type: 'image/png', size: 1000 }
    const big = { type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 }
    const txt = { type: 'text/plain', size: 10 }
    expect(splitImages([png, big, txt])).toEqual({ accepted: [png], refused: [big, txt] })
  })

  it('required trims', () => {
    expect(required('  ', 'Wajib')).toBe('Wajib')
    expect(required('a', 'Wajib')).toBeUndefined()
  })
})
