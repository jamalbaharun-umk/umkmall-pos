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
    /** Above the debt: money the supplier has to give back (recorded with "Terima uang retur"). */
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
    parts.push(`${fmt(preview.refundDue)} harus dikembalikan pemasok; catat lewat Terima uang retur.`)
  return parts.join(' ')
}

export const RETURN_REASONS = [
  { value: 'rusak', label: 'Barang rusak' },
  { value: 'kedaluwarsa', label: 'Kedaluwarsa' },
  { value: 'salah_kirim', label: 'Salah kirim' },
  { value: 'lainnya', label: 'Lainnya' },
] as const

// ---- money back from the supplier ----

export type RefundDestination = 'drawer' | 'store_cash'
export const REFUND_DESTINATIONS: { value: RefundDestination; label: string }[] = [
  { value: 'drawer', label: 'Laci kasir' },
  { value: 'store_cash', label: 'Kas toko' },
]

/** The amount's own mistake before sending; pos-api checks the same again (REFUND_EXCEEDS_DUE). */
export function refundAmountError(amount: number, refundDue: number): string | undefined {
  if (!(amount > 0)) return 'Harus lebih dari 0'
  if (amount > refundDue) return 'Jumlah melebihi uang yang masih harus dikembalikan pemasok.'
  return undefined
}

/** The line under the destination choice; `drawerCash` is the actor's open shift's expected cash, null without one. */
export function refundNotice(
  destination: RefundDestination,
  amount: number,
  drawerCash: number | null,
  fmt: (n: number) => string,
): { text: string; tone: 'info' | 'warning' } {
  if (destination === 'store_cash') return { text: 'Uang masuk kas toko, di luar laci shift.', tone: 'info' }
  if (drawerCash === null)
    return { text: 'Belum ada shift buka. Buka shift untuk menerima uang ke laci, atau pilih Kas toko.', tone: 'warning' }
  if (!(amount > 0)) return { text: `Uang di laci sekarang ${fmt(drawerCash)}. Butuh shift terbuka.`, tone: 'info' }
  return { text: `Laci bertambah ${fmt(amount)} (jadi ${fmt(drawerCash + amount)}). Butuh shift terbuka.`, tone: 'info' }
}

// ---- refusals ----

/** "Yang bisa dilakukan" for each refusal code of a payment or return; the server's text is "Apa yang terjadi". */
/**
 * The dialog a refusal came from: its "what to do" names only what that dialog offers (the pay dialog's other source
 * is "Di luar laci", the refund dialog's is "Kas toko"; a void has no amount to change).
 */
export type RefusalContext = 'pay' | 'return' | 'payment_void' | 'refund' | 'refund_void' | 'return_undo'

