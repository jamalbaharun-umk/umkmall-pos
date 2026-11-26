import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { refusalOf, type Refusal } from '@/lib/refusal'
import type { Approver } from './-void-helpers'

// Server functions of a line discount above 30% (UMK-1990). pos-api checks the PIN and keeps the approval; the PIN
// only passes through `approveDiscount` and is never stored, logged or echoed. The sale names the approval's id.

const OFFLINE = 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.'

export type DiscountApproversAnswer = { ok: true; approvers: Approver[] } | { ok: false; error: string }

/** Who may approve a large discount: the owner and staff holding the discount permission (name, PIN, lock). */
export const loadDiscountApprovers = createServerFn().handler(async (): Promise<DiscountApproversAnswer> => {
  const res = await api('/sales/discount-approvers').catch(() => null)
  if (!res) return { ok: false, error: OFFLINE }
  if (!res.ok) return { ok: false, error: (await refusalOf(res)).error }
  return { ok: true, approvers: (await res.json()) as Approver[] }
})

export type DiscountApproval = { id: string; maxBps: number; expiresAt: string; approver: { id: string; name: string } }
export type ApproveAnswer = { ok: true; approval: DiscountApproval } | ({ ok: false } & Refusal)

type ApproveInput = { approverId: string; pin: string; productId: string; maxBps: number }

export const approveDiscount = createServerFn({ method: 'POST' })
  .validator((d: ApproveInput) => d)
  .handler(async ({ data }): Promise<ApproveAnswer> => {
    const res = await api('/sales/discount-approvals', { method: 'POST', body: JSON.stringify(data) }).catch(() => null)
    if (!res) return { ok: false, status: 0, error: OFFLINE }
    if (!res.ok) return { ok: false, ...(await refusalOf(res)) }
    return { ok: true, approval: (await res.json()) as DiscountApproval }
  })
