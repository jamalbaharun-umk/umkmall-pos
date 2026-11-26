import type { FailureLike } from '@/lib/describe-error'
import { cashRounding, parseRupiah } from './-money'

// Pure logic of the payment-gateway cashier flow (UMK-1991): the shapes pos-api answers on /sales/:id/payment, what a
// state of it means for the waiting screen, the countdown, the cash switch checks, the late-money notices and how a
// refused call becomes the error dialog's input. No React, no I/O. The server owns every status: nothing here decides
// that a payment expired (the countdown only tells the cashier how long the QR itself still lives).

export type PaymentStatus =
  | 'awaiting_payment'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded'
  | 'refund_failed'
  | 'voided'
export type SaleStatus = 'awaiting_payment' | 'completed' | 'void' | 'cancelled'
/** A QR, a virtual account, or (a PG with its own payment page) a link. The server decides which; the screen follows. */
export type Checkout = { qrString: string } | { bank: string; vaNumber: string; /** UMK-2045: the name the customer's bank shows for the account ("a.n."). */ accountName?: string } | { paymentUrl: string }
export type RefundStatus = 'pending' | 'succeeded' | 'failed'
export type LateReceipt = {
  id: string
  attempt: number
  amount: number
  kind: 'late_payment' | 'duplicate' | 'amount_mismatch'
  refundStatus: 'none' | 'pending' | 'refunded' | 'failed'
  needsReview: boolean
}
export type SalePayment = {
  saleId: string
  /** The number to show now (UMK-2038): the receipt number once completed, else the hold number. Read the two below to know which. */
  saleNumber: number
  /** The receipt number: null until the sale is completed (a cancelled sale never gets one). */
  receiptNumber: number | null
  /** The queue number of a sale that waited for its payment; starts again every store day. */
  holdNumber: number | null
  /** UMK-2047: the caller rang this sale up (only its cashier can switch it to cash). `undefined` when the server did not say. */
  mine: boolean | undefined
  saleStatus: SaleStatus
  status: PaymentStatus
  online: boolean
  method: string | null
  paymentMethodName: string
  amount: number
  attempt: number
  checkout: Checkout | null
  expiresAt: string | null
  checkoutExpired: boolean
  lastCheckedAt: string | null
  canCloseAtGateway: boolean
  switchingToCash: boolean
  refund: { status: RefundStatus; sent: boolean; reasonCode: string; note: string | null; requestedAt: string } | null
  lateReceipts: LateReceipt[]
}

/** The waiting screen asks pos-api for the status this often (payment-api asks the PG at most every 5 s itself). */
export const POLL_MS = 3000
// How long a QR or VA lives is never written on a screen: it is the payment's own `expiresAt` (a VA may live longer
// than a QR and the owner has not fixed the value).

const SALE_STATUSES: readonly string[] = ['awaiting_payment', 'completed', 'void', 'cancelled']
const PAYMENT_STATUSES: readonly string[] = [
  'awaiting_payment',
  'paid',
  'expired',
  'failed',
  'cancelled',
  'refund_pending',
  'refunded',
  'refund_failed',
  'voided',
]
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)

function parseCheckout(v: unknown): Checkout | null {
  if (!isObject(v)) return null
  if (typeof v.qrString === 'string' && v.qrString) return { qrString: v.qrString }
  if (typeof v.vaNumber === 'string' && v.vaNumber) {
    const accountName = str(v.accountName)?.trim()
    return { bank: str(v.bank) ?? '', vaNumber: v.vaNumber, ...(accountName ? { accountName: accountName.slice(0, 80) } : {}) }
  }
  // only an https link is ever offered to open or share
  if (typeof v.paymentUrl === 'string' && /^https:\/\/\S+$/.test(v.paymentUrl)) return { paymentUrl: v.paymentUrl }
  return null
}

/**
 * Reads pos-api's SalePayment, copying only the fields this screen knows (an unknown status or a missing id is not
 * guessed at). null when the answer is not a payment, so a screen shows "tidak bisa dimuat" rather than a half state.
 */
