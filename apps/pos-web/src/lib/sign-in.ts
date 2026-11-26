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

/**
 * The local "Masuk (pengembangan)" sign-in: shown and served only where pos-api would also accept it, an explicit
 * development or test NODE_ENV (an unset one refuses) with POS_DEV_USER_ID set.
 */
export function devSignInUser(env: Record<string, string | undefined> = process.env): string | undefined {
  return ['development', 'test'].includes(env.NODE_ENV ?? '') && env.POS_DEV_USER_ID ? env.POS_DEV_USER_ID : undefined
}

/** Why the last sign-in failed, from the status `/masuk*` put in `?gagal=`. */
export function failureText(status: number): string {
  if (status === 0 || status >= 500) return 'UMKMall sedang tidak bisa dihubungi. Coba lagi sebentar lagi.'
  if (status === 401) return 'Sesi UMKMall Anda sudah berakhir atau akun belum terdaftar. Masuk lagi ke UMKMall.'
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

/**
 * Where a sign-in may land instead of the POS home (UMK-2054). The cookie holds only a key of this list, never a
 * path, so a sign-in cannot be sent anywhere else. `keamanan`: the owner asked to sign in again to reset their PIN.
 */
export const RETURN_PATHS = { keamanan: '/pengaturan/keamanan?lupa=1' } as const
export type ReturnKey = keyof typeof RETURN_PATHS

/** The landing path of a sign-in for the cookie's value: the listed path, or the POS home's "signed in" toast. */
export function landingPath(key: string | undefined): string {
  return key !== undefined && Object.hasOwn(RETURN_PATHS, key) ? RETURN_PATHS[key as ReturnKey] : '/?masuk=1'
}

export const seeOther = (location: string) => new Response(null, { status: 303, headers: { location } })
