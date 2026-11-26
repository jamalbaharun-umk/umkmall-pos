import type { FailureLike } from '../../lib/describe-error'

// Pure helpers of Pengaturan, Keamanan for the owner's own PIN (UMK-2054), kept apart from the page for unit tests.

/** pos-api's refusal code when the owner's PIN is made, removed or unlocked without a sign-in of the last minutes. */
export const FRESH_SIGN_IN_REQUIRED = 'fresh_sign_in_required'

/** True for pos-api's 403 that asks the owner to sign in again; any other 403 is a missing permission. */
export function needsFreshSignIn(status: number, body: unknown): boolean {
  return (
    status === 403 &&
    !!body &&
    typeof body === 'object' &&
    (body as { code?: unknown }).code === FRESH_SIGN_IN_REQUIRED
  )
}

/** What the "Masuk lagi" dialog says, by what the owner was doing. */
export type FreshReason = 'forgot' | 'first' | 'unlock' | 'expired'

export function freshSignInText(reason: FreshReason): { title: string; body: string } {
  switch (reason) {
    case 'forgot':
      return {
        title: 'Lupa PIN?',
        body: 'PIN lama tidak bisa dilihat lagi. Untuk membuat PIN baru tanpa PIN lama, masuk lagi dengan akun UMKMall Anda. Setelah masuk, Anda kembali ke halaman ini dan punya 5 menit untuk membuat PIN baru.',
      }
    case 'first':
      return {
        title: 'Masuk lagi untuk membuat PIN',
        body: 'PIN pemilik hanya bisa dibuat dalam 5 menit setelah Anda masuk dengan akun UMKMall. Masuk lagi, lalu buat PIN di halaman ini.',
      }
    case 'unlock':
      return {
        title: 'Masuk lagi untuk membuka kunci',
        body: 'Kunci PIN pemilik hanya bisa dibuka dalam 5 menit setelah Anda masuk dengan akun UMKMall. Masuk lagi, lalu buka kuncinya atau buat PIN baru di halaman ini.',
      }
    case 'expired':
      return {
        title: 'Waktu 5 menit sudah habis',
        body: 'PIN belum berubah. Masuk lagi dengan akun UMKMall, lalu buat PIN baru dalam 5 menit.',
      }
  }
}

/**
 * A wrong old PIN in the change form, as the error dialog reads it: it is the actor's own PIN, so the text never says
 * "ask another admin"; the owner is pointed at "Lupa PIN".
 */
export function wrongOldPin(isOwner: boolean): FailureLike {
  return {
    status: 422,
    error: 'PIN lama tidak cocok. PIN belum diganti.',
    todo: isOwner
      ? 'Periksa PIN lama lalu coba lagi. Salah 5 kali mengunci PIN 5 menit. Kalau lupa, tekan Lupa PIN.'
      : 'Periksa PIN lama lalu coba lagi. Salah 5 kali mengunci PIN 5 menit. Kalau lupa, minta pemilik menghapus PIN Anda.',
  }
}
