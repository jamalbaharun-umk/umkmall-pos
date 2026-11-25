import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import type { Shift } from './-api'
import type { LedgerEntry } from './-shift-helpers'

// Server functions for the shift history and the cash ledger screens (UMK-1963). pos-api computes every figure.

export type ShiftRow = Shift
export type ShiftDetail = Shift & { cashEntries: LedgerEntry[] }
export type ShiftPage = { data: ShiftRow[]; total: number }

async function load<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error(res.status === 404 ? 'Shift tidak ditemukan.' : 'Gagal memuat data shift.')
  return (await res.json()) as T
}

/** One page of shifts: the actor's own, or the store's for `reports.view` (pos-api scopes it). */
export const loadShifts = createServerFn()
  .validator((page: number) => page)
  .handler(({ data }) => load<ShiftPage>(`/shifts?page=${data}&perPage=20`))

/** One shift with its cash in/out entries (pos-api: 404 for a shift the actor may not see). */
export const loadShift = createServerFn()
  .validator((id: string) => id)
  .handler(({ data }) => load<ShiftDetail>(`/shifts/${encodeURIComponent(data)}`))

/**
 * The actor's open shift, or null. Staff without `sales.create` cannot open a shift and pos-api answers 403
 * for them: that is "no shift", not an error (a collector still pays a kasbon, outside a shift).
 */
export const loadOpenShiftOrNone = createServerFn().handler(async () => {
  const res = await api('/shifts/current')
  if (res.status === 403) return { shift: null as Shift | null }
  if (!res.ok) throw new Error('Gagal memuat shift.')
  return (await res.json()) as { shift: Shift | null }
})
