import { redirect } from '@tanstack/react-router'
import { clearSessionToken, getSessionToken, posApiUrl, startSession } from './session.server'

/**
 * Server-side pos-api client for server functions and loaders. Sends the session cookie as a bearer;
 * on a 401 it refreshes the session once and retries; when the refresh fails it clears the cookie and
 * redirects to `/` (the sign-in page). Other statuses are returned for the caller to handle.
 */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getSessionToken()
  if (!token) throw redirect({ to: '/' })
  const res = await send(path, init, token)
  if (res.status !== 401) return res

  const fresh = await startSession('/auth/refresh', {}, token)
  if (!fresh) {
    clearSessionToken()
    throw redirect({ to: '/' })
  }
  return send(path, init, fresh)
}

function send(path: string, init: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return fetch(`${posApiUrl()}${path}`, { ...init, headers })
}
