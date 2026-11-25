import { describeError, type ErrorDescription, type FailureLike } from './describe-error'

/**
 * Error text for the owner's "Hubungkan perangkat" (UMK-2022). pos-api answers one text for a wrong, a used and an
 * expired code (422, per field); a lock after wrong codes is 429 with `retryAfter`. The rest is the shared mapping.
 */
export function describePairError(failure: unknown, fallback: string): ErrorDescription {
  const f = (failure && typeof failure === 'object' ? failure : {}) as FailureLike
  if (f.status === 422)
    return {
      what: 'Kode tidak berlaku: salah, sudah dipakai, atau lewat 10 menit.',
      todo: 'Minta perangkat kasir menampilkan kode baru, lalu ketik lagi.',
      code: 'PAIRING_CODE_INVALID',
      primary: 'none',
    }
  if (f.status === 429) {
    const wait = f.retryAfter
    const when = typeof wait === 'number' && wait > 0 ? (wait >= 90 ? `${Math.ceil(wait / 60)} menit` : `${Math.ceil(wait)} detik`) : 'beberapa saat'
    return {
      what: 'Terlalu banyak kode salah, jadi menghubungkan perangkat ditahan sementara.',
      todo: `Tunggu ${when}, lalu coba lagi dengan kode yang tampil di perangkat kasir.`,
      code: 'PAIRING_LOCKED',
      primary: 'none',
    }
  }
  if (f.status === 403)
    return {
      what: 'Akun Anda tidak boleh menghubungkan perangkat.',
      todo: 'Minta pemilik toko menghubungkannya, atau masuk dengan akun pemilik.',
      code: '403',
      primary: 'none',
    }
  return describeError(failure, fallback)
}
