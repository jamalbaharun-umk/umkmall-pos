import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'

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

type SessionAnswer = { sessionToken: string; expiresIn: number }

/** POSTs to a pos-api auth route and stores the session it answers. Returns the new token, or null on any refusal. */
export async function startSession(path: string, body: unknown, bearer?: string): Promise<string | null> {
  const res = await fetch(`${posApiUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res?.ok) return null
  const { sessionToken, expiresIn } = (await res.json()) as SessionAnswer
  setSessionToken(sessionToken, expiresIn)
  return sessionToken
}

/** Exchanges a UMKMall handoff token (server to server) for a POS owner session. */
export const exchangeHandoff = (token: string) => startSession('/auth/umkmall/exchange', { token })
