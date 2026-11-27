import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { api, trySetStatus } from '@/lib/api.server'
import { refusalOf } from '@/lib/refusal'
import type { ApproversAnswer } from '../kasir/-void-api'
import type { Approver } from '../kasir/-void-helpers'
import { CORRECTION_NOTE_MAX, CORRECTION_REASONS } from '../piutang/-correction'

// Server functions for the U7 screens (pelanggan, voucher, metode pembayaran, piutang). pos-api validates and
// computes every amount; these only relay. Mutations return a Result instead of throwing, for forms.

export type Member = { id: string; name: string; code: string; phone: string | null; address: string | null }
export type PaymentKind = 'cash' | 'debit' | 'credit' | 'wallet' | 'online'
/** `gatewayMethod` (UMK-1991): payment-api's method of an `online` method (fake_qris, fake_va); null otherwise. */
export type PaymentMethod = { id: string; name: string; kind: PaymentKind; gatewayMethod?: string | null }
/** `number` (the store's shift number) when pos-api sent it. */
export type OpenShift = { id: string; openedAt: string; number?: number } | null
export type Voucher = {
  id: string
  name: string
  code: string
  type: 'percentage' | 'flat'
  nominal: number
  kuota: number
  startDate: string
  expired: string
  minimalBuying: number
}
export type ReceivableSummary = {
  id: string
  saleId: string
  saleNumber: number
  memberId: string
  memberName: string
  /** UMK-1973: when the customer was last reminded (a date, never the message), and how late an open balance is. */
  memberLastRemindedAt: string | null
  /** A deleted customer is not reminded. */
  memberDeleted: boolean
  overdueDays: number
  total: number
  rest: number
  dueDate: string
  lastPaymentAt: string | null
  createdAt: string
  /** UMK-1963: cash instalments taken without an open shift (in the store cash, in no shift). */
  outsideShiftCollected: number
}
export type Receivable = ReceivableSummary & {
  lines: { name: string; qty: number; unitPrice: number; lineTotal: number }[]
  payments: {
    id: string
    amount: number
    restBefore: number
    paymentMethod: string
    paymentMethodId: string
    createdAt: string
    // UMK-1963: who collected it and where the cash went (a shift's ledger, or outside every shift)
    actorName: string
    collectedOutsideShift: boolean
    shiftId: string | null
    // UMK-1971 (koreksi): the row's state, whether it may be corrected, and the correction's links.
    status?: 'active' | 'reversed' | 'reversal'
    correctable?: boolean
    shiftClosed?: boolean
    isCash?: boolean
    downPayment?: boolean
    reversesId?: string | null
    replacesId?: string | null
    reversedById?: string | null
    /** A closed shift's cash reversal, given back from the store cash. */
    viaStoreCash?: boolean
    reasonCode?: string | null
    note?: string | null
  }[]
  cancelledAt?: string | null
}
/** A list row as JSON; each screen narrows it to its own type. */
type Row = Record<string, string | number | null>
export type Result = { ok: true } | { ok: false; error: string; errors?: Record<string, string>; status?: number }

/** The only collections these relays reach (never a client-chosen path). */
export type Resource = 'members' | 'vouchers' | 'payment-methods'
const RESOURCES: readonly Resource[] = ['members', 'vouchers', 'payment-methods']
const resource = (r: Resource) => {
  if (!RESOURCES.includes(r)) throw new Error('Data tidak ditemukan.')
  return r
}

const ERRORS: Record<number, string> = {
  403: 'Anda tidak punya izin untuk ini.',
  404: 'Data tidak ditemukan, mungkin sudah dihapus.',
  422: 'Data belum benar. Periksa isian Anda.',
}

async function load<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error(ERRORS[res.status] ?? 'Gagal memuat data.')
  return (await res.json()) as T
}

