import { describe, expect, it } from 'vitest'
import { plainNumber, productErrors, required, splitImages, staffErrors, storeProfileErrors, taxToBps } from './validate'

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
    // typos get a message, never a silently different number
    expect(productErrors({ ...product, stock: '-2', costPrice: '1,5', sellingPrice: '5.5' }, false)).toEqual({
      stock: 'Stok awal tidak boleh negatif',
      costPrice: 'Harga modal harus bilangan bulat',
      sellingPrice: 'Harga jual harus bilangan bulat',
    })
    // correctly grouped thousand dots are fine, like the cashier's money fields
    expect(productErrors({ ...product, stock: '1.000', costPrice: '3.000', sellingPrice: '1.250.000' }, false)).toEqual({})
    expect(plainNumber('1.250.000')).toBe('1250000')
    expect(plainNumber('1.5')).toBe('1.5')
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
  it('checks the store profile like pos-api', () => {
    const ok = { name: 'Toko', businessType: 'retail', otherBusinessType: '', address: 'Jl. 1' }
    expect(storeProfileErrors(ok)).toEqual({})
    expect(storeProfileErrors({ name: '', businessType: '', otherBusinessType: '', address: ' ' })).toEqual({
      name: 'Nama toko wajib diisi',
      businessType: 'Pilih jenis usaha',
      address: 'Alamat toko wajib diisi',
    })
    expect(storeProfileErrors({ ...ok, businessType: 'other' })).toEqual({
      otherBusinessType: 'Jenis usaha lainnya wajib diisi',
    })
  })

  it('reads tax percent into basis points', () => {
    expect(taxToBps('11')).toEqual({ bps: 1100 })
    expect(taxToBps('11,5')).toEqual({ bps: 1150 })
    expect(taxToBps('0')).toEqual({ bps: 0 })
    expect(taxToBps('')).toEqual({ error: 'Pajak wajib diisi' })
    expect(taxToBps('-1')).toHaveProperty('error')
    expect(taxToBps('11,555')).toHaveProperty('error')
    expect(taxToBps('101')).toEqual({ error: 'Pajak maksimal 100%' })
  })
})
