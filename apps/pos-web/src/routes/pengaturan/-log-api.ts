import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { queryOf, type LogPage, type LogSearch } from './-log-helpers'

// Server functions of "Log aktivitas" (UMK-1969). Read only: pos-api's `GET /audit-log` takes the store from the session
// and answers 403 unless the actor holds `staff.manage` (the owner). Nothing here can write or delete a log row.

export type LogFailure = { ok: false; status: number; error: string }
export type LogResult = { ok: true; page: LogPage } | LogFailure

const FAILURE: Record<number, string> = {
  403: 'Hanya pemilik toko yang bisa melihat log aktivitas.',
  422: 'Filter tidak bisa dipakai. Atur ulang filter lalu coba lagi.',
}

/** One page of the log for these filters. A failure comes back as a value, for the screen's error dialog. */
export const loadLog = createServerFn()
  .validator((d: { search: LogSearch; page: number }) => d)
  .handler(async ({ data }): Promise<LogResult> => {
    const res = await api(`/audit-log?${queryOf(data.search, data.page)}`).catch((e: unknown) => {
      if (isRedirect(e)) throw e // session ended: go to sign-in
      return null
    })
    if (!res) return { ok: false, status: 0, error: '' }
    if (!res.ok) return { ok: false, status: res.status, error: FAILURE[res.status] ?? '' }
    const body = (await res.json().catch(() => null)) as LogPage | null
    if (!body || !Array.isArray(body.data) || typeof body.total !== 'number')
      return { ok: false, status: 502, error: 'Log tidak bisa dibaca. Coba lagi sebentar lagi.' }
    return { ok: true, page: body }
  })

/** The names for the "Staf" filter; an empty list when they cannot be read (the filter then offers the owner only). */
export const loadLogStaff = createServerFn().handler(async (): Promise<{ id: string; name: string }[]> => {
  const res = await api('/staff').catch((e: unknown) => {
    if (isRedirect(e)) throw e
    return null
  })
  if (!res?.ok) return []
  const rows = (await res.json().catch(() => [])) as { id: string; name: string }[]
  return Array.isArray(rows) ? rows.map((r) => ({ id: r.id, name: r.name })) : []
})
