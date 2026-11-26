// Pure logic of "Perlu ditinjau" (UMK-2041): the owner's list of payment-gateway money that paid no sale (late, a
// second time, another amount) and of refunds the gateway refused. pos-api answers every field; this only reads,
// labels and explains. No React, no I/O.

export { reasonLabel } from '../kasir/-void-helpers'

export type ReceiptKind = 'late_payment' | 'duplicate' | 'amount_mismatch' | 'unknown'
export type ReceiptRefund = 'none' | 'pending' | 'refunded' | 'failed'
export type ReviewReceipt = {
  id: string
  kind: ReceiptKind
  amount: number
  needsReview: boolean
  refundStatus: ReceiptRefund
  receivedAt: string | null
  /** The sale the money came in for, only when it is a sale of this store. */
  saleId: string | null
  saleNumber: number | null
  saleStatus: string | null
}
export type FailedRefund = { saleId: string; saleNumber: number | null; amount: number; reasonCode: string; requestedAt: string }
export type Review = {
  /** false: online payments are off for this POS, so there is nothing from a gateway to review. */
  enabled: boolean
  receipts: { items: ReviewReceipt[]; page: number; perPage: number; total: number }
  failedRefunds: FailedRefund[]
}

export type ReviewFilter = 'semua' | 'tinjau' | 'selesai'
export const FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: 'tinjau', label: 'Perlu ditinjau' },
  { value: 'selesai', label: 'Sudah selesai' },
  { value: 'semua', label: 'Semua' },
]
/** The query pos-api takes for a filter. */
export const needsReviewOf = (f: ReviewFilter): boolean | undefined => (f === 'tinjau' ? true : f === 'selesai' ? false : undefined)
export const filterOf = (v: unknown): ReviewFilter => (v === 'semua' || v === 'selesai' ? v : 'tinjau')

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const int = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined)
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const KINDS: readonly ReceiptKind[] = ['late_payment', 'duplicate', 'amount_mismatch']
const REFUNDS: readonly ReceiptRefund[] = ['none', 'pending', 'refunded', 'failed']

/** Reads pos-api's `GET /payment-review`, copying only the known fields. null when the answer is not one. */
export function parseReview(raw: unknown): Review | null {
  if (!isObject(raw) || !isObject(raw.receipts) || !Array.isArray(raw.receipts.items)) return null
  const r = raw.receipts
  const items = (r.items as unknown[]).flatMap((x): ReviewReceipt[] => {
    if (!isObject(x) || typeof x.id !== 'string' || int(x.amount) === undefined) return []
    return [
      {
        id: x.id,
        kind: KINDS.find((k) => k === x.kind) ?? 'unknown',
        amount: x.amount as number,
        needsReview: x.needsReview === true,
        refundStatus: REFUNDS.find((k) => k === x.refundStatus) ?? 'none',
        receivedAt: str(x.receivedAt) ?? null,
        saleId: str(x.saleId) ?? null,
        saleNumber: int(x.saleNumber) ?? null,
        saleStatus: str(x.saleStatus) ?? null,
      },
    ]
  })
  const failed = Array.isArray(raw.failedRefunds)
    ? raw.failedRefunds.flatMap((x): FailedRefund[] =>
        isObject(x) && typeof x.saleId === 'string' && int(x.amount) !== undefined
          ? [
              {
                saleId: x.saleId,
                saleNumber: int(x.saleNumber) ?? null,
                amount: x.amount as number,
                reasonCode: str(x.reasonCode) ?? '',
                requestedAt: str(x.requestedAt) ?? '',
              },
            ]
          : [],
      )
    : []
  return {
    enabled: raw.enabled === true,
    receipts: { items, page: int(r.page) ?? 1, perPage: int(r.perPage) ?? 50, total: int(r.total) ?? items.length },
    failedRefunds: failed,
  }
}

export function kindLabel(k: ReceiptKind): string {
  switch (k) {
    case 'late_payment':
      return 'Masuk setelah tagihan ditutup'
    case 'duplicate':
      return 'Pembayaran ganda'
    case 'amount_mismatch':
      return 'Jumlah tidak cocok'
    default:
      return 'Pembayaran tanpa penjualan'
  }
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral'

/** Where the money stands: payment-api refunds it by itself; a refused refund is the owner's to settle. */
export function refundLabel(r: Pick<ReviewReceipt, 'refundStatus' | 'needsReview'>): { text: string; tone: Tone } {
  switch (r.refundStatus) {
    case 'refunded':
      return { text: 'Sudah dikembalikan', tone: 'success' }
    case 'pending':
      return { text: 'Sedang dikembalikan', tone: 'warning' }
    case 'failed':
      return { text: 'Pengembalian gagal', tone: 'danger' }
    default:
      return r.needsReview ? { text: 'Belum dikembalikan', tone: 'danger' } : { text: 'Selesai', tone: 'neutral' }
  }
}

/** What the owner does about one row. */
export function receiptTodo(r: Pick<ReviewReceipt, 'refundStatus' | 'needsReview'>): string {
  // A row listed under "Perlu ditinjau" never says "Tidak perlu tindakan", whatever the refund's state.
  if (r.refundStatus === 'refunded')
    return r.needsReview ? 'Uang sudah dikembalikan. Periksa catatan pengembaliannya di gateway.' : 'Tidak perlu tindakan.'
  if (r.refundStatus === 'pending')
    return r.needsReview
      ? 'Gateway sedang mengembalikan uangnya. Tunggu sampai selesai, lalu periksa lagi.'
      : 'Gateway sedang mengembalikan uangnya. Tidak perlu tindakan.'
  if (r.refundStatus === 'failed') return 'Kembalikan uang ke pelanggan secara manual, lalu catat di gateway.'
  return r.needsReview ? 'Hubungi pelanggan dan kembalikan uangnya.' : 'Tidak perlu tindakan.'
}

/** Only a sale that is a receipt (completed or reversed) has a page to open; a cancelled one does not. */
export const saleHasPage = (status: string | null) => status === 'completed' || status === 'void'

const SALE_STATUS: Record<string, string> = {
  completed: 'Selesai',
  void: 'Dibatalkan (void/refund)',
  cancelled: 'Dibatalkan sebelum dibayar',
  awaiting_payment: 'Menunggu pembayaran',
}
export const saleStatusLabel = (s: string | null) => (s ? (SALE_STATUS[s] ?? s) : 'Penjualan tidak dikenal')
