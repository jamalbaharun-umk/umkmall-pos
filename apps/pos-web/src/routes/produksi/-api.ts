import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import type { RecipeSummary } from '../resep/-recipe'
import { listQuery, runRefusal, type ListSearch, type Plan, type Run, type RunPage, type RunPayload, type RunRefusal } from './-run'

// Server functions of the production screens (UMK-2132). pos-api computes every quantity and cost; these only relay.
// A mutation or the plan read returns a Result instead of throwing, so the form can show the toast or the error dialog.

export type Result<T> = { ok: true; data: T } | ({ ok: false } & RunRefusal)

const enc = encodeURIComponent
const OFFLINE = 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.'
const LOAD_ERRORS: Record<number, string> = {
  403: 'Anda tidak punya izin untuk ini.',
  404: 'Produksi tidak ditemukan.',
}

async function load<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error(LOAD_ERRORS[res.status] ?? 'Gagal memuat data produksi.')
  return (await res.json()) as T
}

async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  const res = await api(path, init).catch((e: unknown) => {
    if (isRedirect(e)) throw e // session ended: go to sign-in
    return null
  })
  if (!res) return { ok: false, error: OFFLINE, status: 0 }
  if (res.ok) return { ok: true, data: (await res.json().catch(() => undefined)) as T }
  return { ok: false, ...runRefusal(res.status, await res.json().catch(() => ({}))) }
}

export const loadRuns = createServerFn()
  .validator((d: ListSearch) => d)
  .handler(({ data }) => load<RunPage>(`/production-runs?${listQuery(data)}`))

export const loadRun = createServerFn()
  .validator((id: string) => id)
  .handler(({ data }) => load<Run>(`/production-runs/${enc(data)}`))

/** The recipes the owner can produce from (every recipe; pos-api answers `canProduce` in the plan). */
export const loadRecipeOptions = createServerFn().handler(async () => (await load<{ data: RecipeSummary[] }>('/recipes')).data)

/** What `batches` batches of a recipe would take and what is on hand. A refusal (422 on `recipeId` or `batches`) is a Result. */
export const loadPlan = createServerFn()
  .validator((d: { recipeId: string; batches: number }) => d)
  .handler(({ data }) => call<Plan>(`/production-runs/plan?recipeId=${enc(data.recipeId)}&batches=${data.batches}`))

/** Records a run. `key` is the Idempotency-Key: the same key and request answer the first run, so a retry is safe. */
export const createRun = createServerFn({ method: 'POST' })
  .validator((d: { key: string; body: RunPayload }) => d)
  .handler(({ data }) =>
    call<Run>('/production-runs', { method: 'POST', headers: { 'idempotency-key': data.key }, body: JSON.stringify(data.body) }),
  )
