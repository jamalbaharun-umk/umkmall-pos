import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import type { CollectorCash } from './-deposit-helpers'

// Server function for the store cash page (UMK-1963, GET /store-cash, `reports.view`). Read only: pos-api writes
// every entry (a cash kasbon instalment taken outside a shift).

export type StoreCashEntry = {
  id: string
  direction: 'in' | 'out' | 'transfer'
  kind: string
  amount: number
  refId: string | null
  note: string | null
  actorId: string
  actorKind: 'owner' | 'cashier'
  actorName: string
  createdAt: string
}
export type StoreCashPage = {
  data: StoreCashEntry[]
  total: number
  page: number
  perPage: number
  /** `outstanding` / `handedOver`: of the balance, still with the collectors and already in the safe (U3). */
  summary: { cashIn: number; cashOut: number; balance: number; outstanding: number; handedOver: number }
  collectors: CollectorCash[]
}

export const loadStoreCash = createServerFn()
  .validator((page: number) => page)
  .handler(async ({ data }) => {
    const res = await api(`/store-cash?page=${data}&perPage=20`)
    if (!res.ok)
      throw new Error(res.status === 403 ? 'Anda tidak punya izin melihat kas toko.' : 'Gagal memuat kas toko.')
    return (await res.json()) as StoreCashPage
  })
