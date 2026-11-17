import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'
import { sessionKind } from './sign-in'

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
}

const OWNER_COOKIE_SECONDS = 7 * 24 * 60 * 60

type SessionAnswer = { sessionToken: string; expiresIn: number }

/**
 * POSTs to a pos-api auth route and stores the session it answers. Returns the new token, or the refusal's HTTP
 * status (0 when pos-api could not be reached), so callers can tell "signed out" (401) from "try again" (503/0).
 */
export async function startSession(path: string, body: unknown, bearer?: string): Promise<string | number> {
  const res = await fetch(`${posApiUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res) return 0
  if (!res.ok) return res.status
  const { sessionToken, expiresIn } = (await res.json()) as SessionAnswer
  // An owner token lapses in minutes but stays refreshable for pos-api's REFRESH_WINDOW (7 days, gated by UMKMall
  // liveness), so its cookie must outlive it; api() refreshes on the first 401.
  setSessionToken(sessionToken, sessionKind(sessionToken) === 'owner' ? OWNER_COOKIE_SECONDS : expiresIn)
  return sessionToken
}

/** Exchanges a UMKMall handoff token (server to server) for a POS owner session. */
export const exchangeHandoff = (token: string) => startSession('/auth/umkmall/exchange', { token })
