import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { refusalOf } from '@/lib/refusal'
import type { Receipt } from './-api'
import { needsRefundFollow, voidFailure, type Approver, type MethodKind, type VoidFailure } from './-void-helpers'

// Server functions for the void of a sale (UMK-1962). pos-api decides everything; these only relay. The PIN passes
// through `voidSale` and is never stored, logged or echoed.

export type SaleVoid = {
  id: string
  saleId: string
  saleNumber: number
  status: 'void'
  reasonCode: string
  note: string | null
  createdAt: string
  cashReturned: number
  transferReturned: number
  receivableCancelled: number
  total: number
  rounding: number
  initiatedBy: { id: string; kind: 'owner' | 'cashier'; name: string }
  approvedBy: { id: string; kind: 'owner' | 'cashier'; name: string }
  returns: { amount: number; paymentMethod: string; fromDrawer: boolean }[]
  /** UMK-1991: null for a plain void; for a refund of a QRIS or VA sale, where the gateway's refund stands. */
  refundStatus?: 'pending' | 'succeeded' | 'failed' | null
}

export type SaleDetail = {
  receipt: Receipt
  /** Set when the sale is void and the actor may see its void. */
  saleVoid: SaleVoid | null
  /** The kind of the sale's payment method, for the refund guidance; null when it cannot be told. */
  methodKind: MethodKind | null
  /** UMK-1991: from `GET /sales/:id`, when the actor may read it: the sale was paid through a gateway, and when it counts. */
  online: boolean
  paidAt: string | null
}

async function read<T>(path: string): Promise<T | null> {
  const res = await api(path).catch(() => null)
  return res?.ok ? ((await res.json().catch(() => null)) as T | null) : null
}

/** The sale detail: the receipt (must load), its void when voided, and the method kind while it can still be voided. */
export const loadSaleDetail = createServerFn()
  .validator((id: string) => id)
  .handler(async ({ data }): Promise<SaleDetail> => {
    const id = encodeURIComponent(data)
    const res = await api(`/sales/${id}/receipt`)
    if (!res.ok) throw new Error((await refusalOf(res)).error)
    const receipt = (await res.json()) as Receipt
    const [firstVoid, methods, meta] = await Promise.all([
      receipt.status === 'void' ? read<SaleVoid>(`/sales/${id}/void`) : null,
      receipt.status === 'completed' ? read<{ data: { name: string; kind: MethodKind }[] }>('/payment-methods') : null,
      read<{ onlinePayment?: boolean; paidAt?: string | null }>(`/sales/${id}`),
    ])
    // The stored refund status is old until pos-api asks the gateway; reading the sale's payment does that, so a
    // pending refund is followed here (best effort, a failure leaves the stored status) and the void read again.
    let saleVoid = firstVoid
    if (needsRefundFollow(saleVoid)) {
      await api(`/sales/${id}/payment`).catch(() => null)
      saleVoid = (await read<SaleVoid>(`/sales/${id}/void`)) ?? saleVoid
    }
    const online = meta?.onlinePayment === true
    // A paid QRIS or VA sale is refunded by the gateway, so its kind is `online` whatever its method is called.
    const methodKind = online ? 'online' : (methods?.data.find((m) => m.name === receipt.paymentMethod)?.kind ?? null)
    return { receipt, saleVoid, methodKind, online, paidAt: typeof meta?.paidAt === 'string' ? meta.paidAt : null }
  })

export type ApproversAnswer = { ok: true; approvers: Approver[] } | { ok: false; error: string }

/** Who can approve a void here (name, has a PIN, locked until). Never a PIN or a hash. */
export const loadApprovers = createServerFn().handler(async (): Promise<ApproversAnswer> => {
  const res = await api('/void-pin/approvers').catch(() => null)
  if (!res) return { ok: false, error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }
  if (!res.ok) return { ok: false, error: (await refusalOf(res)).error }
  return { ok: true, approvers: (await res.json()) as Approver[] }
})

type VoidInput = {
  saleId: string
  /** One per attempt; the same key replays the first result instead of voiding twice. */
  key: string
  reasonCode: string
  note?: string
  approverId: string
  pin: string
}
export type VoidAnswer = { ok: true; saleVoid: SaleVoid } | { ok: false; failure: VoidFailure }

export const voidSale = createServerFn({ method: 'POST' })
  .validator((d: VoidInput) => d)
  .handler(async ({ data: { saleId, key, ...body } }): Promise<VoidAnswer> => {
    const res = await api(`/sales/${encodeURIComponent(saleId)}/void`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'idempotency-key': key },
    }).catch(() => null)
    if (!res) return { ok: false, failure: voidFailure(0, null) }
    if (!res.ok) return { ok: false, failure: voidFailure(res.status, await res.json().catch(() => null)) }
    return { ok: true, saleVoid: (await res.json()) as SaleVoid }
  })
