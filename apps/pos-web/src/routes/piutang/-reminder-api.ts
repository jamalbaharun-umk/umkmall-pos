import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'

// UMK-1973: relays for the kasbon reminder. pos-api works out what is owed and how late; the browser builds the
// wa.me message from it. The member id is the one pos-api listed (a path segment, checked as a uuid there).

export type Reminder = {
  memberId: string
  memberName: string
  /** The customer's number as stored; null when there is none. Never logged. */
  phone: string | null
  rest: number
  /** The oldest open due date, `YYYY-MM-DD`. */
  dueDate: string
  overdueDays: number
  lastRemindedAt: string | null
  remindedDaysAgo: number | null
}

export type ReminderResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code?: string }

const MESSAGES: Record<number, string> = {
  403: 'Anda tidak punya izin untuk ini.',
  404: 'Pelanggan tidak ditemukan, mungkin sudah dihapus.',
}

async function call<T>(path: string, method: 'GET' | 'POST'): Promise<ReminderResult<T>> {
  const res = await api(path, { method }).catch((e: unknown) => {
    if (isRedirect(e)) throw e // the session ended: the screen follows the sign-in redirect
    return null
  })
  if (!res) return { ok: false, status: 0, error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }
  if (res.ok) return { ok: true, data: (await res.json()) as T }
  const body = (await res.json().catch(() => null)) as { message?: unknown; code?: unknown } | null
  return {
    ok: false,
    status: res.status,
    error:
      res.status === 409 && typeof body?.message === 'string'
        ? body.message
        : (MESSAGES[res.status] ?? 'Gagal terhubung ke server, coba lagi.'),
    code: typeof body?.code === 'string' && /^[a-z][a-z_]{1,39}$/.test(body.code) ? body.code : undefined,
  }
}

const path = (id: string) => `/receivables/reminders/${encodeURIComponent(id)}`

export const loadReminder = createServerFn({ method: 'POST' })
  .validator((memberId: string) => memberId)
  .handler(({ data }) => call<Reminder>(path(data), 'GET'))

/** The owner opened the reminder in WhatsApp: the customer keeps the date (not the message). */
export const markReminded = createServerFn({ method: 'POST' })
  .validator((memberId: string) => memberId)
  .handler(({ data }) => call<{ memberId: string; lastRemindedAt: string }>(path(data), 'POST'))
