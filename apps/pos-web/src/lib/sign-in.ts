// Pure helpers for signing in and out, kept apart from the server-only cookie code so they can be unit tested.

/** The actor kind inside the session token, read without verifying (pos-api verifies); only used to route a refusal. */
export function sessionKind(token: string): 'owner' | 'cashier' | 'helper' | undefined {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { kind?: unknown }
    return claims.kind === 'cashier' || claims.kind === 'owner' || claims.kind === 'helper' ? claims.kind : undefined
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
  if (status === 0 || status >= 500) return 'Server kasir sedang tidak bisa dihubungi. Coba lagi sebentar lagi.'
  if (status === 401) return 'Sesi Anda sudah berakhir. Masuk lagi dengan nomor WhatsApp.'
  if (status === 422) return 'Data masuk tidak lengkap. Coba lagi.'
  return 'Gagal masuk. Coba lagi sebentar lagi.'
}

/** The code the OTP relay sets when pos-api answers 404 on the WhatsApp routes: UMKMALL_API_URL is not set there. */
export const WHATSAPP_NOT_SET_UP = 'whatsapp_not_set_up'
export const WHATSAPP_NOT_SET_UP_TEXT = 'Masuk lewat WhatsApp belum diatur di lingkungan ini.'

/** pos-api answers a bare 404 on its WhatsApp routes only when it has no UMKMall login service configured. */
export const whatsappNotSetUp = (status: number) => status === 404

/** UMKMall's native session behind an owner's WhatsApp sign-in, as the `pos_umkmall` cookie holds it (UMK-2065). */
export type NativeSession = { sid: string; refreshToken: string }

/** The cookie's value, or undefined for anything else (absent, cut, edited): pos-api validates it again. */
export function parseNativeSession(raw: string | undefined): NativeSession | undefined {
  try {
    const v = JSON.parse(raw ?? '') as Partial<NativeSession>
    return typeof v.sid === 'string' && typeof v.refreshToken === 'string' && v.sid && v.refreshToken
      ? { sid: v.sid, refreshToken: v.refreshToken }
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Where a sign-in may land instead of the POS home (UMK-2054). The cookie holds only a key of this list, never a
 * path, so a sign-in cannot be sent anywhere else. `keamanan`: the owner asked to sign in again to reset their PIN.
 */
export const RETURN_PATHS = {
  keamanan: '/pengaturan/keamanan?lupa=1',
  // UMK-2124: the owner ends a handover whose helper device is gone (needs a fresh sign-in), back on the till.
  pembantu: '/kasir?pembantu=akhiri',
  // UMK-2124: an owner session that cannot park this device's native session signs in again, back on the till.
  kasir: '/kasir',
} as const

/** The landing key `/masuk/ulang` was sent (a form field); anything unknown is Keamanan's, as before. */
export const returnKeyOf = (value: unknown): ReturnKey =>
  typeof value === 'string' && Object.hasOwn(RETURN_PATHS, value) ? (value as ReturnKey) : 'keamanan'
export type ReturnKey = keyof typeof RETURN_PATHS

/** The landing path of a sign-in for the cookie's value: the listed path, or the POS home's "signed in" toast. */
export function landingPath(key: string | undefined): string {
  return key !== undefined && Object.hasOwn(RETURN_PATHS, key) ? RETURN_PATHS[key as ReturnKey] : '/?masuk=1'
}

export const seeOther = (location: string) => new Response(null, { status: 303, headers: { location } })
