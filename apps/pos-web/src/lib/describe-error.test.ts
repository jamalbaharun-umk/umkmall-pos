import { afterEach, describe, expect, it, vi } from 'vitest'
import { OFFLINE_TEXT, SERVER_UNREACHABLE_TEXT, describeError, isSafeText } from './describe-error'

const FALLBACK = 'Pengeluaran belum tersimpan.'

afterEach(() => vi.unstubAllGlobals())

describe('describeError', () => {
  it('422 shows pos-api text and the fix; 400 too', () => {
    const d = describeError({ status: 422, error: 'Jumlah harus lebih dari Rp0.' }, FALLBACK)
    expect(d.what).toBe('Jumlah harus lebih dari Rp0.')
    expect(d.todo).toMatch(/ditandai merah/)
    expect(d.code).toBe('422')
    expect(describeError({ status: 422 }, FALLBACK).what).toBe('Isian belum benar.')
    expect(describeError({ status: 400 }, FALLBACK).code).toBe('400')
  })

  it('403 never echoes the server text', () => {
    const d = describeError({ status: 403, error: 'Forbidden resource sales.void' }, FALLBACK)
    expect(d.what).toBe('Akun Anda tidak boleh melakukan ini.')
    expect(d.primary).toBe('none')
  })

  it('404 offers a reload', () => {
    const d = describeError({ status: 404, error: 'x' }, FALLBACK)
    expect(d.what).toMatch(/tidak ditemukan/)
    expect(d.primary).toBe('reload')
  })

  it('409 uses the refusal text when safe, a generic one otherwise', () => {
    expect(describeError({ status: 409, error: 'Stok Minyak tinggal 3 pcs.' }, FALLBACK).what).toBe(
      'Stok Minyak tinggal 3 pcs.',
    )
    expect(describeError({ status: 409, error: 'duplicate key value violates unique constraint (sql)' }, FALLBACK).what).toMatch(
      /bentrok/,
    )
  })

  it('429 and 423 say it is locked and how long', () => {
    const d = describeError({ status: 429, retryAfter: 45 }, FALLBACK)
    expect(d.what).toMatch(/Terlalu banyak percobaan/)
    expect(d.todo).toMatch(/45 detik/)
    expect(describeError({ status: 423, retryAfter: 300 }, FALLBACK).todo).toMatch(/5 menit/)
  })

  it('5xx and 503 are a system problem with a retry, never the server text', () => {
    for (const status of [500, 502, 503]) {
      const d = describeError({ status, error: 'TypeError: cannot read properties of undefined' }, FALLBACK)
      expect(d.what).toMatch(/gangguan di sistem kami/)
      expect(d.primary).toBe('retry')
      expect(d.code).toBe(String(status))
    }
  })

  it('no answer (status 0, offline flag, fetch failure) is OFFLINE', () => {
    expect(describeError({ status: 0, error: 'x' }, FALLBACK).code).toBe('OFFLINE')
    expect(describeError({ status: 0 }, FALLBACK).what).toBe(SERVER_UNREACHABLE_TEXT)
    expect(describeError({ offline: true }, FALLBACK).what).toBe(OFFLINE_TEXT)
    expect(describeError(new TypeError('Failed to fetch'), FALLBACK).code).toBe('OFFLINE')
    expect(describeError(new Error('Tidak bisa terhubung ke server kasir.'), FALLBACK).code).toBe('OFFLINE')
  })

  it('a browser that reports offline wins over a missing status', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(describeError({ error: 'Gagal' }, FALLBACK).what).toBe(OFFLINE_TEXT)
  })

  it('401 asks to sign in again', () => {
    expect(describeError({ status: 401 }, FALLBACK).primary).toBe('signin')
  })

  it('with no status it trusts safe text only, else the caller fallback', () => {
    expect(describeError({ error: 'Kategori masih dipakai produk.' }, FALLBACK).what).toBe('Kategori masih dipakai produk.')
    expect(describeError(new Error('Bearer abc.def.ghi'), FALLBACK).what).toBe(FALLBACK)
    expect(describeError(undefined, FALLBACK)).toMatchObject({ what: FALLBACK, code: 'UNKNOWN' })
  })

  it('a stable code is shown, a free-text code is not', () => {
    expect(describeError({ status: 409, code: 'DRAWER_INSUFFICIENT', error: 'Uang laci kurang.' }, FALLBACK).code).toBe(
      'DRAWER_INSUFFICIENT',
    )
    expect(describeError({ status: 409, code: 'oops <script>' }, FALLBACK).code).toBe('409')
  })
})

describe('isSafeText', () => {
  it('blocks tokens, internals, long digit runs (PIN or phone) and long text', () => {
    for (const bad of [
      'Bearer eyJhbGciOi',
      'select * from pos.sales',
      'PIN 123456 salah',
      'Hubungi 081234567890',
      'Hubungi 0812-3456-7890',
      'ECONNREFUSED 127.0.0.1',
      '<html>Bad gateway</html>',
      'x'.repeat(300),
      '',
      undefined,
    ])
      expect(isSafeText(bad)).toBe(false)
  })
  it('allows ordinary Indonesian sentences with rupiah', () => {
    expect(isSafeText('Uang di laci Rp1.390.000, tetapi Anda mengambil Rp2.000.000.')).toBe(true)
  })
})
