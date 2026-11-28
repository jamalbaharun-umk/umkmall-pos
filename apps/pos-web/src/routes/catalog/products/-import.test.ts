import { describe, expect, it } from 'vitest'
import { doneText, importFileError, importToast, previewSummary, SAMPLE_CSV, saveLabel } from './-import'

describe('product import screen (UMK-2129)', () => {
  it('reads only a CSV that is neither empty nor too large, and says how to save an Excel sheet', () => {
    expect(importFileError({ name: 'produk.csv', size: 10, type: '' })).toBeUndefined()
    expect(importFileError({ name: 'x', size: 10, type: 'text/csv' })).toBeUndefined()
    expect(importFileError({ name: 'produk.xlsx', size: 10, type: '' })).toContain('Simpan sebagai')
    expect(importFileError({ name: 'foto.png', size: 10, type: 'image/png' })).toBe('Pilih berkas CSV (.csv).')
    expect(importFileError({ name: 'a.csv', size: 0, type: '' })).toBe('Berkas ini kosong.')
    expect(importFileError({ name: 'a.csv', size: 400_001, type: '' })).toContain('Maksimal 500')
  })

  it('words the buttons, the summary and the toast', () => {
    expect(saveLabel(2)).toBe('Simpan 2 baris yang benar')
    expect(saveLabel(0)).toBe('Tidak ada baris yang benar')
    expect(previewSummary({ total: 3, okCount: 3, errorCount: 0 })).toBe('3 baris siap disimpan.')
    expect(previewSummary({ total: 4, okCount: 2, errorCount: 2 })).toMatch(/^2 dari 4 baris siap disimpan\. 2 baris ditandai/)
    expect(importToast({ created: 24, failed: [] })).toBe('24 produk ditambahkan')
    expect(importToast({ created: 2, failed: [{}] })).toBe('2 produk ditambahkan, 1 baris tidak disimpan')
    // A product saved without its opening stock is not a row "tidak disimpan".
    expect(importToast({ created: 2, failed: [{ saved: true }] })).toBe('2 produk ditambahkan')
    expect(doneText({ created: 3, failed: [{}, { saved: true }] })).toBe(
      '3 produk ditambahkan. 1 baris tidak disimpan. 1 produk tersimpan tanpa stok awal.',
    )
    expect(doneText({ created: 1, failed: [{}] })).toBe('1 produk ditambahkan. 1 baris tidak disimpan.')
  })

  it('offers a sample whose header names the columns pos-api reads', () => {
    expect(SAMPLE_CSV.split('\r\n')[0]).toBe('Nama;Harga jual;Harga modal;SKU;Kategori;Satuan;Barcode;Stok')
  })
})
