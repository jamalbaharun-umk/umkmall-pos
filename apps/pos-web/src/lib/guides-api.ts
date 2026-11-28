import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'

// UMK-2134: the signed-in person's guide progress on pos-api (`/guides/progress`). Each call answers ok/false and
// never throws, so a failure never blocks the screen the guide sits on.

export type GuideStatus = 'done' | 'skipped'
export type GuideProgress = { key: string; status: GuideStatus; updatedAt: string }

export const getGuideProgress = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ ok: true; data: GuideProgress[] } | { ok: false }> => {
    try {
      const res = await api('/guides/progress')
      if (!res.ok) return { ok: false }
      return { ok: true, data: ((await res.json()) as { data: GuideProgress[] }).data }
    } catch {
      return { ok: false }
    }
  },
)

export const markGuide = createServerFn({ method: 'POST' })
  .validator((d: { key: string; status: GuideStatus }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    try {
      const res = await api(`/guides/progress/${encodeURIComponent(data.key)}`, {
        method: 'PUT',
        body: JSON.stringify({ status: data.status }),
      })
      return { ok: res.ok }
    } catch {
      return { ok: false }
    }
  })

export const resetGuides = createServerFn({ method: 'POST' })
  .validator((key: string | null) => key)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    try {
      const res = await api(data ? `/guides/progress/${encodeURIComponent(data)}` : '/guides/progress', {
        method: 'DELETE',
      })
      return { ok: res.ok }
    } catch {
      return { ok: false }
    }
  })
