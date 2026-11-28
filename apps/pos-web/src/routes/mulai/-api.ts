import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { refusalOf } from '@/lib/refusal'

// UMK-2128: the first screen's templates and "Isi harga". Every call goes through the session client; actions answer
// { ok, data } or { ok: false, error } for the error dialog instead of throwing.

export type BusinessTemplate = {
  key: string
  name: string
  description: string
  productCount: number
  categories: string[]
  sample: string[]
}
export type ApplyResult = { template: string; created: number; skipped: number; unpriced: number }
export type UnpricedProduct = { id: string; name: string; unit: string; category: string }
export type PricesResult = { priced: number; failed: { id: string; error: string }[]; unpriced: number }
export type Answer<T> = { ok: true; data: T } | { ok: false; error: string; status?: number }

async function read<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error((await refusalOf(res)).error)
  return (await res.json()) as T
}

async function send<T>(path: string, body?: unknown): Promise<Answer<T>> {
  const res = await api(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
  if (!res.ok) return { ok: false, ...(await refusalOf(res)) }
  return { ok: true, data: (await res.json()) as T }
}

export const listTemplates = createServerFn({ method: 'GET' }).handler(
  async () => (await read<{ data: BusinessTemplate[] }>('/onboarding/templates')).data,
)

export const applyTemplate = createServerFn({ method: 'POST' })
  .validator((key: string) => key)
  .handler(({ data }) => send<ApplyResult>(`/onboarding/templates/${encodeURIComponent(data)}/apply`))

export const listUnpriced = createServerFn({ method: 'GET' }).handler(() =>
  read<{ data: UnpricedProduct[]; total: number }>('/onboarding/unpriced'),
)

export const savePrices = createServerFn({ method: 'POST' })
  .validator((items: { id: string; sellingPrice: number }[]) => items)
  .handler(({ data }) => send<PricesResult>('/onboarding/prices', { items: data }))