export function parsePayment(raw: unknown): SalePayment | null {
  if (!isObject(raw)) return null
  const saleId = str(raw.saleId)
  const saleNumber = int(raw.saleNumber)
  const amount = int(raw.amount)
  const saleStatus = str(raw.saleStatus)
  const status = str(raw.status)
  if (!saleId || saleNumber === undefined || amount === undefined) return null
  if (!saleStatus || !SALE_STATUSES.includes(saleStatus)) return null
  if (!status || !PAYMENT_STATUSES.includes(status)) return null
  const refund = isObject(raw.refund) && ['pending', 'succeeded', 'failed'].includes(String(raw.refund.status))
    ? {
        status: raw.refund.status as RefundStatus,
        sent: raw.refund.sent === true,
        reasonCode: str(raw.refund.reasonCode) ?? '',
        note: str(raw.refund.note) ?? null,
        requestedAt: str(raw.refund.requestedAt) ?? '',
      }
    : null
  const late = Array.isArray(raw.lateReceipts)
    ? raw.lateReceipts.flatMap((r): LateReceipt[] => {
        if (!isObject(r) || typeof r.id !== 'string' || int(r.amount) === undefined) return []
        return [
          {
            id: r.id,
            attempt: int(r.attempt) ?? 1,
            amount: r.amount as number,
            kind: (['late_payment', 'duplicate', 'amount_mismatch'] as const).find((k) => k === r.kind) ?? 'late_payment',
            refundStatus: (['none', 'pending', 'refunded', 'failed'] as const).find((k) => k === r.refundStatus) ?? 'none',
            needsReview: r.needsReview === true,
          },
        ]
      })
    : []
  return {
    saleId,
    saleNumber,
    receiptNumber: int(raw.receiptNumber) ?? null,
    holdNumber: int(raw.holdNumber) ?? null,
    mine: typeof raw.mine === 'boolean' ? raw.mine : undefined,
    saleStatus: saleStatus as SaleStatus,
    status: status as PaymentStatus,
    online: raw.online === true,
    method: str(raw.method) ?? null,
    paymentMethodName: str(raw.paymentMethodName) ?? '',
    amount,
    attempt: int(raw.attempt) ?? 1,
    checkout: parseCheckout(raw.checkout),
    expiresAt: str(raw.expiresAt) ?? null,
    checkoutExpired: raw.checkoutExpired === true,
    lastCheckedAt: str(raw.lastCheckedAt) ?? null,
    canCloseAtGateway: raw.canCloseAtGateway !== false,
    switchingToCash: raw.switchingToCash === true,
    refund,
    lateReceipts: late,
  }
}

// ---- What the waiting screen shows ----

export type Outcome =
  | { kind: 'waiting' }
  /** The customer paid (or the sale was turned into a cash sale that is recorded). `cash` = it was paid in cash. */
  | { kind: 'paid'; cash: boolean; completed: boolean }
  /** The sale is cancelled; stock and voucher are back. `why` is the payment's own end. */
  | { kind: 'closed'; why: 'expired' | 'failed' | 'cancelled' }

/** The waiting screen's state of a payment. `paid` before the sale completes is shown as paid; the next poll completes it. */
export function outcomeOf(p: SalePayment): Outcome {
  if (p.saleStatus === 'completed') return { kind: 'paid', cash: p.method === 'cash', completed: true }
  if (p.saleStatus === 'cancelled') return { kind: 'closed', why: p.status === 'expired' || p.status === 'failed' ? p.status : 'cancelled' }
  if (p.status === 'paid') return { kind: 'paid', cash: false, completed: false }
  if (p.status === 'expired' || p.status === 'failed' || p.status === 'cancelled') return { kind: 'closed', why: p.status }
  // a void or refund state of a sale that is not waiting any more: nothing to wait for
  if (p.saleStatus === 'void') return { kind: 'closed', why: 'cancelled' }
  return { kind: 'waiting' }
}

export const isWaiting = (p: SalePayment) => outcomeOf(p).kind === 'waiting'

/** The screen keeps asking while the payment is open, and while a paid one is not yet a completed sale. */
export function keepPolling(p: SalePayment): boolean {
  const o = outcomeOf(p)
  return o.kind === 'waiting' || (o.kind === 'paid' && !o.completed)
}

/**
 * What a closed sale says. `own` is false for a sale picked from the list of waiting sales: it is not the sale of the
 * order on this screen, so it never says that this order is still at the till.
 */
