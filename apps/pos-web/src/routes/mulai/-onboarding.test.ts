import { describe, expect, it } from 'vitest'
import { applyToast, byCategory, pricesBody, pricesToast, remainingText, templateButtonLabel } from './-onboarding'

describe('onboarding helpers (UMK-2128)', () => {
  it('words the template toast and button as design 44', () => {
    expect(applyToast({ template: 'warung_makan', created: 24, skipped: 0, unpriced: 24 })).toBe(
      'Toko siap: 24 produk ditambahkan',
    )
    expect(applyToast({ template: 'warung_makan', created: 0, skipped: 24, unpriced: 3 })).toBe(
      'Semua produk template ini sudah ada di toko',
    )
    expect(templateButtonLabel('Warung makan')).toBe('Pakai template Warung makan')
  })

  it('sends only the typed prices, whole rupiah above 0', () => {
    expect(pricesBody({ a: '12.000', b: '', c: ' 4000 ' })).toEqual({
      ok: true,
      items: [
        { id: 'a', sellingPrice: 12000 },
        { id: 'c', sellingPrice: 4000 },
      ],
    })
    const bad = pricesBody({ a: '1.5', b: '0', c: '5000' })
    expect(bad).toEqual({
      ok: false,
      errors: { a: 'Harus bilangan bulat rupiah, misalnya 12.000', b: 'Harga harus lebih dari 0' },
    })
    expect(pricesBody({})).toEqual({ ok: true, items: [] })
  })

  it('says what is left and what a save did', () => {
    expect(remainingText(21)).toBe(
      'Sisa 21 produk tanpa harga. Bisa diisi nanti; produk tanpa harga tidak tampil di kasir.',
    )
    expect(remainingText(0)).toBe('Semua produk sudah punya harga.')
    expect(pricesToast({ priced: 3, failed: [], unpriced: 21 })).toBe('3 harga disimpan')
  })

  it('groups products by category in list order', () => {
    const rows = [
      { id: '1', category: 'Lauk' },
      { id: '2', category: 'Lauk' },
      { id: '3', category: 'Nasi' },
    ]
    expect(byCategory(rows)).toEqual([
      ['Lauk', [rows[0], rows[1]]],
      ['Nasi', [rows[2]]],
    ])
  })
})
