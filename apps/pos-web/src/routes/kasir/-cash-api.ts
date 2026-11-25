import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'

import { refusalOf } from '@/lib/refusal'
import type { Shift } from './-api'
import type { CashDirection, CashEntryRow, CashReasons, Failure } from './-cash-helpers'

// Server functions for the drawer cash screen (UMK-1924 U3, UMK-1963): the open shift, the reason lists, the
// shift's entries and the create call. pos-api checks every rule (open shift, the drawer limit, Lainnya's note).

export type CashResult<T> = { ok: true; data: T } | ({ ok: false } & Failure)

export type CashEntry = {
  id: string
  shiftId: string
  direction: CashDirection
  reason: string
  reasonLabel: string
  amount: number
  note: string | null
  drawerCashBefore: number
  drawerCashAfter: number
  actorName: string
  createdAt: string
}

export type DrawerPage = {
  shift: (Shift & { expectedCash: number }) | null
  reasons: CashReasons
  entries: CashEntryRow[]
}

async function read<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error(res.status === 403 ? 'Anda tidak punya izin untuk kas laci.' : 'Gagal memuat kas laci.')
  return (await res.json()) as T
}

/** The actor's open shift with its drawer cash, the reason pick-lists and the shift's entries. */
export const loadCashDrawer = createServerFn().handler(async (): Promise<DrawerPage> => {
  const [{ shift }, reasons] = await Promise.all([
    read<{ shift: (Shift & { expectedCash: number }) | null }>('/shifts/current'),
    read<CashReasons>('/shifts/cash-entry-reasons'),
  ])
  if (!shift) return { shift: null, reasons, entries: [] }
  const detail = await read<{ cashEntries: CashEntryRow[] }>(`/shifts/${encodeURIComponent(shift.id)}`)
  return { shift, reasons, entries: detail.cashEntries }
})

export type NewCashEntry = { direction: CashDirection; amount: number; reason: string; note?: string }

// `key` is made once per submit attempt, so a double tap or a retry after a lost answer records one entry.
export const createCashEntry = createServerFn({ method: 'POST' })
  .validator((d: { key: string; body: NewCashEntry }) => d)
  .handler(async ({ data }): Promise<CashResult<CashEntry>> => {
    const res = await api('/shifts/current/cash-entries', {
      method: 'POST',
      body: JSON.stringify(data.body),
      headers: { 'idempotency-key': data.key },
    }).catch((e: unknown) => {
      if (isRedirect(e)) throw e // session ended: go to sign-in
      return null
    })
    if (!res) return { ok: false, status: 0, error: '' }
    if (res.ok) return { ok: true, data: (await res.json()) as CashEntry }
    const r = await refusalOf(res)
    return { ok: false, status: res.status, error: r.error, errors: r.errors }
  })