async function mutate(path: string, method: string, body?: unknown, headers?: Record<string, string>): Promise<Result> {
  const res = await api(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).catch(
    (e: unknown) => {
      if (isRedirect(e)) throw e // session ended: go to sign-in
      return null
    },
  )
  // pos-api unreachable: nothing was saved; a payment retry reuses its Idempotency-Key.
  if (!res) return { ok: false, status: 0, error: 'Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.' }
  if (res.ok) return { ok: true }
  const err = (await res.json().catch(() => ({}))) as { message?: unknown; errors?: unknown }
  // 409 and 422 carry a safe Indonesian message and a field map from pos-api (common/validation.ts).
  if ((res.status === 409 || res.status === 422) && typeof err.message === 'string') {
    const errors = err.errors && typeof err.errors === 'object' ? (err.errors as Record<string, string>) : undefined
    return { ok: false, status: res.status, error: err.message, errors }
  }
  return { ok: false, status: res.status, error: ERRORS[res.status] ?? 'Gagal menyimpan, coba lagi.' }
}

const enc = encodeURIComponent

/**
 * The actor's open shift. Staff without `sales.create` cannot open one and pos-api answers 403: that is "no shift",
 * not an error (they collect a cash kasbon outside a shift). Any other failure is treated as unknown (null) and
 * pos-api still decides on the payment.
 */
async function openShiftOf(): Promise<OpenShift> {
  const res = await api('/shifts/current').catch((e: unknown) => {
    if (isRedirect(e)) throw e // session ended: go to sign-in
    return null
  })
  if (!res?.ok) return null
  const body = (await res.json().catch(() => null)) as { shift?: { id?: unknown; openedAt?: unknown } | null } | null
  const shift = body?.shift as { id?: unknown; openedAt?: unknown; number?: unknown } | null | undefined
  return typeof shift?.id === 'string' && typeof shift.openedAt === 'string'
    ? { id: shift.id, openedAt: shift.openedAt, ...(Number.isInteger(shift.number) ? { number: shift.number as number } : {}) }
    : null
}

export type Paged<T> = { data: T[]; total: number; page: number; perPage: number }
export type ReceivablePage = Paged<ReceivableSummary> & { summary: { openRest: number; openCount: number; outsideShiftCollected: number; overdueMemberIds: string[] } }

const query = (params: Record<string, string | number | undefined>) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const s = qs.toString()
  return s ? `?${s}` : ''
}

/** One page of members (GET /members: search name/code/phone, 20 per page). */
export const loadMembers = createServerFn()
  .validator((d: { q?: string; page?: number }) => d)
  .handler(({ data }) => load<Paged<Member>>(`/members${query({ q: data.q, page: data.page })}`))

export const listResource = createServerFn()
  .validator((d: { resource: Resource; q?: string }) => d)
  .handler(async ({ data }) => {
    const q = data.q ? `?q=${enc(data.q)}` : ''
    return (await load<{ data: Row[] }>(`/${resource(data.resource)}${q}`)).data
  })

export const saveResource = createServerFn({ method: 'POST' })
  .validator((d: { resource: Resource; id?: string; body: Record<string, unknown> }) => d)
  .handler(({ data }) =>
    data.id
      ? mutate(`/${resource(data.resource)}/${enc(data.id)}`, 'PATCH', data.body)
      : mutate(`/${resource(data.resource)}`, 'POST', data.body),
  )

export const removeResource = createServerFn({ method: 'POST' })
  .validator((d: { resource: Resource; id: string }) => d)
  .handler(({ data }) => mutate(`/${resource(data.resource)}/${enc(data.id)}`, 'DELETE'))

/** One page of receivables with the outstanding summary (GET /receivables: member name or sale number). */
export const loadReceivables = createServerFn()
  .validator((d: { status?: 'open' | 'settled'; q?: string; page?: number }) => d)
  .handler(({ data }) => load<ReceivablePage>(`/receivables${query({ status: data.status, q: data.q, page: data.page })}`))

export const loadReceivable = createServerFn()
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const [receivable, methods, shift] = await Promise.all([
      load<Receivable>(`/receivables/${enc(data)}`),
      load<{ data: PaymentMethod[] }>('/payment-methods'),
      openShiftOf(),
    ])
    // The receivable itself was readable. A part this role may not read (the open shift needs a sales permission)
    // sets its 403 on the page response; the page renders without it, so it answers 200.
    trySetStatus(200)
    // A kasbon is never paid with another kasbon, and an instalment is never charged at a payment gateway (UMK-1991).
    return { receivable, methods: methods.data.filter((m) => m.kind !== 'credit' && m.kind !== 'online'), shift }
  })

