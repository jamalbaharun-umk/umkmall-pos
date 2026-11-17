import { redirect } from '@tanstack/react-router'
import { clearSessionToken, getSessionToken, posApiUrl, startSession } from './session.server'
import { sessionKind } from './sign-in'

export const UMKMALL_DOWN = 'UMKMall sedang tidak bisa dihubungi, coba lagi'
export const API_DOWN = 'Tidak bisa terhubung ke server kasir. Periksa koneksi lalu coba lagi.'

/**
 * Server-side pos-api client for server functions and loaders. Sends the session cookie as a bearer.
 * On a 401: a cashier session cannot refresh, so it is cleared and sent to `/kasir/masuk` (PIN sign-in); an owner
 * session refreshes once and retries. A refused refresh (401) clears the cookie and redirects to `/`; UMKMall being
 * unreachable (503, or pos-api down) keeps the session and throws a retryable message instead of signing out.
 * Other statuses are returned for the caller to handle.
 */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getSessionToken()
  if (!token) throw redirect({ to: '/' })
  const res = await send(path, init, token)
  if (res.status !== 401) return res

  if (sessionKind(token) === 'cashier') {
    clearSessionToken()
    throw redirect({ to: '/kasir/masuk' })
  }
  const fresh = await startSession('/auth/refresh', {}, token)
  if (typeof fresh === 'string') return send(path, init, fresh)
  if (fresh === 0 || fresh >= 500) throw new Error(UMKMALL_DOWN)
  clearSessionToken()
  throw redirect({ to: '/' })
}

function send(path: string, init: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  // FormData sets its own multipart boundary; everything else this client sends is JSON.
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type'))
    headers.set('content-type', 'application/json')
  // A refused or dropped connection must not reach a page as the runtime's English "fetch failed".
  return fetch(`${posApiUrl()}${path}`, { ...init, headers }).catch(() => {
    throw new Error(API_DOWN)
  })
}
