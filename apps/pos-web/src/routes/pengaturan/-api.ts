import { createServerFn } from '@tanstack/react-start'
import { api, trySetStatus } from '@/lib/api.server'
import { refusalOf } from '@/lib/refusal'

// Server functions for the settings page: the store profile plus the tax (sales) and timezone (reports) settings
// that already have their own pos-api endpoints, so the owner has ONE settings page.

export const BUSINESS_TYPES = [
  { value: 'retail', label: 'Ritel' },
  { value: 'wholesale', label: 'Grosir' },
  { value: 'fnb', label: 'Makanan & minuman' },
  { value: 'fashion', label: 'Fesyen' },
  { value: 'pharmacy', label: 'Apotek' },
  { value: 'other', label: 'Lainnya' },
] as const

export type Profile = {
  name: string | null
  businessType: string | null
  otherBusinessType: string | null
  address: string | null
  hasLogo: boolean
  /** UMK-1992: the store has uploaded its static QRIS. */
  qrisConfigured: boolean
  updatedAt: string | null
}
export type ProfileInput = { name: string; businessType: string; otherBusinessType?: string; address: string }
type Result = { error?: string; errors?: Record<string, string>; status?: number }

async function read<T>(path: string): Promise<T | null> {
  const res = await api(path)
  if (res.status === 403) {
    trySetStatus(200) // expected here: the page still renders, without this part
    return null // the actor may not read this part (e.g. timezone needs reports.view)
  }
  if (!res.ok) throw new Error((await refusalOf(res)).error)
  return (await res.json()) as T
}

async function write(path: string, method: string, body?: unknown): Promise<Result> {
  const res = await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  return res.ok ? {} : refusalOf(res)
}

export const loadSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const [profile, sales, reports] = await Promise.all([
    read<Profile>('/store/profile'),
    read<{ taxBps: number }>('/sales/settings'),
    read<{ timezone: string }>('/reports/settings'),
  ])
  return { profile: profile!, taxBps: sales?.taxBps ?? null, timezone: reports?.timezone ?? null }
})

export const saveProfile = createServerFn({ method: 'POST' })
  .validator((d: ProfileInput) => d)
  .handler(({ data }) => write('/store/profile', 'PUT', data))

export const uploadLogo = createServerFn({ method: 'POST' })
  .validator((d: FormData) => d)
  .handler(async ({ data }): Promise<Result> => {
    const file = data.get('file')
    if (!(file instanceof File)) return { error: 'Logo tidak valid.' }
    const body = new FormData()
    body.set('file', file)
    const res = await api('/store/profile/logo', { method: 'POST', body })
    return res.ok ? {} : refusalOf(res)
  })

export const deleteLogo = createServerFn({ method: 'POST' }).handler(() => write('/store/profile/logo', 'DELETE'))

export const uploadQris = createServerFn({ method: 'POST' })
  .validator((d: FormData) => d)
  .handler(async ({ data }): Promise<Result> => {
    const file = data.get('file')
    if (!(file instanceof File)) return { error: 'Kode QRIS tidak valid.' }
    const body = new FormData()
    body.set('file', file)
    const res = await api('/store/profile/qris', { method: 'POST', body })
    return res.ok ? {} : refusalOf(res)
  })

export const deleteQris = createServerFn({ method: 'POST' }).handler(() => write('/store/profile/qris', 'DELETE'))

export const saveAppSettings = createServerFn({ method: 'POST' })
  .validator((d: { taxBps?: number; timezone?: string }) => d)
  .handler(async ({ data }): Promise<Result> => {
    // Only an explicit tax choice is sent: a timezone-only save must not count as choosing the tax.
    if (data.taxBps !== undefined) {
      const tax = await write('/sales/settings', 'PUT', { taxBps: data.taxBps })
      if (tax.error) return { error: tax.error, errors: tax.errors && { tax: Object.values(tax.errors)[0] } }
    }
    if (data.timezone === undefined) return {}
    const tz = await write('/reports/settings', 'PUT', { timezone: data.timezone })
    return tz.error ? { error: tz.error, errors: tz.errors } : {}
  })
