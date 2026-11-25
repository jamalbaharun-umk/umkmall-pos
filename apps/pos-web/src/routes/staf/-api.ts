import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import { api } from '@/lib/api.server'
import { refusalOf } from '@/lib/refusal'
import { posApiUrl, setSessionToken } from '@/lib/session.server'

// Server functions for the U4 screens. pos-api validates every body (zod, 422); these only relay.

export type Role = { id: string; name: string; permissions: string[] }
export type Staff = { id: string; name: string; active: boolean; createdAt: string; roles: { id: string; name: string }[] }
export type Device = { id: string; name: string; revokedAt: string | null; createdAt: string }
export type CashierSession = {
  id: string
  staff: { id: string; name: string }
  device: { id: string; name: string }
  createdAt: string
  expiresAt: string
}
export type Result =
  | { ok: true }
  | { ok: false; error: string; errors?: Record<string, string>; retryAfter?: number }

export const PERMISSION_LABELS: Record<string, string> = {
  'sales.create': 'Membuat penjualan',
  'sales.price_override': 'Mengubah harga saat menjual',
  'catalog.manage': 'Mengelola katalog',
  'reports.view': 'Melihat laporan',
  'staff.manage': 'Mengelola staf, peran dan perangkat',
  'purchasing.manage': 'Mengelola pemasok, pembelian dan stok opname',
  'members.manage': 'Mengelola pelanggan',
  'vouchers.manage': 'Mengelola voucher',
  'receivables.manage': 'Mengelola piutang',
  'sales.void': 'Menyetujui pembatalan struk (dengan PIN)',
  'expenses.manage': 'Mengelola pengeluaran',
  'store_cash.manage': 'Menerima setoran kas toko',
}

async function load<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error((await refusalOf(res)).error)
  return (await res.json()) as T
}

async function mutate(path: string, method: string, body?: unknown): Promise<Result> {
  const res = await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  return res.ok ? { ok: true } : { ok: false, ...(await refusalOf(res)) }
}

export const loadStaffPage = createServerFn().handler(async () => ({
  staff: await load<Staff[]>('/staff'),
  roles: await load<Role[]>('/roles'),
}))

export const loadMember = createServerFn()
  .validator((id: string) => id)
  .handler(async ({ data }) => ({
    member: await load<Staff>(`/staff/${encodeURIComponent(data)}`),
    roles: await load<Role[]>('/roles'),
  }))

type StaffInput = { id?: string; name: string; pin?: string; roleIds: string[]; active: boolean }
export const saveStaff = createServerFn({ method: 'POST' })
  .validator((d: StaffInput) => d)
  .handler(({ data: { id, ...body } }) =>
    id ? mutate(`/staff/${encodeURIComponent(id)}`, 'PATCH', body) : mutate('/staff', 'POST', body),
  )

export const deleteStaff = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data }) => mutate(`/staff/${encodeURIComponent(data)}`, 'DELETE'))

export const loadRolesPage = createServerFn().handler(async () => ({
  roles: await load<Role[]>('/roles'),
  permissions: await load<string[]>('/roles/permissions'),
}))

export const loadRole = createServerFn()
  .validator((id: string) => id)
  .handler(async ({ data }) => ({
    role: await load<Role>(`/roles/${encodeURIComponent(data)}`),
    permissions: await load<string[]>('/roles/permissions'),
  }))

type RoleInput = { id?: string; name: string; permissions: string[] }
export const saveRole = createServerFn({ method: 'POST' })
  .validator((d: RoleInput) => d)
  .handler(({ data: { id, ...body } }) =>
    id ? mutate(`/roles/${encodeURIComponent(id)}`, 'PATCH', body) : mutate('/roles', 'POST', body),
  )

export const deleteRole = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data }) => mutate(`/roles/${encodeURIComponent(data)}`, 'DELETE'))

// The bound device's credential lives only in this httpOnly cookie on the device itself; JS never sees it.
const DEVICE_COOKIE = 'pos_device'
const deviceToken = () => getCookie(DEVICE_COOKIE)

export const loadDevicesPage = createServerFn().handler(async () => ({
  devices: await load<Device[]>('/staff/devices'),
  sessions: await load<CashierSession[]>('/staff/sessions'),
  thisDeviceId: deviceToken()?.split('.')[0] ?? null,
}))

export const bindThisDevice = createServerFn({ method: 'POST' })
  .validator((name: string) => name)
  .handler(async ({ data }): Promise<Result> => {
    const res = await api('/staff/devices', { method: 'POST', body: JSON.stringify({ name: data }) })
    if (!res.ok) return { ok: false, ...(await refusalOf(res)) }
    const { deviceToken: token } = (await res.json()) as { deviceToken: string }
    setCookie(DEVICE_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 400 * 24 * 60 * 60, // browsers cap cookies at 400 days; rebind after that
    })
    return { ok: true }
  })

export const revokeDevice = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data }) => mutate(`/staff/devices/${encodeURIComponent(data)}/revoke`, 'POST'))

export const revokeSession = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data }) => mutate(`/staff/sessions/${encodeURIComponent(data)}/revoke`, 'POST'))

// --- cashier PIN sign-in on a bound device (no session yet: the device cookie authenticates) ---

export type Picker = { bound: false } | { bound: true; staff: { id: string; name: string }[] }

export const loadPicker = createServerFn().handler(async (): Promise<Picker> => {
  const token = deviceToken()
  if (!token) return { bound: false }
  const res = await fetch(`${posApiUrl()}/auth/device/staff`, { headers: { 'x-pos-device': token } })
  if (res.status === 401) return { bound: false } // revoked or unknown device
  if (!res.ok) throw new Error('Gagal memuat daftar kasir.')
  return { bound: true, staff: (await res.json()) as { id: string; name: string }[] }
})

export const pinSignIn = createServerFn({ method: 'POST' })
  .validator((d: { staffId: string; pin: string }) => d)
  .handler(async ({ data }): Promise<Result> => {
    const token = deviceToken()
    if (!token) return { ok: false, error: 'Perangkat ini belum terhubung ke toko.' }
    const res = await fetch(`${posApiUrl()}/auth/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pos-device': token },
      body: JSON.stringify(data),
    }).catch(() => null)
    if (!res) return { ok: false, error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }
    if (res.ok) {
      const { sessionToken, expiresIn } = (await res.json()) as { sessionToken: string; expiresIn: number }
      setSessionToken(sessionToken, expiresIn)
      return { ok: true }
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 30
      return { ok: false, error: `Terlalu banyak PIN salah. Coba lagi dalam ${retryAfter} detik.`, retryAfter }
    }
    if (res.status === 401) return { ok: false, error: 'PIN salah.' }
    return { ok: false, error: 'Gagal masuk, coba lagi.' }
  })
