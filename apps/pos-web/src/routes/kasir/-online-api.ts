import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import type { FailureLike } from '@/lib/describe-error'
import { parsePaidSince, type PaidSincePage } from './-since'
import { paidFigures, paymentFailure, parseAwaiting, parsePayment, type AwaitingSale, type SalePayment } from './-online'
import type { SaleVoid } from './-void-api'
import { retryFailure, voidFailure, type VoidFailure } from './-void-helpers'

// Server functions of the payment-gateway cashier flow (UMK-1991). pos-api decides everything (status, who may act,
// stock, voucher); these only relay. The PIN of a refund passes through `refundSale` and is never stored or logged.

export type Fail = { ok: false; failure: FailureLike; error: string }
export type Answer<T> = { ok: true; data: T } | Fail

type Route = 'poll' | 'check' | 'cash' | 'cancel' | 'refund' | 'retry' | 'manual'

const OFFLINE = 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.'

async function call(
  route: Route,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> },
): Promise<{ ok: true; json: unknown } | Fail> {
  const res = await api(path, {
    method: init.method,
    headers: init.headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch((e: unknown) => {
    if (isRedirect(e)) throw e // the session ended: go to sign-in
    return null
  })
  if (!res) return { ok: false, failure: { status: 0 }, error: OFFLINE }
  if (res.ok) return { ok: true, json: await res.json().catch(() => null) }
  const body = await res.json().catch(() => null)
  const failure = paymentFailure(route, res.status, body)
  const message = (body as { message?: unknown } | null)?.message
  return {
    ok: false,
    failure,
    error: typeof message === 'string' && res.status !== 503 ? message : 'Aksi ini belum berhasil.',
  }
}

async function payment(route: Route, path: string, init: Parameters<typeof call>[2]): Promise<Answer<SalePayment>> {
  const r = await call(route, path, init)
  if (!r.ok) return r
  const data = parsePayment(r.json)
  return data
    ? { ok: true, data }
    : { ok: false, failure: { status: 502 }, error: 'Status pembayaran tidak bisa dibaca. Coba lagi.' }
}

const enc = encodeURIComponent

/** The poll (every 3 s): payment-api's stored status; pos-api completes or cancels the sale when it has settled. */
export const getSalePayment = createServerFn()
  .validator((id: string) => id)
  .handler(({ data }) => payment('poll', `/sales/${enc(data)}/payment`, { method: 'GET' }))

/** What the completed sale recorded: the cash handed over and the change (`GET /sales/:id/receipt`), never worked out here. */
export const loadPaidFigures = createServerFn()
  .validator((id: string) => id)
  .handler(async ({ data }): Promise<Answer<{ paid: number; change: number }>> => {
    const r = await call('poll', `/sales/${enc(data)}/receipt`, { method: 'GET' })
    if (!r.ok) return r
    const figures = paidFigures(r.json)
    return figures
      ? { ok: true, data: figures }
      : { ok: false, failure: { status: 502 }, error: 'Rincian pembayaran tidak bisa dibaca.' }
  })

/** "Cek status": payment-api asks the PG (at most once per 5 s per payment). */
export const checkSalePayment = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data }) => payment('check', `/sales/${enc(data)}/payment/check`, { method: 'POST' }))

/** "Ganti ke tunai": the bill is closed and the sale is paid as cash. Repeating it answers the same. */
export const paySaleInCash = createServerFn({ method: 'POST' })
  .validator((d: { id: string; paid: number }) => d)
  .handler(({ data }) =>
    payment('cash', `/sales/${enc(data.id)}/payment/cash`, { method: 'POST', body: { paid: data.paid } }),
  )

/** "Batalkan": no PIN, not a void. */
export const cancelSalePayment = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data }) => payment('cancel', `/sales/${enc(data)}/payment/cancel`, { method: 'POST' }))

type RefundInput = {
  saleId: string
  /** One per attempt; the same key replays the first result instead of refunding twice. */
  key: string
  reasonCode: string
  note?: string
  approverId: string
  pin: string
}
export type RefundAnswer = { ok: true; saleVoid: SaleVoid } | { ok: false; failure: VoidFailure; code?: string }

/**
 * The refund of a paid QRIS or VA sale: the void's body, approver and PIN, answered with the void's own failure kinds
 * (wrong PIN on the field, a locked approver, 409 `use_void` on a sale that was not paid online).
 */
