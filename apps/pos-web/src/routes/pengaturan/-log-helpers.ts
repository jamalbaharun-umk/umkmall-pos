// Pure logic of "Log aktivitas" (UMK-1969, design 32): what a row of the staff audit log says, in Indonesian, and the
// filters of the screen. No React, no I/O. The log never holds a PIN, token, phone number or customer name, so nothing
// here needs to hide one; a note typed by staff is not stored either.

export const GROUPS = [
  { value: 'all', label: 'Semua' },
  { value: 'money', label: 'Uang' },
  { value: 'access', label: 'Akses' },
  { value: 'shift', label: 'Shift' },
] as const
export type GroupFilter = (typeof GROUPS)[number]['value']

export const PERIODS = [
  { value: '1', label: 'Hari ini' },
  { value: '7', label: '7 hari' },
  { value: '30', label: '30 hari' },
  { value: '90', label: '90 hari' },
  { value: 'all', label: 'Semua' },
] as const
export type Period = (typeof PERIODS)[number]['value']
export const DEFAULT_PERIOD: Period = '7'
export const PER_PAGE = 20

export type LogSearch = { group?: GroupFilter; staff?: string; period?: Period }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The screen's filters from the address bar: anything unknown falls back to "no filter". Defaults are not kept. */
export function parseSearch(s: Record<string, unknown>): LogSearch {
  const group = GROUPS.find((g) => g.value === s.group && g.value !== 'all')?.value
  const period = PERIODS.find((p) => p.value === s.period && p.value !== DEFAULT_PERIOD)?.value
  const staff = typeof s.staff === 'string' && (s.staff === 'owner' || UUID.test(s.staff)) ? s.staff : undefined
  return { ...(group && { group }), ...(staff && { staff }), ...(period && { period }) }
}

/** The query of `GET /audit-log` for these filters and page. */
export function queryOf(search: LogSearch, page: number): string {
  const q = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) })
  if (search.group && search.group !== 'all') q.set('group', search.group)
  if (search.staff) q.set('actor', search.staff)
  const period = search.period ?? DEFAULT_PERIOD
  if (period !== 'all') q.set('days', period)
  return q.toString()
}

export const isFiltered = (search: LogSearch) => !!(search.group || search.staff || (search.period && search.period !== DEFAULT_PERIOD))

export type LogRow = {
  id: string
  occurredAt: string
  event: string
  group: 'money' | 'access' | 'shift' | null
  actor: { id: string; kind: string; name: string | null }
  target: { type: string; id: string | null; label: string | null } | null
  details: Record<string, string | number | boolean | null | string[]>
}
export type LogPage = { data: LogRow[]; total: number; page: number; perPage: number; timezone: string }

const ACTIONS: Record<string, string> = {
  sign_in: 'Masuk',
  void: 'Void struk',
  refund: 'Refund struk',
  refund_manual: 'Tandai refund manual',
  refund_retry: 'Coba ulang refund',
  kasbon_correction: 'Koreksi pembayaran kasbon',
  discount_approval: 'Setujui diskon dengan PIN',
  approval_pin_set: 'Atur PIN persetujuan',
  approval_pin_unlock: 'Buka kunci PIN persetujuan',
  approval_pin_reset: 'Hapus PIN persetujuan',
  price_override: 'Ubah harga',
  drawer_cash_in: 'Kas laci masuk',
  drawer_cash_out: 'Kas laci keluar',
  purchase_payment_void: 'Batalkan bayar pemasok',
  purchase_refund: 'Terima uang retur pemasok',
  purchase_refund_void: 'Batalkan uang retur pemasok',
  purchase_return_undo: 'Batalkan retur pembelian',
  shift_open: 'Buka shift',
  shift_close: 'Tutup shift',
  staff_create: 'Tambah staf',
  staff_update: 'Ubah staf',
  staff_delete: 'Hapus staf',
  role_create: 'Tambah peran',
  role_update: 'Ubah peran',
  role_delete: 'Hapus peran',
  device_bind: 'Daftarkan perangkat',
  device_pair: 'Pasang perangkat',
  device_revoke: 'Cabut perangkat',
  session_revoke: 'Akhiri sesi staf',
}
export const actionLabel = (event: string) => ACTIONS[event] ?? 'Aksi lain'

