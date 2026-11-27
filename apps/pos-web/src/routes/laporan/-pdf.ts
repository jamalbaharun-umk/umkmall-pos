import type { FailureLike } from '@/lib/describe-error'

// The PDF download of a report (design feature 37): the screen asks the session route `/laporan/pdf/<laporan>`, which
// streams pos-api's PDF. These are the pure parts: which report goes to which pos-api path, which query keys pass, and
// how a refusal becomes the error dialog's input.

export const PDF_PATHS: Record<string, string> = {
  penjualan: '/reports/pdf/sales',
  produk: '/reports/pdf/products',
  shift: '/reports/pdf/shifts',
  pembelian: '/reports/pdf/purchasing',
  'untung-rugi': '/reports/pdf/profit-loss',
  kasbon: '/reports/pdf/receivables',
  'penjualan-pengeluaran': '/reports/sales-expenses/pdf',
}

const PASS = ['from', 'to', 'period', 'filter', 'scale', 'count', 'include'] as const

/** Only the keys pos-api reads; a tenant id or anything else never leaves the relay. */
export function pdfQuery(params: URLSearchParams): string {
  const out = new URLSearchParams()
  for (const k of PASS) {
    const v = params.get(k)
    if (v) out.set(k, v)
  }
  return out.toString()
}

const RANGE_TODO = 'Pilih rentang lebih pendek, atau pindah ke laporan Bulanan.'
const TOO_LARGE_TODO = 'Persempit rentang tanggalnya, atau unduh CSV untuk semua baris.'

/** A failed PDF download as the error dialog's input: our relay's own short message, a code, and the next step. */
export function pdfFailure(status: number, body: { message?: unknown; code?: unknown } | null): FailureLike {
  const code = typeof body?.code === 'string' ? body.code : undefined
  const message = typeof body?.message === 'string' ? body.message : undefined
  if (status === 0) return { status: 0, offline: true }
  if (status === 403) return { status, error: 'Anda tidak punya izin melihat laporan.' }
  if (code === 'EXPORT_RANGE_TOO_LARGE') return { status: 422, code, error: message, todo: RANGE_TODO }
  if (code === 'EXPORT_TOO_LARGE') return { status: 422, code, error: message, todo: TOO_LARGE_TODO }
  if (code === 'EXPORT_BUSY' || code === 'EXPORT_TIMEOUT')
    return { status: 503, code, error: message, todo: code === 'EXPORT_BUSY' ? 'Tunggu sebentar, lalu coba lagi.' : 'Pilih rentang lebih pendek, lalu coba lagi.' }
  return { status, code, error: [422, 502, 503].includes(status) ? message : undefined }
}

/** `laporan-penjualan-2026-11-20_2026-11-26.pdf` from the server's Content-Disposition, or a safe default. */
export function pdfFilename(disposition: string | null, fallback: string): string {
  const m = /filename="([A-Za-z0-9._-]+\.pdf)"/.exec(disposition ?? '')
  return m ? m[1] : fallback
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** "20 sampai 26 Nov 2026" for the toast of a PDF of `from..to` (store calendar dates, no timezone shift). */
export function rangeLabel(from: string, to: string): string {
  const part = (d: string) => ({ y: d.slice(0, 4), m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) })
  const a = part(from)
  const b = part(to)
  if (from === to) return `${a.d} ${MONTHS[a.m - 1]} ${a.y}`
  if (a.y === b.y && a.m === b.m) return `${a.d} sampai ${b.d} ${MONTHS[b.m - 1]} ${b.y}`
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m - 1]} sampai ${b.d} ${MONTHS[b.m - 1]} ${b.y}`
  return `${a.d} ${MONTHS[a.m - 1]} ${a.y} sampai ${b.d} ${MONTHS[b.m - 1]} ${b.y}`
}
