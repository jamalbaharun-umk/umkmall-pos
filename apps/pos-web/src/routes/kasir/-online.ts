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
export type Checkout = { qrString: string } | { bank: string; vaNumber: string } | { paymentUrl: string }
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
  saleNumber: number
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
  if (typeof v.vaNumber === 'string' && v.vaNumber) return { bank: str(v.bank) ?? '', vaNumber: v.vaNumber }
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

/** The cancel confirmation's body: a code that cannot be closed at the gateway stays payable until it expires. */
export function cancelBody(p: SalePayment, rupiah: (n: number) => string): string {
  const base = 'Stok dan voucher kembali dan pesanan tetap ada di kasir. Tidak perlu PIN.'
  if (p.canCloseAtGateway) return base
  return `${base} Kode ini tidak bisa ditutup di gateway dan masih bisa dibayar sampai habis waktu. Bila pelanggan tetap membayar, uang ${rupiah(p.amount)} dikembalikan otomatis.`
}

/** Whether the time a sale was paid is worth showing next to the time it was rung up (more than a minute apart). */
export function paidLater(createdAt: string, paidAt: string | null | undefined): boolean {
  if (!paidAt) return false
  const d = new Date(paidAt).getTime() - new Date(createdAt).getTime()
  return Number.isFinite(d) && Math.abs(d) > 60_000
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
export const vaGroups = (va: string) => va.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()

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

// ---- The key of a sale request ----

/**
 * The Idempotency-Key of one sale request: the order's key joined with the payment method and the amount handed over.
 * pos-api answers a known key with another body 422, so a different method (an online sale that got 503, then Tunai)
 * or a different amount must be a different key; the same method and amount (a double tap, a retry) the same one.
 */
export function saleKey(orderKey: string, methodId: string, paid: number): string {
  const part = (v: string) => v.replace(/[^A-Za-z0-9_-]/g, '')
  return `${part(orderKey)}-${part(methodId) || 'm'}-${Number.isFinite(paid) ? Math.max(0, Math.trunc(paid)) : 0}`
}

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

// ---- What happens when a waiting screen ends ----

export type FinishInfo = { kind: 'paid' } | { kind: 'closed'; again: boolean }
export type FinishPlan = { clearCart: boolean; openPay: boolean; renewKey: boolean }

/**
 * What the register does when a waiting screen ends. `own`: the sale was made from the order on this screen. A sale
 * picked from the list belongs to another order (or tablet): its end never wipes, nor reopens payment for, this cart.
 */
export function finishPlan(r: FinishInfo, own: boolean): FinishPlan {
  if (!own) return { clearCart: false, openPay: false, renewKey: false }
  if (r.kind === 'paid') return { clearCart: true, openPay: false, renewKey: true }
  return { clearCart: false, openPay: r.again, renewKey: true }
}

// ---- Resume after a reload ----

export type ResumeAnswer = { ok: true; data: SalePayment } | { ok: false; failure: { status?: number } } | null

export type ResumeDecision =
  /** Still open (or paid and being completed): show the waiting screen. */
  | { do: 'wait'; payment: SalePayment }
  /** Completed while the till was away: forget it and show its receipt; the order is rung up, so an own cart is cleared. */
  | { do: 'completed'; saleId: string; saleNumber: number }
  /** Ended unpaid (cancelled, expired, failed): forget it; the cart, if it is the sale's own, stays for another way to pay. */
  | { do: 'ended'; saleNumber: number }
  /** pos-api says the sale is not ours or does not exist: forget it. */
  | { do: 'forget' }
  /** No usable answer (offline, 503, ...): keep the memory, block new online sales and ask again. */
  | { do: 'retry' }

/** Pure: what a reload does with the sale it remembered, given the one answer of `GET /sales/:id/payment`. */
export function resumeDecision(answer: ResumeAnswer): ResumeDecision {
  if (!answer) return { do: 'retry' }
  if (!answer.ok) return answer.failure.status === 404 || answer.failure.status === 403 ? { do: 'forget' } : { do: 'retry' }
  const p = answer.data
  if (keepPolling(p)) return { do: 'wait', payment: p }
  return p.saleStatus === 'completed'
    ? { do: 'completed', saleId: p.saleId, saleNumber: p.saleNumber }
    : { do: 'ended', saleNumber: p.saleNumber }
}

// ---- Remembering the sale across a reload ----

const PENDING_KEY = 'pos.online-sale'
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const UUID = /^[0-9a-f-]{36}$/i

/**
 * Remember (per tab, like the open bill) a sale that waits for its payment, so a reload shows the waiting screen again.
 * `own`: the order in the register's cart made this sale. Only the id and that flag are kept. Never throws.
 */
export function rememberPending(saleId: string, own: boolean, storage?: StorageLike): void {
  try {
    ;(storage ?? sessionStorage).setItem(PENDING_KEY, JSON.stringify({ id: saleId, own }))
  } catch {
    // private window or blocked storage: the waiting screen just cannot be resumed
  }
}
export function pendingSale(storage?: StorageLike): { id: string; own: boolean } | null {
  try {
    const raw = (storage ?? sessionStorage).getItem(PENDING_KEY)
    if (!raw) return null
    if (UUID.test(raw)) return { id: raw, own: true } // the first format: the id alone
    const v: unknown = JSON.parse(raw)
    return isObject(v) && typeof v.id === 'string' && UUID.test(v.id) ? { id: v.id, own: v.own !== false } : null
  } catch {
    return null
  }
}
export function forgetPending(storage?: StorageLike): void {
  try {
    ;(storage ?? sessionStorage).removeItem(PENDING_KEY)
  } catch {
    // nothing to forget
  }
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