export function actorLabel(actor: LogRow['actor']): string {
  if (actor.kind === 'owner') return 'Pemilik'
  if (actor.kind === 'agent') return 'Agen UMKMall'
  return actor.name ?? 'Staf yang sudah dihapus'
}

/** What the row is about: "Struk #12", a product, "Shift #3", a device, staff or role name. */
export function targetLabel(row: Pick<LogRow, 'target'>): string {
  const t = row.target
  if (!t?.label) return t?.type === 'sale' ? 'Struk' : ''
  return t.type === 'sale' ? `Struk ${t.label}` : t.label
}

const REASONS: Record<string, string> = {
  wrong_item_or_qty: 'Salah input barang atau jumlah',
  wrong_payment_method: 'Salah metode pembayaran',
  customer_cancelled: 'Pelanggan batal membeli',
  duplicate_transaction: 'Transaksi tercatat dobel',
  goods_returned: 'Barang dikembalikan pelanggan',
  other: 'Lainnya',
  // A kasbon correction's reasons (UMK-1971).
  wrong_amount: 'Salah jumlah',
  wrong_method: 'Salah cara bayar',
  wrong_customer: 'Salah pelanggan',
  duplicate: 'Tercatat dua kali',
  tambah_modal: 'Tambah modal laci',
  setor_bank: 'Setor ke bank',
  ambil_pemilik: 'Diambil pemilik',
  lainnya: 'Lainnya',
}

const FIELDS: Record<string, string> = { name: 'nama', active: 'status aktif', credential: 'PIN', roles: 'peran' }

