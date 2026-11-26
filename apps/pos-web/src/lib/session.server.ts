import { appendResponseHeader, deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'
import { landingPath, loginUrl, sessionKind, type ReturnKey } from './sign-in'

// The POS session lives only in this httpOnly cookie; the browser never sees the token in JS or a URL.
const COOKIE = 'pos_session'

export function posApiUrl(): string {
  const url = process.env.POS_API_URL
  if (!url) throw new Error('POS_API_URL is not set')
  return url.replace(/\/$/, '')
}

export function getSessionToken(): string | undefined {
  return getCookie(COOKIE)
}

export function setSessionToken(token: string, maxAgeSeconds: number): void {
  setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  })
}

export function clearSessionToken(): void {
  deleteCookie(COOKIE, { path: '/' })
  deleteCookie(LAST_ME, { path: '/' })
}

// The last answer of /tenant/me, so the shell can still render (with a banner) while UMKMall or pos-api is
// unreachable. Display only: every action is still authorised by pos-api.
const LAST_ME = 'pos_me'

export function rememberMe(me: unknown, maxAgeSeconds = 7 * 24 * 60 * 60): void {
  setCookie(LAST_ME, JSON.stringify(me), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  })
}

export function lastMe<T>(): T | null {
  try {
    const raw = getCookie(LAST_ME)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

const OWNER_COOKIE_SECONDS = 7 * 24 * 60 * 60

type SessionAnswer = { sessionToken: string; expiresIn: number }

/**
 * POSTs to a pos-api auth route and stores the session it answers. Returns the new token, or the refusal's HTTP
 * status (0 when pos-api could not be reached), so callers can tell "signed out" (401) from "try again" (503/0).
 * Every Set-Cookie pos-api answers (UMKMall's renewed or newly minted login cookies) reaches the browser unchanged,
 * refusals included: dropping one signs the owner out of UMKMall later.
 */
export async function startSession(path: string, body: unknown, headers: Record<string, string> = {}): Promise<string | number> {
  const res = await fetch(`${posApiUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res) return 0
  for (const cookie of res.headers.getSetCookie()) appendResponseHeader('set-cookie', cookie)
  if (!res.ok) return res.status
  const { sessionToken, expiresIn } = (await res.json()) as SessionAnswer
  // An owner token lapses in minutes; its cookie outlives it so api() knows to re-check UMKMall on the first 401.
  setSessionToken(sessionToken, sessionKind(sessionToken) === 'owner' ? OWNER_COOKIE_SECONDS : expiresIn)
  return sessionToken
}

/** UMKMall's login cookies; only these go to pos-api (and on to UMKMall's `/api/auth/me`). */
const UMKMALL_COOKIES = ['auth_token', 'auth_refresh'] as const

/**
 * Owner sign-in and refresh from the shared UMKMall login cookie (UMK-1945). 401 without a call when the browser
 * sent neither cookie (localhost, or not signed in to UMKMall).
 *
 * `signIn` (UMK-2054) is true only where a person signs in (the sign-in page, the landing after UMKMall's login):
 * pos-api then marks the session fresh for a few minutes, which resetting or unlocking the owner's PIN asks for.
 * The refresh of a session (`api()` after a 401) never passes it.
 */
export async function umkmallSession(signIn = false): Promise<string | number> {
  const cookie = UMKMALL_COOKIES.flatMap((name) => {
    const value = getCookie(name)
    return value === undefined ? [] : [`${name}=${value}`]
  }).join('; ')
  return cookie ? startSession('/auth/umkmall/session', signIn ? { signIn: true } : {}, { cookie }) : 401
}

/** UMKMall's login page, coming back to the POS home afterwards; `/` (the POS sign-in page) when not configured. */
export const umkmallLoginUrl = () => loginUrl(process.env.UMKMALL_WEB_URL, process.env.POS_WEB_URL)

// Set by /keluar so `/` does not sign the owner straight back in from the UMKMall cookie; cleared by /masuk.
const SIGNED_OUT = 'pos_keluar'

export const signedOut = () => getCookie(SIGNED_OUT) === '1'

export function setSignedOut(on: boolean): void {
  if (!on) return deleteCookie(SIGNED_OUT, { path: '/' })
  setCookie(SIGNED_OUT, '1', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' })
}

// Set by /masuk/ulang (UMK-2054): the next sign-in lands on the page that asked for it. Holds a key of RETURN_PATHS.
const RETURN_TO = 'pos_kembali'

export function setReturnTo(key: ReturnKey): void {
  setCookie(RETURN_TO, key, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 5 * 60,
  })
}

/** Where the sign-in that just succeeded lands; the cookie is used once. */
export function takeLandingPath(): string {
  const key = getCookie(RETURN_TO)
  if (key !== undefined) deleteCookie(RETURN_TO, { path: '/' })
  return landingPath(key)
}
