// Pure helpers for signing in and out, kept apart from the server-only cookie code so they can be unit tested.

/** The actor kind inside the session token, read without verifying (pos-api verifies); only used to route a refusal. */
export function sessionKind(token: string): 'owner' | 'cashier' | undefined {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { kind?: unknown }
    return claims.kind === 'cashier' || claims.kind === 'owner' ? claims.kind : undefined
  } catch {
    return undefined
  }
}

/** Why the last sign-in failed, from the status `/masuk/*` put in `?gagal=`. */
export function failureText(status: number): string {
  if (status === 0 || status >= 500) return 'UMKMall sedang tidak bisa dihubungi. Coba lagi sebentar lagi.'
  if (status === 401)
    return 'Tautan masuk sudah dipakai atau kedaluwarsa, atau akun UMKMall belum terdaftar. Buka Kasir lagi dari UMKMall.'
  if (status === 422) return 'Data masuk tidak lengkap. Buka Kasir lagi dari UMKMall.'
  return 'Gagal masuk. Tautan dari UMKMall hanya berlaku sekali dan beberapa menit, coba lagi dari UMKMall.'
}

