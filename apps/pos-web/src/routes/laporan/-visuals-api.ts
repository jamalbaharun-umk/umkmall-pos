import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { api } from '@/lib/api.server'
import type { TrendReport } from './-trend'
import { VISUAL_KINDS, VISUAL_PATHS, visualQuery, type Visual, type VisualKind } from './-visuals'

// Server functions of the report visuals (features 37 and 38). pos-api computes every figure; these only relay, and
// answer `{ ok: false, error }` in Indonesian (never a status code or a server message) so a chart can say what failed.

type Fail = { ok: false; status: number; error: string }
const OFFLINE = 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.'

async function relay<T>(path: string, fallback: string): Promise<{ ok: true; data: T } | Fail> {
  const res = await api(path).catch((e: unknown) => {
    if (isRedirect(e)) throw e // session ended: let the router send the user to sign in
    return null
  })
  if (!res) return { ok: false, status: 0, error: OFFLINE }
  if (res.status === 403) return { ok: false, status: 403, error: 'Anda tidak punya izin melihat laporan.' }
  if (res.status === 422) {
    const body = (await res.json().catch(() => null)) as { message?: unknown; code?: unknown } | null
    const message = typeof body?.message === 'string' ? body.message : 'Periksa kembali isian Anda'
    return { ok: false, status: 422, error: message }
  }
  if (!res.ok) return { ok: false, status: res.status, error: fallback }
  return { ok: true, data: (await res.json()) as T }
}

/** The visuals of one report for the same range, period or filter the screen shows. */
export const loadVisuals = createServerFn()
  .validator((d: { kind: VisualKind; query: Record<string, string | undefined> }) =>
    z.object({ kind: z.enum(VISUAL_KINDS), query: z.record(z.string(), z.string().optional()) }).parse(d) as typeof d,
  )
  .handler(async ({ data }): Promise<{ ok: true; visuals: Visual[] } | Fail> => {
    const r = await relay<{ visuals: Visual[] }>(`${VISUAL_PATHS[data.kind]}?${visualQuery(data.query)}`, 'Coba lagi sebentar lagi.')
    return r.ok ? { ok: true, visuals: r.data.visuals } : r
  })

/** "Penjualan dan pengeluaran": the window the URL names (scale, the day it ends on, the number of buckets). */
export const loadTrend = createServerFn()
  .validator((d: { scale: string; to?: string; count?: number }) =>
    z.object({ scale: z.enum(['day', 'month', 'year']), to: z.string().optional(), count: z.number().int().positive().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const q = new URLSearchParams({ scale: data.scale })
    if (data.to) q.set('to', data.to)
    if (data.count) q.set('count', String(data.count))
    return relay<TrendReport>(`/reports/sales-expenses?${q}`, 'Gagal memuat laporan, coba lagi.')
  })
