// Pure helpers for the purchase debt screens (UMK-1970, design feature 29). pos-api computes every figure (debt,
// status, days late); these only label, filter, preview and explain them.

export type PaymentStatus = 'belum_bayar' | 'sebagian' | 'lunas'
export type PayFilter = 'semua' | PaymentStatus | 'terlambat'

export const PAY_FILTERS: { value: PayFilter; label: string }[] = [
  { value: 'semua', label: 'Semua' },
  { value: 'belum_bayar', label: 'Belum bayar' },
  { value: 'sebagian', label: 'Sebagian' },
  { value: 'lunas', label: 'Lunas' },
  { value: 'terlambat', label: 'Terlambat' },
]

export const asPayFilter = (v: unknown): PayFilter =>
  PAY_FILTERS.some((f) => f.value === v) ? (v as PayFilter) : 'semua'

type Debtish = { status: string; paymentStatus?: PaymentStatus | null; overdueDays?: number | null }

/** Whether a purchase shows under a payment filter. Drafts and cancelled purchases owe nothing: only under Semua. */
export function matchesPayFilter(o: Debtish, f: PayFilter): boolean {
  if (f === 'semua') return true
  if (f === 'terlambat') return (o.overdueDays ?? 0) > 0
  return o.paymentStatus === f
}

/** The empty text under a filter that matches nothing ("Tidak ada pembelian terlambat."). */
export function noMatchText(f: PayFilter): string {
  const label = PAY_FILTERS.find((x) => x.value === f)?.label.toLowerCase() ?? ''
  return f === 'semua' ? 'Tidak ada pembelian yang cocok.' : `Tidak ada pembelian ${label}.`
}

export type Tone = 'warning' | 'success' | 'danger' | 'primary' | 'light'