export function closedText(why: 'expired' | 'failed' | 'cancelled', own = true): { title: string; body: string } {
  switch (why) {
    case 'expired':
      return {
        title: 'Kode kedaluwarsa',
        body: `Pelanggan belum membayar sampai batas waktu. Penjualan dibatalkan dan stok kembali.${own ? ' Pesanan masih ada di kasir: pilih cara bayar lain.' : ''}`,
      }
    case 'failed':
      return {
        title: 'Pembayaran gagal',
        body: `Gateway menolak tagihan. Stok sudah dikembalikan dan tidak ada uang yang ditagih.${own ? ' Isi keranjang tetap ada.' : ''}`,
      }
    default:
      return {
        title: 'Pembayaran dibatalkan',
        body: 'Tagihan ditutup di gateway. Stok dikembalikan. Pembatalan tagihan bukan void: tanpa PIN dan tanpa catatan void.',
      }
  }
}

/**
 * A code whose own time has passed while payment-api still has the payment open. This is NOT "expired": a payment the
 * customer confirmed late still completes the sale. Only the server's closed answer may say expired.
 */
export const OPEN_PAST_CODE_TIME = {
  title: 'Memeriksa pembayaran',
  body: 'Kode ini sudah tidak berlaku untuk pembayaran baru. Status sedang diperiksa: bila pelanggan sudah membayar tepat waktu, penjualan tetap selesai.',
} as const

// ---- Countdown ----

export type Countdown = { text: string; remainingMs: number; over: boolean } | null

/** "14:32" until `expiresAt`; `over` once it has passed. null when there is no time (nothing to count). */
export function countdown(expiresAt: string | null, now: number): Countdown {
  if (!expiresAt) return null
  const end = new Date(expiresAt).getTime()
  if (Number.isNaN(end)) return null
  const remainingMs = Math.max(0, end - now)
  const total = Math.ceil(remainingMs / 1000)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return { text: `${mm}:${ss}`, remainingMs, over: remainingMs === 0 }
}

/** "12.20" in the store's usual way, for "Terakhir dicek". */
export function clockText(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  return t.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
}

// ---- Switch to cash ----

/** What the customer owes in cash: the total rounded up to the next Rp100 (UMK-1993). */
export const cashDue = (amount: number) => amount + cashRounding(amount)

/** Why the cash typed cannot be sent (undefined when it can). The server checks again. */
export function cashSwitchError(text: string, amount: number): string | undefined {
  if (!text.trim()) return 'Wajib diisi: masukkan uang diterima'
  const paid = parseRupiah(text)
  if (Number.isNaN(paid)) return 'Harus bilangan bulat rupiah, misalnya 50.000'
  if (paid < cashDue(amount)) return 'Uang dibayar kurang dari jumlah yang harus dibayar'
  return undefined
}

// ---- Late money and notices ----

/** One line per PG payment that arrived on a closed bill (M5); payment-api refunds it, this only shows where it is. */
export function lateReceiptText(r: LateReceipt, rupiah: (n: number) => string): string {
  const what =
    r.kind === 'duplicate'
      ? `Pembayaran ganda ${rupiah(r.amount)}`
      : r.kind === 'amount_mismatch'
        ? `Pembayaran ${rupiah(r.amount)} dengan jumlah yang tidak cocok`
        : `Pembayaran ${rupiah(r.amount)} masuk setelah tagihan ditutup`
  if (r.refundStatus === 'refunded') return `${what} sudah dikembalikan otomatis ke pelanggan.`
  if (r.refundStatus === 'pending') return `${what} sedang dikembalikan ke pelanggan.`
  if (r.refundStatus === 'failed' || r.needsReview)
    return `${what}. Pengembalian otomatis belum berhasil: beri tahu pemilik untuk ditinjau.`
  return `${what}. Belum dikembalikan: beri tahu pemilik.`
}

/**
 * The cancel confirmation's body: a code that cannot be closed at the gateway stays payable until it expires, and
 * cash already taken for a sale that was turned into cash is recorded nowhere once it is cancelled.
 */
export function cancelBody(p: SalePayment, rupiah: (n: number) => string): string {
  const base = 'Stok dan voucher kembali dan pesanan tetap ada di kasir. Tidak perlu PIN.'
  const cash =
    p.method === 'cash' || p.switchingToCash
      ? ' Uang tunai yang sudah Anda terima untuk penjualan ini tidak akan tercatat: kembalikan ke pelanggan.'
      : ''
  if (p.canCloseAtGateway) return base + cash
  return `${base}${cash} Kode ini tidak bisa ditutup di gateway dan masih bisa dibayar sampai habis waktu. Bila pelanggan tetap membayar, uang ${rupiah(p.amount)} dikembalikan otomatis.`
}