export const refundSale = createServerFn({ method: 'POST' })
  .validator((d: RefundInput) => d)
  .handler(async ({ data: { saleId, key, ...body } }): Promise<RefundAnswer> => {
    const res = await api(`/sales/${enc(saleId)}/refund`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'idempotency-key': key },
    }).catch((e: unknown) => {
      if (isRedirect(e)) throw e
      return null
    })
    if (!res) return { ok: false, failure: voidFailure(0, null) }
    if (res.ok) return { ok: true, saleVoid: (await res.json()) as SaleVoid }
    const json = (await res.json().catch(() => null)) as { code?: unknown } | null
    const code = typeof json?.code === 'string' && /^[a-z][a-z_]{1,39}$/.test(json.code) ? json.code : undefined
    return { ok: false, failure: voidFailure(res.status, json), code }
  })

export type RetryAnswer = { ok: true; saleVoid: SaleVoid } | { ok: false; failure: VoidFailure; code?: string }

/**
 * Asks a refused refund again (UMK-2040): the owner only, approved by `approverId`'s PIN (a `sales.void` holder), with
 * the void's lockout. The PIN passes through and is never stored or logged. Answered with the void's failure kinds.
 */
export const retryRefund = createServerFn({ method: 'POST' })
  .validator((d: { saleId: string; approverId: string; pin: string }) => d)
  .handler(async ({ data: { saleId, ...body } }): Promise<RetryAnswer> => {
    const res = await api(`/sales/${enc(saleId)}/refund/retry`, { method: 'POST', body: JSON.stringify(body) }).catch(
      (e: unknown) => {
        if (isRedirect(e)) throw e
        return null
      },
    )
    if (!res) return { ok: false, failure: retryFailure(0, null) }
    if (res.ok) return { ok: true, saleVoid: (await res.json()) as SaleVoid }
    const json = (await res.json().catch(() => null)) as { code?: unknown } | null
    // no usable answer from payment-api: the request may have reached it, so "nothing changed" would be wrong
    const code =
      res.status === 503
        ? 'payment_unclear'
        : typeof json?.code === 'string' && /^[a-z][a-z_]{1,39}$/.test(json.code)
          ? json.code
          : undefined
    return { ok: false, failure: retryFailure(res.status, json), code }
  })

/** "Dikembalikan manual": the owner only; the note says how the money went back. */
export const markRefundManual = createServerFn({ method: 'POST' })
  .validator((d: { saleId: string; note: string }) => d)
  .handler(async ({ data }): Promise<Answer<SaleVoid>> => {
    const r = await call('manual', `/sales/${enc(data.saleId)}/refund/manual`, {
      method: 'POST',
      body: { note: data.note },
    })
    return r.ok ? { ok: true, data: r.json as SaleVoid } : r
  })

/** The sales that wait for a payment (the actor's own, or all with `sales.void`): `GET /sales?status=awaiting_payment`. */
export const loadAwaitingSales = createServerFn().handler(async (): Promise<Answer<AwaitingSale[]>> => {
  const r = await call('poll', '/sales?status=awaiting_payment&perPage=50', { method: 'GET' })
  if (!r.ok) return r
  return { ok: true, data: parseAwaiting((r.json as { data?: unknown } | null)?.data) }
})

/** What became of the actor's waiting sales after `since` (`GET /sales/paid-since`, one page; the screen pages while `hasMore`). */
export const loadPaidSince = createServerFn()
  .validator((d: { since: string; afterId: string | null }) => d)
  .handler(async ({ data }): Promise<Answer<PaidSincePage>> => {
    const q = `since=${enc(data.since)}${data.afterId ? `&afterId=${enc(data.afterId)}` : ''}`
    const r = await call('poll', `/sales/paid-since?${q}`, { method: 'GET' })
    if (!r.ok) return r
    const page = parsePaidSince(r.json)
    return page ? { ok: true, data: page } : { ok: false, failure: { status: 502 }, error: 'Kabar penjualan tidak bisa dibaca.' }
  })

export type OwnPin = { hasPin: boolean; lockedUntil: string | null }

/** The signed-in actor's own void-PIN state (`GET /void-pin`): is there a PIN, and is it locked. null when it cannot be read. */
export const loadOwnPin = createServerFn().handler(async (): Promise<OwnPin | null> => {
  const r = await call('poll', '/void-pin', { method: 'GET' })
  if (!r.ok) return null
  const o = r.json as { hasPin?: unknown; lockedUntil?: unknown } | null
  return o && typeof o.hasPin === 'boolean' ? { hasPin: o.hasPin, lockedUntil: typeof o.lockedUntil === 'string' ? o.lockedUntil : null } : null
})