/** The badge of a purchase: its payment status once approved (late wins), else the document status. */
export function statusBadge(o: Debtish): { label: string; tone: Tone } {
  if (o.status === 'draft') return { label: 'Draf', tone: 'warning' }
  if (o.status === 'cancelled') return { label: 'Dibatalkan', tone: 'light' }
  if ((o.overdueDays ?? 0) > 0) return { label: `Terlambat ${o.overdueDays} hari`, tone: 'danger' }
  if (o.paymentStatus === 'lunas') return { label: 'Lunas', tone: 'success' }
  if (o.paymentStatus === 'sebagian') return { label: 'Sebagian', tone: 'primary' }
  return { label: 'Belum bayar', tone: 'warning' }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** "30 Nov" for a store calendar day 'YYYY-MM-DD' (no timezone maths: the day is already the store's). */
export function shortDay(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[(m || 1) - 1]}`
}

/** "jatuh tempo 30 Nov (4 hari lagi)", "... (hari ini)", "... (terlambat 2 hari)"; null without a due date. */
export function dueText(o: { dueDate: string | null; dueInDays: number | null; paymentStatus?: PaymentStatus | null }) {
  if (!o.dueDate) return null
  const base = `jatuh tempo ${shortDay(o.dueDate)}`
  if (o.paymentStatus === 'lunas' || o.dueInDays === null) return base
  if (o.dueInDays === 0) return `${base} (hari ini)`
  if (o.dueInDays > 0) return `${base} (${o.dueInDays} hari lagi)`
  return `${base} (terlambat ${-o.dueInDays} hari)`
}

/** Purchase number for screens: the server's `code`, or the short id for an answer without one. */
export const orderCode = (o: { code?: string; id: string }) => o.code ?? o.id.slice(0, 8)

// ---- paying ----

export type PaySource = 'drawer' | 'outside'
export const PAY_SOURCES: { value: PaySource; label: string }[] = [
  { value: 'drawer', label: 'Laci kasir' },
  { value: 'outside', label: 'Di luar laci' },
]

/** The amount's own mistake before sending; pos-api checks the same again (PURCHASE_OVERPAY). */
export function payAmountError(amount: number, remaining: number): string | undefined {
  if (!(amount > 0)) return 'Harus lebih dari 0'
  if (amount > remaining) return 'Jumlah melebihi sisa hutang.'
  return undefined
}

/**
 * The line under the source choice: what the drawer will hold, or why it cannot pay. `drawerCash` is the actor's open
 * shift's expected cash, null without an open shift. Informs only: pos-api decides.
 */
export function drawerNotice(
  source: PaySource,
  amount: number,
  drawerCash: number | null,
  fmt: (n: number) => string,
): { text: string; tone: 'info' | 'warning' } {
  if (source === 'outside') return { text: 'Tidak mengubah uang di laci.', tone: 'info' }
  if (drawerCash === null)
    return {
      text: 'Belum ada shift buka. Buka shift untuk membayar dari laci, atau pilih Di luar laci.',
      tone: 'warning',
    }
  if (amount > drawerCash)
    return {
      text: `Uang di laci (${fmt(drawerCash)}) kurang dari jumlah. Kurangi jumlah atau pilih Di luar laci.`,
      tone: 'warning',
    }
  if (!(amount > 0)) return { text: `Uang di laci sekarang ${fmt(drawerCash)}. Butuh shift terbuka.`, tone: 'info' }
  const after = drawerCash - amount
  return {
    text: `Laci berkurang ${fmt(amount)} (tersisa ${fmt(after)}). Butuh shift terbuka.`,
    tone: 'info',
  }
}

// ---- returns ----

export type ReturnLine = { id: string; unitCost: number; returnable: number }

/** What a return will do, as the form's summary says it before saving. `qty` maps a line id to its typed units. */
export function returnPreview(lines: ReturnLine[], qty: Record<string, number>, remaining: number) {
  let units = 0
  let total = 0
  let overBatch = false
  for (const l of lines) {
    const n = qty[l.id] ?? 0
    if (n <= 0) continue
    if (n > l.returnable) overBatch = true
    units += n
    total += n * l.unitCost
  }
  return {
    units,
    total,
    overBatch,
    remainingAfter: Math.max(0, remaining - total),
    /** Above the debt: money the supplier gives back outside the system. */
    refundDue: Math.max(0, total - remaining),
  }
}

/** "Stok berkurang 10 pcs. Hutang berkurang Rp28.000 (Rp2.800 × 10). Sisa hutang jadi Rp1.372.000." */
export function returnSummary(
  preview: ReturnType<typeof returnPreview>,
  single: { unitCost: number; qty: number } | null,
  fmt: (n: number) => string,
): string {
  const how = single ? ` (${fmt(single.unitCost)} × ${single.qty})` : ''
  const parts = [
    `Stok berkurang ${preview.units} pcs.`,
    `Hutang berkurang ${fmt(preview.total - preview.refundDue)}${preview.refundDue ? '' : how}.`,
    `Sisa hutang jadi ${fmt(preview.remainingAfter)}.`,
  ]
  if (preview.refundDue > 0)
    parts.push(`${fmt(preview.refundDue)} kembali dari pemasok di luar sistem (dicatat sebagai catatan).`)
  return parts.join(' ')
}

export const RETURN_REASONS = [
  { value: 'rusak', label: 'Barang rusak' },
  { value: 'kedaluwarsa', label: 'Kedaluwarsa' },
  { value: 'salah_kirim', label: 'Salah kirim' },
  { value: 'lainnya', label: 'Lainnya' },
] as const

// ---- refusals ----

/** "Yang bisa dilakukan" for each refusal code of a payment or return; the server's text is "Apa yang terjadi". */
export function refusalTodo(code: string | undefined, extra: { remaining?: number; drawerCash?: number; available?: number }, fmt: (n: number) => string) {
  switch (code) {
    case 'PURCHASE_OVERPAY':
      return extra.remaining ? `Isi paling banyak ${fmt(extra.remaining)}.` : 'Pembelian ini sudah lunas. Retur tetap bisa dicatat.'
    case 'SHIFT_REQUIRED':
      return 'Buka shift dulu, atau pilih Di luar laci.'
    case 'DRAWER_INSUFFICIENT':
      return `Isi paling banyak ${fmt(extra.drawerCash ?? 0)}, atau pilih Di luar laci.`
    case 'DRAWER_PERMISSION':
      return 'Pilih Di luar laci, atau minta pemilik memberi izin kasir.'
    case 'RETURN_EXCEEDS_BATCH':
      return `Kurangi jumlahnya menjadi paling banyak ${extra.available ?? 0}.`
    case 'PURCHASE_NOT_APPROVED':
      return 'Setujui pembelian dulu.'
    case 'IDEMPOTENCY_KEY_REUSED':
      return 'Muat ulang halaman, lalu catat lagi.'
    default:
      return undefined
  }
}

// ---- history ----

export type Payment = {
  id: string
  amount: number
  source: PaySource
  note: string | null
  actorName: string
  createdAt: string
  voidedAt: string | null
  voidReason: string | null
  drawerReversed: boolean | null
}
export type Return = {
  id: string
  reason: string
  reasonLabel: string
  note: string | null
  total: number
  refundDue: number
  actorName: string
  createdAt: string
  lines: { orderLineId: string; qty: number; unitCost: number }[]
}

export type HistoryRow = {
  key: string
  at: string
  kind: string
  detail: string
  /** Signed: the purchase is +, what lowers the debt is −, a voided payment's reversal is +. */
  amount: number
  paymentId?: string
  voided?: boolean
}

/**
 * The detail's history, oldest first: the purchase itself, each payment (and, once voided, its reversal line: the
 * payment is never removed), each return with what came back. `names` maps an order line id to "Indomie Goreng".
 */
export function historyRows(
  o: { approvedAt: string | null; total: number; lines: { id: string; productName: string; qty: number }[] },
  payments: Payment[],
  returns: Return[],
  fmt: (n: number) => string,
): HistoryRow[] {
  const names = new Map(o.lines.map((l) => [l.id, l.productName]))
  const rows: HistoryRow[] = []
  if (o.approvedAt) {
    const units = o.lines.reduce((n, l) => n + l.qty, 0)
    const first = o.lines[0]
    rows.push({
      key: 'order',
      at: o.approvedAt,
      kind: 'Pembelian',
      detail: o.lines.length === 1 && first ? `${first.qty} ${first.productName}` : `${o.lines.length} barang, ${units} unit`,
      amount: o.total,
    })
  }
  for (const p of payments) {
    rows.push({
      key: `p-${p.id}`,
      at: p.createdAt,
      kind: p.source === 'drawer' ? 'Pembayaran (laci)' : 'Pembayaran (di luar laci)',
      detail: [p.source === 'drawer' ? 'Dari laci kasir' : 'Di luar laci', p.note].filter(Boolean).join(' · '),
      amount: -p.amount,
      paymentId: p.id,
      voided: !!p.voidedAt,
    })
    if (p.voidedAt)
      rows.push({
        key: `v-${p.id}`,
        at: p.voidedAt,
        kind: 'Pembayaran dibatalkan',
        detail: [
          p.voidReason,
          p.drawerReversed === true ? 'uang kembali ke laci' : p.drawerReversed === false ? 'uang masuk kas toko' : null,
        ]
          .filter(Boolean)
          .join(' · '),
        amount: p.amount,
      })
  }
  for (const r of returns) {
    const what = r.lines.map((l) => `${l.qty} ${names.get(l.orderLineId) ?? 'barang'}`).join(', ')
    rows.push({
      key: `r-${r.id}`,
      at: r.createdAt,
      kind: 'Retur',
      detail: [what, r.reasonLabel, r.note, r.refundDue ? `${fmt(r.refundDue)} kembali dari pemasok di luar sistem` : null]
        .filter(Boolean)
        .join(' · '),
      amount: -r.total,
    })
  }
  return rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/** "−Rp1.000.000" / "Rp2.400.000" / "+Rp200.000" (reversal), the sign as the design writes it. */
export const signedRupiah = (n: number, fmt: (n: number) => string, plus = false) =>
  n < 0 ? `−${fmt(-n)}` : `${plus ? '+' : ''}${fmt(n)}`

/** Amount text to integer rupiah: digits only ("Rp 500.000" → 500000). */
export const parseAmount = (text: string): number => Number(text.replace(/\D/g, '')) || 0

/** Thousands dots while typing: "500000" → "500.000". */
export function formatAmountInput(text: string): string {
  const n = parseAmount(text)
  return n ? n.toLocaleString('id-ID') : ''
}