/** Whether the time a sale was paid is worth showing next to the time it was rung up (more than a minute apart). */
export function paidLater(createdAt: string, paidAt: string | null | undefined): boolean {
  if (!paidAt) return false
  const d = new Date(paidAt).getTime() - new Date(createdAt).getTime()
  return Number.isFinite(d) && Math.abs(d) > 60_000
}

/**
 * The badge by the dialog title: a receipt number exists only for a paid sale ("Struk #n", never a hold number); a
 * waiting sale has its hold number ("Menunggu #n"), and so does one that was closed ("Nomor tunggu #n"). A number the
 * server did not give is not made up from the other one.
 */
export function numberBadge(kind: 'waiting' | 'paid' | 'closed', p: Pick<SalePayment, 'receiptNumber' | 'holdNumber'>): string {
  if (kind === 'paid') return p.receiptNumber !== null ? `Struk #${p.receiptNumber}` : 'Struk'
  if (p.holdNumber === null) return kind === 'waiting' ? 'Menunggu' : 'Nomor tunggu'
  return kind === 'waiting' ? `Menunggu #${p.holdNumber}` : `Nomor tunggu #${p.holdNumber}`
}

/** "Struk #n" or, while the receipt number is not there yet, just "Struk". */
export const receiptLabel = (n: number | null | undefined) => (typeof n === 'number' ? `Struk #${n}` : 'Struk')
/** "Nomor tunggu #n": a waiting sale that has ended (closed, expired or cancelled) is no longer "Menunggu". */
export const closedLabel = (n: number | null | undefined) => (typeof n === 'number' ? `Nomor tunggu #${n}` : 'Nomor tunggu')
/** "Menunggu #n" for a sale's hold number. */
export const holdLabel = (n: number | null | undefined) => (typeof n === 'number' ? `Menunggu #${n}` : 'Menunggu')

/** The day and time of a sale in the store's zone ("Kam, 26 Nov 10.15"), for telling two waiting sales of one number apart. */
export function dayTimeText(iso: string): string {
  const day = dayText(iso)
  const time = clockText(iso)
  return day && time ? `${day} ${time}` : ''
}

/** "Kam, 26 Nov" in the store's zone; '' for a time that is not one. */
export function dayText(iso: string): string {
  const t = new Date(iso)
  return Number.isNaN(t.getTime())
    ? ''
    : t.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' })
}

/**
 * Hold numbers start again every store day, so a sale held over midnight can share its number with today's. Only
 * rows whose number is shared get the day and time (by id); the rest need none.
 */
export function holdDisambiguation(rows: { id: string; holdNumber: number | null; createdAt: string }[]): Record<string, string> {
  const count = new Map<number, number>()
  for (const r of rows) if (r.holdNumber !== null) count.set(r.holdNumber, (count.get(r.holdNumber) ?? 0) + 1)
  const out: Record<string, string> = {}
  for (const r of rows) if (r.holdNumber !== null && (count.get(r.holdNumber) ?? 0) > 1) out[r.id] = dayTimeText(r.createdAt)
  return out
}

export const gatewayLabel = (m: string | null | undefined) =>
  m === 'fake_qris' ? 'QRIS online' : m === 'fake_va' ? 'Virtual Account' : 'Pembayaran online'

export const isQris = (c: Checkout | null): c is { qrString: string } => !!c && 'qrString' in c
/** "4 menit" since a sale was rung up, for the list of waiting sales. */
export function waitingFor(createdAt: string, now: number): string {
  const t = new Date(createdAt).getTime()
  if (Number.isNaN(t)) return ''
  const m = Math.max(0, Math.floor((now - t) / 60_000))
  return m < 1 ? 'baru saja' : m < 60 ? `${m} menit` : `${Math.floor(m / 60)} jam`
}

export const isLink = (c: Checkout | null): c is { paymentUrl: string } => !!c && 'paymentUrl' in c

/** A VA number in groups of four, as it is read out and typed: "8077 1234 5678 9012". */
export const vaGroups = (va: string) => vaChunks(va).join(' ')