// `key` is made once per payment dialog, so a double tap or a retry records one payment.
export const payReceivable = createServerFn({ method: 'POST' })
  .validator((d: { id: string; key: string; amount: number; paymentMethodId?: string }) => d)
  .handler(({ data: { id, key, ...body } }) =>
    mutate(`/receivables/${enc(id)}/payments`, 'POST', body, { 'idempotency-key': key }),
  )

export type Correction = {
  id: string
  paymentId: string
  oldAmount: number
  newAmount: number | null
  newPaymentId: string | null
  reasonCode: string
  restAfter: number
  createdAt: string
}
export type CorrectionResult =
  | { ok: true; correction: Correction }
  | { ok: false; status: number; error: string; errors?: Record<string, string>; code?: string; retryAfter?: number }

/**
 * What the correction dialog may send, checked at this server boundary before it is relayed (pos-api checks it all
 * again and decides). Shape only: the PIN's own rule and every refusal stay pos-api's, so their words reach the form.
 */
const CorrectionInput = z
  .object({
    id: z.string().uuid(),
    paymentId: z.string().uuid(),
    /** One per opened dialog: a double tap or a retry after a lost answer makes one correction. */
    key: z.string().min(1).max(100),
    replacement: z
      .object({
        amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        paymentMethodId: z.string().uuid().optional(),
      })
      .strict()
      .nullable(),
    reasonCode: z.enum(CORRECTION_REASONS.map((r) => r.code) as [string, ...string[]]),
    note: z.string().max(CORRECTION_NOTE_MAX).optional(),
    approverId: z.string().uuid(),
    pin: z.string().max(20),
  })
  .strict()
type CorrectionInput = z.infer<typeof CorrectionInput>

/**
 * Who may approve a kasbon correction by PIN: never the asking staff member (a second person approves; the owner
 * sees themself). Never a PIN or a hash.
 */
export const loadCorrectionApprovers = createServerFn().handler(async (): Promise<ApproversAnswer> => {
  const res = await api('/receivables/correction-approvers').catch((e: unknown) => {
    if (isRedirect(e)) throw e // session ended: go to sign-in
    return null
  })
  if (!res) return { ok: false, error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }
  if (!res.ok) return { ok: false, error: (await refusalOf(res)).error }
  return { ok: true, approvers: (await res.json()) as Approver[] }
})

/**
 * "Koreksi pembayaran" (UMK-1971): pos-api writes a reversal line and, unless `replacement` is null, the new payment.
 * The PIN passes through to pos-api and is never stored, logged or echoed.
 */
export const correctPayment = createServerFn({ method: 'POST' })
  .validator((d: CorrectionInput) => CorrectionInput.parse(d))
  .handler(async ({ data: { id, paymentId, key, ...body } }): Promise<CorrectionResult> => {
    const res = await api(`/receivables/${enc(id)}/payments/${enc(paymentId)}/correction`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'idempotency-key': key },
    }).catch((e: unknown) => {
      if (isRedirect(e)) throw e // session ended: go to sign-in
      return null
    })
    if (!res) return { ok: false, status: 0, error: 'Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.' }
    if (res.ok) return { ok: true, correction: ((await res.json()) as { correction: Correction }).correction }
    const err = (await res.json().catch(() => ({}))) as { message?: unknown; errors?: unknown; code?: unknown; retryAfter?: unknown }
    const errors = err.errors && typeof err.errors === 'object' ? (err.errors as Record<string, string>) : undefined
    const code = typeof err.code === 'string' && /^[A-Z_]{3,40}$/.test(err.code) ? err.code : undefined
    const retryAfter = typeof err.retryAfter === 'number' ? err.retryAfter : undefined
    if ((res.status === 409 || res.status === 422 || res.status === 429) && typeof err.message === 'string')
      return { ok: false, status: res.status, error: err.message, errors, code, retryAfter }
    return { ok: false, status: res.status, error: ERRORS[res.status] ?? 'Gagal menyimpan, coba lagi.' }
  })
