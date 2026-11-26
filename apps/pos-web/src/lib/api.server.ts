import { redirect } from '@tanstack/react-router'
import { setResponseStatus } from '@tanstack/react-start/server'
import { clearSessionToken, getSessionToken, posApiUrl, refreshOwner } from './session.server'
import { sessionKind } from './sign-in'

export const UMKMALL_DOWN = 'Layanan login UMKMall sedang tidak bisa dihubungi, coba lagi'
export const API_DOWN = 'Tidak bisa terhubung ke server kasir. Periksa koneksi lalu coba lagi.'

/** An answer that takes longer is "no answer" (UMK-2051), same as an unreachable server: the screen shows its retry. */
export const API_TIMEOUT_MS = 15_000
/** `POS_API_TIMEOUT_MS` (a positive number) overrides it, for tests and slow links. */
function timeoutMs(): number {
  const n = Number(process.env.POS_API_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : API_TIMEOUT_MS
}

/**
 * Server-side pos-api client for server functions and loaders. Sends the session cookie as a bearer.
 * On a 401: a cashier session cannot refresh, so it is cleared and sent to `/kasir/masuk` (PIN sign-in); an owner
 * session refreshes once through UMKMall's native session (UMK-2065) and retries. A refused refresh (401: signed out,
 * session revoked, account being deleted) clears the cookies and redirects to the sign-in page; UMKMall being
 * unreachable (503, or pos-api down) keeps the session and throws a retryable message instead of signing out.
 * Other statuses are returned for the caller to handle.
 */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getSessionToken()
  if (!token) throw redirect({ to: '/' })
  const res = await send(path, init, token)
  if (res.status !== 401) return pageStatus(res, init)

  if (sessionKind(token) === 'cashier') {
    clearSessionToken()
    throw redirect({ to: '/kasir/masuk' })
  }
  const fresh = await refreshOwner()
  if (typeof fresh === 'string') return pageStatus(await send(path, init, fresh), init)
  if (fresh === 0 || fresh >= 500) {
    trySetStatus(503)
    throw new Error(UMKMALL_DOWN)
  }
  clearSessionToken()
  throw redirect({ to: '/' })
}

/**
 * The router answers every failed page load with HTTP 500. A read that pos-api refused (403, 404) or an unreachable
 * upstream (503) sets the real status on the request, which Start applies to the page response (the page text
 * stays the Indonesian error state). Mutations keep their own status handling, so only GET reads set it.
 */
function pageStatus(res: Response, init: RequestInit): Response {
  if ((init.method ?? 'GET') === 'GET' && (res.status === 403 || res.status === 404)) trySetStatus(res.status)
  return res
}

/** Sets the page status when there is a request to set it on (no-op in tests or outside a request). */
export function trySetStatus(status: number): void {
  try {
    setResponseStatus(status)
  } catch {
    // not inside a Start request
  }
}

function send(path: string, init: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  // FormData sets its own multipart boundary; everything else this client sends is JSON.
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type'))
    headers.set('content-type', 'application/json')
  // A refused or dropped connection must not reach a page as the runtime's English "fetch failed".
  const timeout = AbortSignal.timeout(timeoutMs())
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  // A timeout or an abort ends in the same catch as a refused connection: the caller sees "no answer" (status 0 on
  // the screen), never a hanging request that keeps a sale's check disabled until a reload.
  return fetch(`${posApiUrl()}${path}`, { ...init, headers, signal }).catch(() => {
    trySetStatus(503)
    throw new Error(API_DOWN)
  })
}