/** The groups of `vaGroups`, one by one. A lone last digit joins the group before it (UMK-2058): never a line of its own. */
export function vaChunks(va: string): string[] {
  const chunks = va.replace(/\s+/g, '').match(/.{1,4}/g) ?? []
  if (chunks.length > 1 && chunks[chunks.length - 1].length === 1) {
    const last = chunks.pop() as string
    chunks[chunks.length - 1] += last
  }
  return chunks
}

/** Bank names the waiting screen shows for a code (the gateway sends only the code). An unknown code is shown as it is. */
const BANK_NAMES: Record<string, string> = {
  FAKE: 'Bank Fake',
  FAKE2: 'Bank Fake Dua',
  BCA: 'BCA',
  BNI: 'BNI',
  BRI: 'BRI',
  MANDIRI: 'Mandiri',
  PERMATA: 'Permata',
  CIMB: 'CIMB Niaga',
  BSI: 'BSI',
  BJB: 'BJB',
  DANAMON: 'Danamon',
  MAYBANK: 'Maybank',
  SAHABAT_SAMPOERNA: 'Bank Sahabat Sampoerna',
}
export const bankName = (code: string | null | undefined): string => {
  if (!code) return '-'
  return BANK_NAMES[code.toUpperCase()] ?? code
}

/** "3 detik lalu" for the last check; null when there is none. */
export function agoText(iso: string | null, now: number): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const s = Math.max(0, Math.round((now - t) / 1000))
  return s < 60 ? `${s} detik lalu` : `${Math.floor(s / 60)} menit lalu`
}

/**
 * The switch to cash's warning when the gateway cannot close the QR: it stays payable until `expiresAt`, and money that
 * arrives later is refunded by itself (design 26, screen 11). null when the bill can be closed.
 */
export function cashSwitchWarning(p: SalePayment): string | null {
  if (p.canCloseAtGateway) return null
  const until = clockText(p.expiresAt)
  return `Gateway ini tidak bisa menutup kode. Kode masih berlaku${until ? ` sampai ${until}` : ''}. Bila pelanggan tetap membayar, uangnya dikembalikan otomatis dan tampil sebagai pembayaran terlambat.`
}

// ---- Change and paid amount, read from the server's sale ----

/** The money the sale itself recorded (`paid`, `change` of the receipt). null when the answer is not whole rupiah. */
export function paidFigures(raw: unknown): { paid: number; change: number } | null {
  if (!isObject(raw)) return null
  const paid = int(raw.paid)
  const change = int(raw.change)
  if (paid === undefined || change === undefined || paid < 0 || change < 0) return null
  return { paid, change }
}

// ---- A refused sale request ----
// (The Idempotency-Key and the memory of unfinished sales are decided in `-pending.ts`.)

/** A refused sale request: what the error dialog is told. Only an ONLINE sale that was written but not charged is "sale_waiting". */
export function saleFailure(
  status: number,
  code: string | undefined,
  saleId: string | undefined,
  online: boolean,
): { status: number; code: string | undefined } {
  if (status === 503) return { status, code: saleId && online ? 'sale_waiting' : undefined }
  return { status, code }
}

// ---- Resume after a reload ----

export type ResumeAnswer = { ok: true; data: SalePayment } | { ok: false; failure: { status?: number } } | null

export type ResumeDecision =
  /** Still open (or paid and being completed): show the waiting screen. */
  | { do: 'wait'; payment: SalePayment }
  /** Completed while the till was away: forget it and show its receipt; the order is rung up, so an own cart is cleared. */
  | { do: 'completed'; saleId: string; receiptNumber: number | null; amount: number; paymentMethodName: string }
  /** Ended unpaid (cancelled, expired, failed): forget it; the cart, if it is the sale's own, stays for another way to pay. */
  | { do: 'ended'; holdNumber: number | null; receiptNumber: number | null; reversed: boolean }
  /** pos-api says the sale does not exist for this actor (404), or the request can never be answered (other 4xx): forget it and say so. */
  | { do: 'forget' }
  /** No usable answer (offline, 5xx, a 403/408/429 that may pass): keep the memory, block new online sales and ask again. */
  | { do: 'retry' }

