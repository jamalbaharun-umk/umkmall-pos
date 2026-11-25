import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'

import { refusalOf } from '@/lib/refusal'
import type { Failure } from '../kasir/-cash-helpers'
import type { DepositRow } from './-deposit-helpers'

// Server functions for the collector deposit screens (UMK-1924 U3, UMK-1963). pos-api checks every rule (the
// receiver is not the collector, the amount is within what the collector holds, one deposit per Idempotency-Key).

export type DepositResult = { ok: true; data: DepositRow } | ({ ok: false } & Failure)
export type DepositPage = { data: DepositRow[]; total: number; page: number; perPage: number }

export const loadDeposits = createServerFn()
  .validator((page: number) => page)
  .handler(async ({ data }) => {
    const res = await api(`/store-cash/deposits?page=${data}&perPage=20`)
    if (!res.ok)
      throw new Error(res.status === 403 ? 'Anda tidak punya izin melihat setoran.' : 'Gagal memuat riwayat setoran.')
    return (await res.json()) as DepositPage
  })

export type NewDeposit = { collectorId: string; amount: number; note?: string }

// `key` is made once per submit attempt, so a double tap or a retry after a lost answer records one deposit.
export const createDeposit = createServerFn({ method: 'POST' })
  .validator((d: { key: string; body: NewDeposit }) => d)
  .handler(async ({ data }): Promise<DepositResult> => {
    const res = await api('/store-cash/deposits', {
      method: 'POST',
      body: JSON.stringify(data.body),
      headers: { 'idempotency-key': data.key },
    }).catch((e: unknown) => {
      if (isRedirect(e)) throw e // session ended: go to sign-in
      return null
    })
    if (!res) return { ok: false, status: 0, error: '' }
    if (res.ok) return { ok: true, data: (await res.json()) as DepositRow }
    const r = await refusalOf(res)
    return { ok: false, status: res.status, error: r.error, errors: r.errors }
  })