export const rupiah = (n: number) => `Rp${Math.abs(n).toLocaleString('id-ID')}`
/** A signed difference: "−Rp5.000" short, "+Rp2.000" over, "Rp0" exact. */
export const signedRupiah = (n: number) => (n < 0 ? `−${rupiah(n)}` : n > 0 ? `+${rupiah(n)}` : rupiah(0))

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** The short "Rincian" of a row (one line, the design's "Rp130.536 · Salah input"). */
export function detailText(row: Pick<LogRow, 'event' | 'details'>, permissionLabel: (key: string) => string = (k) => k): string {
  const d = row.details
  const parts: (string | null)[] = []
  switch (row.event) {
    case 'void':
    case 'refund':
      parts.push(num(d.total) === null ? null : rupiah(num(d.total)!), REASONS[text(d.reasonCode) ?? ''] ?? null)
      break
    case 'kasbon_correction': {
      const old = num(d.oldAmount)
      const next = num(d.newAmount)
      if (old !== null) parts.push(next === null ? `${rupiah(old)} dibatalkan` : `${rupiah(old)} jadi ${rupiah(next)}`)
      parts.push(REASONS[text(d.reasonCode) ?? ''] ?? null)
      break
    }
    case 'discount_approval':
      if (num(d.discount) !== null) parts.push(`Diskon ${rupiah(num(d.discount)!)}`)
      if (num(d.discountPercent) !== null) parts.push(`${num(d.discountPercent)}%`)
      break
    case 'approval_pin_set':
      parts.push(d.forgotten === true ? 'PIN diganti setelah lupa' : d.first === true ? 'PIN pertama' : 'PIN diganti')
      break
    case 'price_override':
      if (num(d.listPrice) !== null && num(d.unitPrice) !== null) parts.push(`${rupiah(num(d.listPrice)!)} jadi ${rupiah(num(d.unitPrice)!)}`)
      if (num(d.qty) !== null) parts.push(`jumlah ${num(d.qty)}`)
      break
    case 'drawer_cash_in':
    case 'drawer_cash_out':
      parts.push(num(d.amount) === null ? null : rupiah(num(d.amount)!), REASONS[text(d.reason) ?? ''] ?? null)
      break
    case 'shift_open':
      if (num(d.openingCash) !== null) parts.push(`Modal awal ${rupiah(num(d.openingCash)!)}`)
      break
    case 'shift_close':
      if (num(d.difference) !== null) parts.push(`Selisih ${signedRupiah(num(d.difference)!)}`)
      break
    case 'staff_update': {
      const changed = list(d.changed).map((f) => FIELDS[f] ?? f)
      if (changed.length) parts.push(`Diubah: ${changed.join(', ')}`)
      break
    }
    case 'role_create':
    case 'role_update': {
      const added = list(d.added).map(permissionLabel)
      const removed = list(d.removed).map(permissionLabel)
      if (added.length) parts.push(`Tambah izin ${added.join(', ')}`)
      if (removed.length) parts.push(`Cabut izin ${removed.join(', ')}`)
      if (d.renamed === true) parts.push('Nama diganti')
      break
    }
    // Supplier money of a purchase (UMK-1970): the amount, and where the cash went or came from.
    case 'purchase_payment_void':
    case 'purchase_refund':
    case 'purchase_refund_void':
      parts.push(num(d.amount) === null ? null : rupiah(num(d.amount)!), purchaseCashPlace(d))
      break
    case 'purchase_return_undo':
      parts.push(num(d.total) === null ? null : rupiah(num(d.total)!), num(d.units) === null ? null : `${num(d.units)} unit kembali ke stok`)
      break
    default:
  }
  return parts.filter(Boolean).join(' · ')
}

/** Where a purchase's supplier cash went: the drawer, the store cash, or outside both. */
function purchaseCashPlace(d: LogRow['details']): string | null {
  if (d.drawerReversed === true) return 'laci shift'
  if (d.drawerReversed === false) return 'kas toko'
  const via = text(d.destination) ?? text(d.source)
  return via === 'drawer' ? 'laci shift' : via === 'store_cash' ? 'kas toko' : via === 'outside' ? 'di luar laci' : null
}

/** Date and time in the store's timezone: "26 Nov 10.12". An unknown timezone falls back to Jakarta. */
export function whenLabel(iso: string, timezone: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('id-ID', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  try {
    return fmt(timezone)
  } catch {
    return fmt('Asia/Jakarta')
  }
}

/** The rows of the expanded view: label and value, only what the row holds. */
export function detailLines(
  row: LogRow,
  timezone: string,
  permissionLabel: (key: string) => string = (k) => k,
): [string, string][] {
  const d = row.details
  const lines: [string, string | null][] = [
    ['Waktu', whenLabel(row.occurredAt, timezone)],
    ['Siapa', actorLabel(row.actor)],
    ['Aksi', actionLabel(row.event)],
    ['Target', targetLabel(row) || null],
    ['Jumlah', num(d.total) !== null ? rupiah(num(d.total)!) : num(d.amount) !== null ? rupiah(num(d.amount)!) : null],
    ['Alasan', REASONS[text(d.reasonCode) ?? text(d.reason) ?? ''] ?? null],
    ['Modal awal', num(d.openingCash) !== null ? rupiah(num(d.openingCash)!) : null],
    ['Uang dihitung', num(d.countedCash) !== null ? rupiah(num(d.countedCash)!) : null],
    ['Uang seharusnya', num(d.expectedCash) !== null ? rupiah(num(d.expectedCash)!) : null],
    ['Selisih', num(d.difference) !== null ? signedRupiah(num(d.difference)!) : null],
    ['Pembayaran lama', row.event === 'kasbon_correction' && num(d.oldAmount) !== null ? rupiah(num(d.oldAmount)!) : null],
    [
      'Pembayaran baru',
      row.event === 'kasbon_correction' ? (num(d.newAmount) !== null ? rupiah(num(d.newAmount)!) : 'Dibatalkan saja') : null,
    ],
    ['Harga normal', num(d.listPrice) !== null ? rupiah(num(d.listPrice)!) : null],
    ['Harga jadi', num(d.unitPrice) !== null ? rupiah(num(d.unitPrice)!) : null],
    ['Perubahan', ['staff_update', 'role_create', 'role_update'].includes(row.event) ? detailText(row, permissionLabel) || null : null],
  ]
  return lines.filter((l): l is [string, string] => l[1] !== null)
}

/** The filter's "Staf" options: everyone, the owner, then the store's staff by name. */
export function staffOptions(staff: { id: string; name: string }[]) {
  return [
    { value: 'all', label: 'Semua' },
    { value: 'owner', label: 'Pemilik' },
    ...staff.map((s) => ({ value: s.id, label: s.name })),
  ]
}