/** Pure: what a reload does with the sale it remembered, given the one answer of `GET /sales/:id/payment`. */
export function resumeDecision(answer: ResumeAnswer): ResumeDecision {
  if (!answer) return { do: 'retry' }
  if (!answer.ok) {
    // 404: pos-api hides another cashier's sale the same way as a missing one. A permission (403), a timeout or a
    // rate limit (or a session that ended: the sign-in follows) may pass, so the sale is kept; any other 4xx will never answer, so asking again forever helps nobody.
    const st = answer.failure.status ?? 0
    return st >= 400 && st < 500 && ![401, 403, 408, 429].includes(st) ? { do: 'forget' } : { do: 'retry' }
  }
  const p = answer.data
  if (keepPolling(p)) return { do: 'wait', payment: p }
  return p.saleStatus === 'completed'
    ? { do: 'completed', saleId: p.saleId, receiptNumber: p.receiptNumber, amount: p.amount, paymentMethodName: p.paymentMethodName }
    : { do: 'ended', holdNumber: p.holdNumber, receiptNumber: p.receiptNumber, reversed: p.saleStatus === 'void' || p.status === 'refunded' || p.status === 'refund_pending' || p.status === 'voided' }
}

/**
 * The cash to send for the switch to cash. Once the intent exists (`pending`) pos-api keeps the first amount and only
 * wants the request repeated, so nothing typed is checked or required then (the field is gone after a reload).
 */
export function cashPaidToSend(pending: boolean, text: string, amount: number): { paid: number } | { error: string } {
  if (pending) {
    const typed = parseRupiah(text)
    return { paid: text.trim() && !Number.isNaN(typed) && typed >= cashDue(amount) ? typed : cashDue(amount) }
  }
  const error = cashSwitchError(text, amount)
  return error ? { error } : { paid: parseRupiah(text) }
}

// ---- Errors ----

const CODE = /^[a-z][a-z_]{1,39}$/

/**
 * A refused payment call as the error dialog reads it. `route` tells which call it was, because the same 503 means
 * different things: a switch to cash that got no answer may have closed the bill (check first), while a switch that
 * is already a cash sale needs repeating. Never echoes the server's own text unless pos-api marked it safe (409/422).
 */
export function paymentFailure(
  route: 'poll' | 'check' | 'cash' | 'cancel' | 'refund' | 'retry' | 'manual' | 'sale',
  status: number,
  body: unknown,
): FailureLike {
  const b = isObject(body) ? body : {}
  const raw = str(b.code)
  let code = raw && CODE.test(raw) ? raw : undefined
  const message = str(b.message)
  if (status === 0) return { status: 0 }
  if (status === 503) {
    if (route === 'cash' && (code === 'payment_unavailable' || !code)) code = 'cash_switch_unanswered'
    else if (route === 'sale' && (b.saleId || b.status === 'awaiting_payment')) code = 'sale_waiting'
    // a cancel, a refund retry or a manual mark may have reached payment-api before the answer was lost: never "nothing changed"
    else if (route === 'cancel' || route === 'retry' || route === 'manual' || route === 'refund') code = 'payment_unclear'
    else code ??= 'payment_unavailable'
    return { status, code }
  }
  if (status === 409) return { status, code, error: message }
  if (status === 422) return { status, error: message, code: undefined }
  return { status, code: status === 401 || status === 403 || status === 404 ? undefined : code }
}

// ---- The list of waiting sales ----

/** A sale of the waiting list (`GET /sales?status=awaiting_payment`). */
export type AwaitingSale = {
  id: string
  /** The hold number ("Menunggu #n"); starts again every store day, so two rows can share one (`holdDisambiguation`). */
  holdNumber: number | null
  total: number
  amountDue: number
  createdAt: string
  /** UMK-2047: the caller rang it up; another cashier's sale cannot be switched to cash here. */
  mine: boolean
}

/**
 * Only sales paid through a gateway are listed: a cash or EDC sale that is between its two steps is not something to
 * pick up. The hold number is read from `holdNumber`, never from `number` (a receipt number once completed).
 */
export function parseAwaiting(rows: unknown): AwaitingSale[] {
  if (!Array.isArray(rows)) return []
  return rows.flatMap((x): AwaitingSale[] => {
    if (!isObject(x) || x.onlinePayment !== true || typeof x.id !== 'string') return []
    const total = int(x.total)
    if (total === undefined) return []
    return [
      {
        id: x.id,
        holdNumber: int(x.holdNumber) ?? null,
        total,
        amountDue: int(x.amountDue) ?? total,
        createdAt: str(x.createdAt) ?? '',
        mine: x.mine === true,
      },
    ]
  })
}
