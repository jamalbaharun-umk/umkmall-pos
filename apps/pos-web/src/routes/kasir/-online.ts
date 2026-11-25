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
export type Checkout = { qrString: string } | { bank: string; vaNumber: string }
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
/** A QR or VA lives 15 minutes; only used for the copy, the real time is `expiresAt`. */
export const VALID_MINUTES = 15

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

export function closedText(why: 'expired' | 'failed' | 'cancelled'): { title: string; body: string } {
  switch (why) {
    case 'expired':
      return {
        title: 'Waktu pembayaran habis',
        body: 'Pelanggan belum membayar sampai batas waktu. Penjualan dibatalkan dan stok kembali. Pesanan masih ada di kasir: pilih cara bayar lain atau buat kode baru.',
      }
    case 'failed':
      return {
        title: 'Pembayaran gagal',
        body: 'Pembayaran ditolak atau gagal. Penjualan dibatalkan dan stok kembali. Pesanan masih ada di kasir: coba lagi atau pilih cara bayar lain.',
      }
    default:
      return {
        title: 'Penjualan dibatalkan',
        body: 'Penjualan dibatalkan sebelum dibayar. Stok dan voucher sudah kembali. Pesanan masih ada di kasir.',
      }
  }
}

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
  m === 'fake_qris' ? 'QRIS dinamis (tiruan)' : m === 'fake_va' ? 'Virtual Account (tiruan)' : 'Pembayaran online'

export const isQris = (c: Checkout | null): c is { qrString: string } => !!c && 'qrString' in c

// ---- Resume after a reload ----

const PENDING_KEY = 'pos.online-sale'
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Remember (per tab, like the open bill) a sale that waits for its payment, so a reload shows the waiting screen again. Never throws. */
export function rememberPending(saleId: string, storage?: StorageLike): void {
  try {
    ;(storage ?? sessionStorage).setItem(PENDING_KEY, saleId)
  } catch {
    // private window or blocked storage: the waiting screen just cannot be resumed
  }
}
export function pendingSale(storage?: StorageLike): string | null {
  try {
    const v = (storage ?? sessionStorage).getItem(PENDING_KEY)
    return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null
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
    else code ??= 'payment_unavailable'
    return { status, code }
  }
  if (status === 409) return { status, code, error: message }
  if (status === 422) return { status, error: message, code: undefined }
  return { status, code: status === 401 || status === 403 || status === 404 ? undefined : code }
}
