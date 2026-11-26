import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader, getRequestIP } from '@tanstack/react-start/server'
import { buildForwardedFor } from '@/lib/pairing'
import { posApiUrl, storeSession, takeLandingPath } from '@/lib/session.server'

// The owner's WhatsApp sign-in (UMK-2065). pos-api asks UMKMall; this relay only passes the input on and stores the
// session it answers (the POS token and UMKMall's native session, both httpOnly). The phone number and the code are
// never logged or kept here.

export type Consent = { tosVersionId?: string | null; privacyVersionId?: string | null; ageConfirmed?: boolean }
type Policy = { id: string }
export type ConsentAsk = {
  tos: Policy | null
  privacy: Policy | null
  needsAgeConfirmation: boolean
  /** UMKMall's own pages for the two policies. */
  links: { tos: string; privacy: string }
}
export type OtpFailure = {
  ok: false
  /** pos-api's status; 0 when it could not be reached. */
  status: number
  code?: string
  error?: string
  errors?: Record<string, string>
  retryAfter?: number
  consent?: ConsentAsk
}

/** pos-api limits code requests per network address: it must see the owner's, not this relay's (as device pairing). */
function deviceHeaders(): Record<string, string> {
  const forwarded = buildForwardedFor(getRequestHeader('x-forwarded-for'), getRequestIP() ?? undefined)
  return forwarded ? { 'x-forwarded-for': forwarded } : {}
}

function umkmallPage(path: string): string {
  return new URL(path, process.env.UMKMALL_WEB_URL || 'https://umkmall.id').toString()
}

async function post(path: string, body: unknown): Promise<Response | null> {
  return fetch(`${posApiUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...deviceHeaders() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000), // pos-api waits up to 10 s on UMKMall, sometimes twice
  }).catch(() => null)
}

async function failure(res: Response | null): Promise<OtpFailure> {
  if (!res) return { ok: false, status: 0 }
  const b = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const consent = b.consent as { tos?: Policy | null; privacy?: Policy | null; needsAgeConfirmation?: boolean } | undefined
  const policy = (p?: Policy | null) => (p && typeof p.id === 'string' ? { id: p.id } : null)
  const retryAfter = Number(b.retryAfterSeconds ?? res.headers.get('retry-after'))
  return {
    ok: false,
    status: res.status,
    ...(typeof b.code === 'string' && { code: b.code }),
    ...(typeof b.message === 'string' && { error: b.message }),
    ...(b.errors && typeof b.errors === 'object' ? { errors: b.errors as Record<string, string> } : {}),
    ...(retryAfter > 0 && { retryAfter }),
    ...(consent && {
      consent: {
        tos: policy(consent.tos),
        privacy: policy(consent.privacy),
        needsAgeConfirmation: consent.needsAgeConfirmation === true,
        links: { tos: umkmallPage('/syarat-ketentuan'), privacy: umkmallPage('/kebijakan-privasi') },
      },
    }),
  }
}

export const requestOtp = createServerFn({ method: 'POST' })
  .validator((d: { phone: string; consent?: Consent }) => d)
  .handler(async ({ data }): Promise<{ ok: true; otpLength: number; expiresAt: string } | OtpFailure> => {
    const res = await post('/auth/otp/request', data)
    if (!res?.ok) return failure(res)
    const { otpLength, expiresAt } = (await res.json()) as { otpLength: number; expiresAt: string }
    return { ok: true, otpLength, expiresAt }
  })

/** On success the session is stored and the answer names where to go: Keamanan after "Masuk lagi", else the home. */
export const verifyOtp = createServerFn({ method: 'POST' })
  .validator((d: { phone: string; otp: string; consent?: Consent }) => d)
  .handler(async ({ data }): Promise<{ ok: true; landing: string } | OtpFailure> => {
    const res = await post('/auth/otp/verify', data)
    if (!res?.ok) return failure(res)
    storeSession(await res.json())
    return { ok: true, landing: takeLandingPath() }
  })
