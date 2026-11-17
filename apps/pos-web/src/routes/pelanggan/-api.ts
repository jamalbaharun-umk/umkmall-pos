import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'

// Server functions for the U7 screens (pelanggan, voucher, metode pembayaran, piutang). pos-api validates and
// computes every amount; these only relay. Mutations return a Result instead of throwing, for forms.

export type Member = { id: string; name: string; code: string; phone: string | null; address: string | null }
export type PaymentKind = 'cash' | 'debit' | 'credit' | 'wallet'
export type PaymentMethod = { id: string; name: string; kind: PaymentKind }
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
}
export type Receivable = ReceivableSummary & {
  lines: { name: string; qty: number; unitPrice: number; lineTotal: number }[]
  payments: { id: string; amount: number; restBefore: number; paymentMethod: string; createdAt: string }[]
}
/** A list row as JSON; each screen narrows it to its own type. */
type Row = Record<string, string | number | null>
export type Result = { ok: true } | { ok: false; error: string }

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

async function mutate(path: string, method: string, body?: unknown): Promise<Result> {
  const res = await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  if (res.ok) return { ok: true }
  const err = (await res.json().catch(() => ({}))) as { message?: unknown }
  // 409 and business 422s (voucher, kasbon, Tunai) carry a safe Indonesian message from pos-api.
  if (
    (res.status === 409 || res.status === 422) &&
    typeof err.message === 'string' &&
    err.message !== 'Data tidak valid'
  )
    return { ok: false, error: err.message }
  return { ok: false, error: ERRORS[res.status] ?? 'Gagal menyimpan, coba lagi.' }
}

const enc = encodeURIComponent

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

export const loadReceivables = createServerFn()
  .validator((status?: 'open' | 'settled') => status)
  .handler(
    async ({ data }) =>
      (await load<{ data: ReceivableSummary[] }>(`/receivables${data ? `?status=${enc(data)}` : ''}`)).data,
  )

export const loadReceivable = createServerFn()
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const [receivable, methods] = await Promise.all([
      load<Receivable>(`/receivables/${enc(data)}`),
      load<{ data: PaymentMethod[] }>('/payment-methods'),
    ])
    // A kasbon is never paid with another kasbon.
    return { receivable, methods: methods.data.filter((m) => m.kind !== 'credit') }
  })

export const payReceivable = createServerFn({ method: 'POST' })
  .validator((d: { id: string; amount: number; paymentMethodId?: string }) => d)
  .handler(({ data: { id, ...body } }) => mutate(`/receivables/${enc(id)}/payments`, 'POST', body))
