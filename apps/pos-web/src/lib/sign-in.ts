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

/** Why the last sign-in failed, from the status `/masuk*` put in `?gagal=`. */
export function failureText(status: number): string {
  if (status === 0 || status >= 500) return 'UMKMall sedang tidak bisa dihubungi. Coba lagi sebentar lagi.'
  if (status === 401) return 'Sesi UMKMall kamu sudah berakhir atau akun belum terdaftar. Masuk lagi ke UMKMall.'
  if (status === 422) return 'Data masuk tidak lengkap. Coba lagi.'
  return 'Gagal masuk. Coba lagi sebentar lagi.'
}

/**
 * UMKMall's login page with `next` = the POS home. `next` is built from POS_WEB_URL's origin only, never from the
 * request, so it cannot point anywhere but the POS host. `/` (the POS sign-in page) when either URL is missing.
 */
export function loginUrl(umkmallWebUrl: string | undefined, posWebUrl: string | undefined): string {
  if (!umkmallWebUrl || !posWebUrl) return '/'
  const url = new URL('/login', umkmallWebUrl)
  url.searchParams.set('next', `${new URL(posWebUrl).origin}/`)
  return url.toString()
}

export const seeOther = (location: string) => new Response(null, { status: 303, headers: { location } })