export function refusalTodo(
  code: string | undefined,
  extra: { remaining?: number; drawerCash?: number; available?: number; refundDue?: number; refunded?: number },
  fmt: (n: number) => string,
  context: RefusalContext = 'pay',
) {
  const other = context === 'refund' ? 'Kas toko' : 'Di luar laci'
  switch (code) {
    case 'PURCHASE_OVERPAY':
      return extra.remaining ? `Isi paling banyak ${fmt(extra.remaining)}.` : 'Pembelian ini sudah lunas. Retur tetap bisa dicatat.'
    case 'SHIFT_REQUIRED':
      return `Buka shift dulu, atau pilih ${other}.`
    case 'DRAWER_INSUFFICIENT':
      if (context === 'refund_void')
        return `Laci shift itu sekarang berisi ${fmt(extra.drawerCash ?? 0)}, kurang dari uang yang dibatalkan. Tambah uang ke laci lewat Kas laci, atau batalkan setelah shift ditutup (uang keluar dari kas toko).`
      return `Isi paling banyak ${fmt(extra.drawerCash ?? 0)}, atau pilih ${other}.`
    case 'DRAWER_PERMISSION':
      return `Pilih ${other}, atau minta pemilik memberi izin kasir.`
    case 'RETURN_EXCEEDS_BATCH':
      return `Kurangi jumlahnya menjadi paling banyak ${extra.available ?? 0}.`
    case 'PURCHASE_NOT_APPROVED':
      return 'Setujui pembelian dulu.'
    case 'IDEMPOTENCY_KEY_REUSED':
      return 'Muat ulang halaman, lalu catat lagi.'
    case 'REFUND_EXCEEDS_DUE':
      return extra.refundDue ? `Isi paling banyak ${fmt(extra.refundDue)}.` : 'Tidak ada lagi uang yang perlu dikembalikan pemasok.'
    case 'REFUND_RECEIVED':
    case 'RETURN_REFUNDED':
      return `Batalkan dulu uang retur yang diterima (${fmt(extra.refunded ?? 0)}) di riwayat, lalu coba lagi.`
    case 'RETURN_UNDO_BATCH_FULL':
      return 'Periksa stok barang ini, lalu hubungi pemilik.'
    case 'STORE_CASH_INSUFFICIENT':
      return `Kas toko sekarang berisi ${fmt(extra.available ?? 0)}, kurang dari uang yang dibatalkan. Kas toko tidak boleh minus: batalkan setelah kas toko cukup.`
    case 'DRAWER_REFUND_NOT_YOURS':
      return 'Minta kasir shift tempat uang itu masuk, admin, atau pemilik untuk membatalkannya.'
    case 'AGENT_FORBIDDEN':
      return context === 'refund'
        ? 'Catat dari POS sebagai kasir atau pemilik, atau pilih Kas toko.'
        : 'Catat dari POS sebagai kasir atau pemilik.'
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
  /** Undone: when, why and by whom; absent or null while the return stands. */
  reversedAt?: string | null
  reverseReason?: string | null
  reversedByName?: string | null
  /** A stock count (opname) of its products came after it: undoing it adds units on top of that count. */
  countedSince?: boolean
  lines: { orderLineId: string; qty: number; unitCost: number }[]
}
export type Refund = {
  id: string
  amount: number
  destination: RefundDestination
  note: string | null
  actorName: string
  createdAt: string
  voidedAt: string | null
  voidReason: string | null
  drawerReversed: boolean | null
}

export type HistoryRow = {
  key: string
  at: string
  kind: string
  detail: string
  /** Signed: the purchase is +, what lowers the debt is −, a reversal that raises it again is +. Money back: as is. */
  amount: number
  /** Show the + of a reversal. */
  plus?: boolean
  /** The record this row can be undone by: a payment or a refund (voided), a return (undone). */
  undo?: { type: 'payment' | 'return' | 'refund'; id: string }
  voided?: boolean
}

/**
 * The detail's history, oldest first: the purchase itself, each payment (and, once voided, its reversal line: the
 * payment is never removed), each return with what came back (and, once undone, its reversal line), each refund the
 * supplier handed back (and its void). `names` maps an order line id to "Indomie Goreng".
 */
export function historyRows(
  o: { approvedAt: string | null; total: number; lines: { id: string; productName: string; qty: number }[] },
  payments: Payment[],
  returns: Return[],
  fmt: (n: number) => string,
  refunds: Refund[] = [],
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
      undo: { type: 'payment', id: p.id },
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
        plus: true,
      })
  }
  // Money handed back, applied to the returns oldest first: a return's row says what is still to come back.
  let handedBack = refunds.filter((f) => !f.voidedAt).reduce((n, f) => n + f.amount, 0)
  for (const r of returns) {
    const back = Math.min(r.refundDue, handedBack)
    handedBack -= back
    const owed = r.refundDue - back
    const refundText =
      owed > 0 && back > 0
        ? `${fmt(back)} sudah kembali, ${fmt(owed)} masih harus dikembalikan pemasok`
        : owed > 0
          ? `${fmt(owed)} harus dikembalikan pemasok`
          : back > 0
            ? `${fmt(back)} sudah dikembalikan pemasok`
            : null
    const what = r.lines.map((l) => `${l.qty} ${names.get(l.orderLineId) ?? 'barang'}`).join(', ')
    rows.push({
      key: `r-${r.id}`,
      at: r.createdAt,
      kind: 'Retur',
      detail: [what, r.reasonLabel, r.note, refundText]
        .filter(Boolean)
        .join(' · '),
      amount: -r.total,
      undo: { type: 'return', id: r.id },
      voided: !!r.reversedAt,
    })
    if (r.reversedAt)
      rows.push({
        key: `rr-${r.id}`,
        at: r.reversedAt,
        kind: 'Retur dibatalkan',
        detail: [r.reverseReason, 'barang kembali ke stok'].filter(Boolean).join(' · '),
        amount: r.total,
        plus: true,
      })
  }
  for (const f of refunds) {
    const place = f.destination === 'drawer' ? 'masuk laci kasir' : 'masuk kas toko'
    rows.push({
      key: `f-${f.id}`,
      at: f.createdAt,
      kind: 'Uang retur diterima',
      detail: [place, f.note].filter(Boolean).join(' · '),
      amount: f.amount,
      undo: { type: 'refund', id: f.id },
      voided: !!f.voidedAt,
    })
    if (f.voidedAt)
      rows.push({
        key: `fv-${f.id}`,
        at: f.voidedAt,
        kind: 'Uang retur dibatalkan',
        detail: [f.voidReason, f.drawerReversed === true ? 'uang keluar dari laci' : 'uang keluar dari kas toko']
          .filter(Boolean)
          .join(' · '),
        amount: f.amount,
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
