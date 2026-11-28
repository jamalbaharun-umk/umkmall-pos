import { deleteCookie, getCookie, getRequestHeader, setCookie } from '@tanstack/react-start/server'
import { landingPath, parseNativeSession, sessionKind, type NativeSession, type ReturnKey } from './sign-in'

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
  deleteCookie(NATIVE, { path: '/' })
}

// UMKMall's native session behind an owner's WhatsApp sign-in (UMK-2065): `{ sid, refreshToken }`, the owner refresh's
// credential. httpOnly and host-only, so page JS and other umkmall.id hosts never see it; pos-api keeps no copy.
const NATIVE = 'pos_umkmall'
const NATIVE_COOKIE_SECONDS = 30 * 24 * 60 * 60 // UMKMall's native refresh lifetime; UMKMall decides the real end

function storeNative(session: NativeSession): void {
  setCookie(NATIVE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: NATIVE_COOKIE_SECONDS,
  })
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

type SessionAnswer = { sessionToken: string; expiresIn: number; umkmall?: { sid: string; refreshToken?: string } }

/**
 * Stores a session pos-api answered: the POS token, and for an owner's WhatsApp sign-in or refresh the UMKMall native
 * session (a refresh without `refreshToken` keeps the stored one: UMKMall did not rotate it).
 */
export function storeSession({ sessionToken, expiresIn, umkmall }: SessionAnswer): void {
  // An owner token lapses in minutes; its cookie outlives it so api() knows to refresh on the first 401.
  setSessionToken(sessionToken, sessionKind(sessionToken) === 'owner' ? OWNER_COOKIE_SECONDS : expiresIn)
  if (!umkmall) return
  const refreshToken = umkmall.refreshToken ?? parseNativeSession(getCookie(NATIVE))?.refreshToken
  if (refreshToken) storeNative({ sid: umkmall.sid, refreshToken })
}

/**
 * POSTs to a pos-api auth route and stores the session it answers. Returns the new token, or the refusal's HTTP
 * status (0 when pos-api could not be reached), so callers can tell "signed out" (401) from "try again" (503/0).
 */
export async function startSession(path: string, body: unknown, headers: Record<string, string> = {}): Promise<string | number> {
  const res = await fetch(`${posApiUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!res) return 0
  if (!res.ok) return res.status
  const answer = (await res.json()) as SessionAnswer
  storeSession(answer)
  return answer.sessionToken
}

/** UMK-2124: the owner's native session id on this device, which "Serahkan ke pembantu" asks pos-api to park. */
export function nativeSid(): string | undefined {
  return parseNativeSession(getCookie(NATIVE))?.sid
}

/**
 * The owner refresh (UMK-2065): UMKMall's native session → a new 15-minute owner session, never a sign-in (UMK-2054).
 * 401 without a call when there is no native session (a dev sign-in, or signed out).
 */
export async function refreshOwner(): Promise<string | number> {
  const native = parseNativeSession(getCookie(NATIVE))
  return native ? startSession('/auth/umkmall/refresh', native) : 401
}

/** Signs the owner out of the POS: ends the POS's own UMKMall session (best effort) and drops every session cookie. */
export async function endOwnerSession(): Promise<void> {
  const native = parseNativeSession(getCookie(NATIVE))
  if (native)
    await fetch(`${posApiUrl()}/auth/umkmall/sign-out`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(native),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
  clearSessionToken()
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

/**
 * A state-changing form POST made by a page of the POS itself, not by another site (UMK-2054: `/masuk/ulang` ends the
 * owner's sessions and sets the landing cookie). `Sec-Fetch-Site` decides when the browser sends it (every current one
 * does): only `same-origin` passes, also `same-site` (another umkmall.id host) fails. Without it, the `Origin` must be
 * the POS's own: POS_WEB_URL's origin, or, where that is not set (local work), this request's host. No header fails.
 */
export function isSameOriginPost(h: {
  secFetchSite?: string
  origin?: string
  host?: string
  posWebUrl?: string
}): boolean {
  if (h.secFetchSite !== undefined) return h.secFetchSite === 'same-origin'
  if (!h.origin || h.origin === 'null') return false
  let origin: string
  try {
    origin = new URL(h.origin).origin
  } catch {
    return false
  }
  if (h.posWebUrl) return origin === new URL(h.posWebUrl).origin
  return h.host !== undefined && (origin === `https://${h.host}` || origin === `http://${h.host}`)
}

/** `isSameOriginPost` for the request being served. */
export const sameOriginRequest = () =>
  isSameOriginPost({
    secFetchSite: getRequestHeader('sec-fetch-site'),
    origin: getRequestHeader('origin'),
    host: getRequestHeader('host'),
    posWebUrl: process.env.POS_WEB_URL,
  })
