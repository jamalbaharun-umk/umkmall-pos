import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { GENERIC_ERROR } from '@/lib/refusal'
import { draftBody, type DraftForm, type MerchantAccount } from '@/lib/online-payments'

// Server functions of "Pembayaran Online" (UMK-2020). They only relay pos-api's /online-payments routes, which are
// owner-only (payments.manage) and answer payment-api's account without any secret. pos-api's refusal keeps its
// status and stable `code` (409, 422, 503 carry Indonesian text of its own); a body that is not that shape is generic.

export type OnlineFailure = {
  ok: false
  error: string
  status: number
  code?: string
  errors?: Record<string, string>
}
export type OnlineResult<T = void> = ({ ok: true } & (T extends void ? object : { data: T })) | OnlineFailure

export type OnlineList = { enabled: boolean; mode: string | null; accounts: MerchantAccount[] }

async function refusal(res: Response): Promise<OnlineFailure> {
  const body = (await res.json().catch(() => ({}))) as { message?: unknown; code?: unknown; errors?: unknown }
  return {
    ok: false,
    status: res.status,
    // 5xx other than 503 carry no usable text; 503 is pos-api's own "payment service unreachable" sentence.
    error: typeof body.message === 'string' && (res.status < 500 || res.status === 503) ? body.message : GENERIC_ERROR,
    ...(typeof body.code === 'string' ? { code: body.code } : {}),
    ...(body.errors && typeof body.errors === 'object' ? { errors: body.errors as Record<string, string> } : {}),
  }
}

async function call<T>(path: string, method: string, body?: unknown): Promise<OnlineResult<T>> {
  const res = await api(`/online-payments${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!res.ok) return refusal(res)
  const data = (await res.json().catch(() => ({}))) as T
  return { ok: true, data } as OnlineResult<T>
}

/** The page's data. A failure throws: the route's error state offers "Muat ulang". */
export const loadOnlinePayments = createServerFn().handler(async (): Promise<OnlineList> => {
  const res = await call<OnlineList>('', 'GET')
  if (!res.ok) throw new Error(res.status === 403 ? 'Anda tidak punya izin untuk ini' : res.error)
  return res.data
})

export const saveOnlineDraft = createServerFn({ method: 'POST' })
  .validator((d: { provider: string; form: DraftForm }) => d)
  .handler(({ data }) =>
    call<MerchantAccount>(`/${encodeURIComponent(data.provider)}/draft`, 'PUT', draftBody(data.form)),
  )

export const submitOnline = createServerFn({ method: 'POST' })
  .validator((provider: string) => provider)
  .handler(({ data }) => call<MerchantAccount>(`/${encodeURIComponent(data)}/submit`, 'POST', { termsAccepted: true }))

export const syncOnline = createServerFn({ method: 'POST' })
  .validator((provider: string) => provider)
  .handler(({ data }) => call<MerchantAccount>(`/${encodeURIComponent(data)}/sync`, 'POST'))

export const verificationLink = createServerFn({ method: 'POST' })
  .validator((provider: string) => provider)
  .handler(({ data }) => call<{ url: string; expiresAt: string | null }>(`/${encodeURIComponent(data)}/verification-link`, 'POST'))

export const setOnlineMethod = createServerFn({ method: 'POST' })
  .validator((d: { provider: string; method: string; enabled: boolean }) => d)
  .handler(({ data }) =>
    call<MerchantAccount>(
      `/${encodeURIComponent(data.provider)}/methods/${encodeURIComponent(data.method)}`,
      'PUT',
      { enabled: data.enabled },
    ),
  )
