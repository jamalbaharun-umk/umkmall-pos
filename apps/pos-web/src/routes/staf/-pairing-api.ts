import { createServerFn } from '@tanstack/react-start'
import { deleteCookie, getCookie, getRequestHeader, getRequestIP, setCookie } from '@tanstack/react-start/server'
import { api } from '@/lib/api.server'
import { buildForwardedFor, encodePairingCookie, parsePairingCookie } from '@/lib/pairing'
import { refusalOf, type Refusal } from '@/lib/refusal'
import { posApiUrl } from '@/lib/session.server'

// Device pairing by code (UMK-2022). The signed-out device asks pos-api for a code and shows it; the code and the
// secret token sit in an httpOnly cookie of that device, so the token never reaches page JS. Only the owner's own
// signed-in session (`staff.manage`) can enter the code, in Pengguna > Perangkat.

const PAIRING_COOKIE = 'pos_pairing'
const DEVICE_COOKIE = 'pos_device' // the same cookie `bindThisDevice` sets; read by the PIN screen
const DEVICE_COOKIE_SECONDS = 400 * 24 * 60 * 60

/**
 * pos-api counts open codes and polls per network address, so it must see the DEVICE's address, not pos-web's.
 * The relay passes on what it received plus the address the device connected from; pos-api trusts that chain only
 * for the proxies named in `POS_TRUSTED_PROXIES`.
 */
function deviceHeaders(): Record<string, string> {
  const forwarded = buildForwardedFor(getRequestHeader('x-forwarded-for'), getRequestIP() ?? undefined)
  return forwarded ? { 'x-forwarded-for': forwarded } : {}
}

export type PairingResult =
  | { ok: true; code: string; remaining: number }
  | { ok: false; error: string; status: number; retryAfter?: number }

async function failure(res: Response): Promise<{ ok: false; error: string; status: number; retryAfter?: number }> {
  const r: Refusal = await refusalOf(res)
  const retryAfter = r.retryAfter ?? (Number(res.headers.get('retry-after')) || undefined)
  return { ok: false, error: r.error, status: res.status, ...(retryAfter ? { retryAfter } : {}) }
}

const unreachable = { ok: false as const, status: 0, error: 'Tidak bisa terhubung ke server kasir.' }

function remember(token: string, code: string, expiresIn: number) {
  const expiresAt = Date.now() + expiresIn * 1000
  setCookie(PAIRING_COOKIE, encodePairingCookie({ token, code, expiresAt }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: expiresIn,
  })
}

/** The code this device is showing now, if its cookie still holds a live one (a reload keeps the same code). */
export const currentPairing = createServerFn().handler(async (): Promise<PairingResult | null> => {
  const p = parsePairingCookie(getCookie(PAIRING_COOKIE), Date.now())
  return p ? { ok: true, code: p.code, remaining: Math.max(1, Math.ceil((p.expiresAt - Date.now()) / 1000)) } : null
})

/** Asks for a new code. The previous one (if any) is dropped from this device; it simply expires on the server. */
export const startPairing = createServerFn({ method: 'POST' }).handler(async (): Promise<PairingResult> => {
  const res = await fetch(`${posApiUrl()}/auth/device/pairing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...deviceHeaders() },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res) return unreachable
  if (!res.ok) return failure(res)
  const { pairingToken, code, expiresIn } = (await res.json()) as { pairingToken: string; code: string; expiresIn: number }
  remember(pairingToken, code, expiresIn)
  return { ok: true, code, remaining: expiresIn }
})

export type PairingStatus =
  | { state: 'pending'; remaining: number }
  | { state: 'paired'; deviceName: string }
  /** No live pairing: the code ended, was never asked for, or its device was revoked. A new code is needed. */
  | { state: 'gone' }
  /** A transient failure (no answer, rate limit): keep the code on screen and ask again later. */
  | { state: 'retry'; retryAfter?: number }

/** One look at the pairing. When the owner has entered the code, the device token is stored in this device's cookie. */
export const pairingStatus = createServerFn({ method: 'POST' }).handler(async (): Promise<PairingStatus> => {
  const p = parsePairingCookie(getCookie(PAIRING_COOKIE), Date.now())
  if (!p) return { state: 'gone' }
  const res = await fetch(`${posApiUrl()}/auth/device/pairing/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...deviceHeaders() },
    body: JSON.stringify({ pairingToken: p.token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res) return { state: 'retry' }
  if (res.status === 404) {
    deleteCookie(PAIRING_COOKIE, { path: '/' })
    return { state: 'gone' }
  }
  if (!res.ok) return { state: 'retry', retryAfter: Number(res.headers.get('retry-after')) || undefined }
  const body = (await res.json()) as
    | { status: 'pending'; expiresIn: number }
    | { status: 'paired'; deviceToken: string; device: { name: string } }
  if (body.status === 'pending') return { state: 'pending', remaining: body.expiresIn }
  setCookie(DEVICE_COOKIE, body.deviceToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DEVICE_COOKIE_SECONDS,
  })
  deleteCookie(PAIRING_COOKIE, { path: '/' })
  return { state: 'paired', deviceName: body.device.name }
})

export type ClaimResult =
  | { ok: true; deviceName: string }
  | { ok: false; error: string; errors?: Record<string, string>; status: number; retryAfter?: number }

/** The owner's side: enter the code shown on the cashier device. The store is the session's, never sent by us. */
export const claimPairing = createServerFn({ method: 'POST' })
  .validator((d: { code: string; name: string }) => d)
  .handler(async ({ data }): Promise<ClaimResult> => {
    const res = await api('/staff/devices/pair', { method: 'POST', body: JSON.stringify(data) })
    if (!res.ok) {
      const r = await refusalOf(res)
      const retryAfter = r.retryAfter ?? (Number(res.headers.get('retry-after')) || undefined)
      return { ok: false, error: r.error, status: res.status, ...(r.errors ? { errors: r.errors } : {}), ...(retryAfter ? { retryAfter } : {}) }
    }
    const { device } = (await res.json()) as { device: { name: string } }
    return { ok: true, deviceName: device.name }
  })
