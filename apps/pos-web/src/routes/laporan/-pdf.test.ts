import { describe, expect, it } from 'vitest'
import { PDF_PATHS, pdfFailure, pdfFilename, pdfQuery, rangeLabel } from './-pdf'

describe('pdfQuery', () => {
  it('passes only the keys pos-api reads', () => {
    const q = new URLSearchParams({ from: '2026-11-01', to: '2026-11-26', tenantId: 'abc', include: 'chart,table', scale: 'month', x: '1' })
    expect(pdfQuery(q)).toBe('from=2026-11-01&to=2026-11-26&scale=month&include=chart%2Ctable')
    expect(pdfQuery(new URLSearchParams())).toBe('')
  })
  it('has a path for every report', () => {
    expect(Object.keys(PDF_PATHS).sort()).toEqual(['kasbon', 'pembelian', 'penjualan', 'penjualan-pengeluaran', 'produk', 'shift', 'untung-rugi'])
  })
})

describe('pdfFailure', () => {
  it('gives the range refusal the design’s next step', () => {
    const f = pdfFailure(422, { code: 'EXPORT_RANGE_TOO_LARGE', message: 'Rentang laporan terlalu panjang untuk satu PDF (lebih dari 92 hari untuk laporan harian).' })
    expect(f).toMatchObject({ status: 422, code: 'EXPORT_RANGE_TOO_LARGE', todo: 'Pilih rentang lebih pendek, atau pindah ke laporan Bulanan.' })
    expect(f.error).toMatch(/92 hari/)
  })
  it('says offline for no answer and the permission text for 403', () => {
    expect(pdfFailure(0, null)).toEqual({ status: 0, offline: true })
    expect(pdfFailure(403, null).error).toBe('Anda tidak punya izin melihat laporan.')
  })
  it('names a busy or slow server and never passes an unknown message through', () => {
    expect(pdfFailure(503, { code: 'EXPORT_BUSY', message: 'Server sedang membuat banyak PDF. Coba lagi sebentar lagi.' }).todo).toMatch(/Tunggu/)
    expect(pdfFailure(500, { message: 'select * from secret' }).error).toBeUndefined()
  })
})

describe('pdfFilename', () => {
  it('takes a safe name from the header', () => {
    expect(pdfFilename('attachment; filename="laporan-penjualan-2026-11-20_2026-11-26.pdf"', 'x.pdf')).toBe('laporan-penjualan-2026-11-20_2026-11-26.pdf')
    expect(pdfFilename('attachment; filename="../../etc/passwd"', 'laporan.pdf')).toBe('laporan.pdf')
    expect(pdfFilename(null, 'laporan.pdf')).toBe('laporan.pdf')
  })
})

describe('rangeLabel', () => {
  it('words a range the way the server does', () => {
    expect(rangeLabel('2026-11-20', '2026-11-26')).toBe('20 sampai 26 Nov 2026')
    expect(rangeLabel('2026-10-30', '2026-11-05')).toBe('30 Okt sampai 5 Nov 2026')
    expect(rangeLabel('2025-12-30', '2026-01-05')).toBe('30 Des 2025 sampai 5 Jan 2026')
    expect(rangeLabel('2026-11-26', '2026-11-26')).toBe('26 Nov 2026')
  })
})
