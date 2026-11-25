import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'

// Server functions for the U7 screens (pelanggan, voucher, metode pembayaran, piutang). pos-api validates and
// computes every amount; these only relay. Mutations return a Result instead of throwing, for forms.

export type Member = { id: string; name: string; code: string; phone: string | null; address: string | null }
export type PaymentKind = 'cash' | 'debit' | 'credit' | 'wallet'
export type PaymentMethod = { id: string; name: string; kind: PaymentKind }
export type OpenShift = { id: string; openedAt: string } | null
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
  memberName: string
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
    createdAt: string
    // UMK-1963: who collected it and where the cash went (a shift's ledger, or outside every shift)
    actorName: string
    collectedOutsideShift: boolean
    shiftId: string | null
  }[]
}
/** A list row as JSON; each screen narrows it to its own type. */
type Row = Record<string, string | number | null>
export type Result = { ok: true } | { ok: false; error: string; errors?: Record<string, string> }

/** The only collections these relays reach (never a client-chosen path). */
export type Resource = 'members' | 'vouchers' | 'payment-methods'
const RESOURCES: readonly Resource[] = ['members', 'vouchers', 'payment-methods']
const resource = (r: Resource) => {
  if (!RESOURCES.includes(r)) throw new Error('Data tidak ditemukan.')
  return r
}

const ERRORS: Record<number, string> = {
  403: 'Kamu tidak punya izin untuk ini.',
  404: 'Data tidak ditemukan, mungkin sudah dihapus.',
  422: 'Data belum benar. Periksa isian kamu.',
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
  if (!res) return { ok: false, error: 'Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.' }
  if (res.ok) return { ok: true }
  const err = (await res.json().catch(() => ({}))) as { message?: unknown; errors?: unknown }
  // 409 and 422 carry a safe Indonesian message and a field map from pos-api (common/validation.ts).
  if ((res.status === 409 || res.status === 422) && typeof err.message === 'string') {
    const errors = err.errors && typeof err.errors === 'object' ? (err.errors as Record<string, string>) : undefined
    return { ok: false, error: err.message, errors }
  }
  return { ok: false, error: ERRORS[res.status] ?? 'Gagal menyimpan, coba lagi.' }
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
  const shift = body?.shift
  return typeof shift?.id === 'string' && typeof shift.openedAt === 'string'
    ? { id: shift.id, openedAt: shift.openedAt }
    : null
}

export type Paged<T> = { data: T[]; total: number; page: number; perPage: number }
export type ReceivablePage = Paged<ReceivableSummary> & { summary: { openRest: number; openCount: number; outsideShiftCollected: number } }

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
    // A kasbon is never paid with another kasbon.
    return { receivable, methods: methods.data.filter((m) => m.kind !== 'credit'), shift }
  })

// `key` is made once per payment dialog, so a double tap or a retry records one payment.
export const payReceivable = createServerFn({ method: 'POST' })
  .validator((d: { id: string; key: string; amount: number; paymentMethodId?: string }) => d)
  .handler(({ data: { id, key, ...body } }) =>
    mutate(`/receivables/${enc(id)}/payments`, 'POST', body, { 'idempotency-key': key }),
  )
