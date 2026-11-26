// Pure logic of "paid while the till was away" (UMK-2046): `GET /sales/paid-since` tells which waiting sales ended
// meanwhile (paid, refunded, expired, cancelled). The till keeps the `asOf` of its last answer and sends it back; the
// server keeps nothing per device. No React, no I/O, no clock (the time is handed in).
//
// Cursor transitions (one request, then the next):
//
//   answer                         | the till's cursor becomes             | next
//   -------------------------------|---------------------------------------|-----------------------------------------
//   hasMore: true                  | since = asOf, afterId = afterId       | ask again at once (a page is 50 sales)
//   hasMore: false                 | since = asOf (server time less 10 s), | wait for the next poll
//                                  | afterId = null                        |
//   no usable answer               | unchanged                             | wait for the next poll
//
// The last page's `asOf` overlaps the next request on purpose, so the same sale can come again: it is shown once,
// by `id:status` (a sale paid and refunded later is two different news).

export type EndedStatus = 'completed' | 'void' | 'cancelled' | 'expired'
const STATUSES: readonly string[] = ['completed', 'void', 'cancelled', 'expired']

export type EndedSale = {
  id: string
  receiptNumber: number | null
  holdNumber: number | null
  status: EndedStatus
  /** Why a sale was cancelled (`expired`, `failed`, `cashier`, `gateway_refused`, `unpaid`); null when unknown. */
  reason: string | null
  total: number
  amountDue: number
  paymentMethod: string
  /** A cash or EDC sale that the job completed (its payment could not be confirmed when it was rung up). */
  completedByJob: boolean
  onlinePayment: boolean
  createdAt: string
  endedAt: string
}

export type PaidSincePage = { items: EndedSale[]; hasMore: boolean; asOf: string; afterId: string | null }

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const int = (v: unknown) => (Number.isInteger(v) ? (v as number) : null)

/** Reads the answer, copying only known fields. null when it is not a page (no `asOf`): the cursor then stays. */
export function parsePaidSince(raw: unknown): PaidSincePage | null {
  if (!isRec(raw) || typeof raw.asOf !== 'string' || Number.isNaN(Date.parse(raw.asOf)) || !Array.isArray(raw.data)) return null
  const items = raw.data.flatMap((x): EndedSale[] => {
    if (!isRec(x) || typeof x.id !== 'string' || typeof x.status !== 'string' || !STATUSES.includes(x.status)) return []
    const total = int(x.total)
    if (total === null) return []
    return [
      {
        id: x.id,
        receiptNumber: int(x.receiptNumber),
        holdNumber: int(x.holdNumber),
        status: x.status as EndedStatus,
        reason: typeof x.reason === 'string' ? x.reason : null,
        total,
        amountDue: int(x.amountDue) ?? total,
        paymentMethod: typeof x.paymentMethod === 'string' ? x.paymentMethod : '',
        completedByJob: x.completedByJob === true,
        onlinePayment: x.onlinePayment === true,
        createdAt: typeof x.createdAt === 'string' ? x.createdAt : '',
        endedAt: typeof x.endedAt === 'string' ? x.endedAt : '',
      },
    ]
  })
  return {
    items,
    hasMore: raw.hasMore === true,
    asOf: raw.asOf,
    afterId: raw.hasMore === true && typeof raw.afterId === 'string' ? raw.afterId : null,
  }
}

export type Cursor = { since: string; afterId: string | null }

/** The cursor after an answer, and whether to ask again at once. */
export function advance(page: PaidSincePage): { cursor: Cursor; again: boolean } {
  return page.hasMore && page.afterId
    ? { cursor: { since: page.asOf, afterId: page.afterId }, again: true }
    : { cursor: { since: page.asOf, afterId: null }, again: false }
}

export const newsKey = (s: Pick<EndedSale, 'id' | 'status'>) => `${s.id}:${s.status}`

/**
 * What is news: not shown before (by `id:status`, the overlap of the last page repeats sales), and not a sale this
 * screen is showing or has just ended itself (`ownIds`: the cashier saw those).
 */
export function freshNews(items: EndedSale[], seen: ReadonlySet<string>, ownIds: ReadonlySet<string>): EndedSale[] {
  const out: EndedSale[] = []
  const take = new Set<string>()
  for (const s of items) {
    const k = newsKey(s)
    if (seen.has(k) || take.has(k) || ownIds.has(s.id)) continue
    take.add(k)
    out.push(s)
  }
  return out
}

export type Notice = { key: string; tone: 'success' | 'warning' | 'danger'; title: string; body: string }

/** One line of news with a clear status: what happened to which sale, and what it means for the cashier. */
export function noticeOf(s: EndedSale, rupiah: (n: number) => string): Notice {
  const key = newsKey(s)
  const amount = rupiah(s.amountDue)
  const method = s.paymentMethod ? ` lewat ${s.paymentMethod}` : ''
  const receipt = s.receiptNumber !== null ? `Struk #${s.receiptNumber}` : 'Struk'
  const hold = s.holdNumber !== null ? `Nomor tunggu #${s.holdNumber}` : 'Nomor tunggu'
  switch (s.status) {
    case 'completed':
      return {
        key,
        tone: 'success',
        title: 'Lunas saat Anda pergi',
        body: s.completedByJob
          ? `${receipt} · ${amount}${method} sudah dicatat selesai oleh sistem. Tidak perlu diulang.`
          : `${receipt} · ${amount}${method} dibayar pelanggan dan sudah selesai.`,
      }
    case 'void':
      return { key, tone: 'warning', title: 'Dibatalkan dan direfund', body: `${receipt} · ${amount}${method} sudah dibatalkan. Dana dikembalikan lewat gateway.` }
    case 'expired':
      return { key, tone: 'danger', title: 'Kedaluwarsa', body: `${hold} · ${amount}: pelanggan belum membayar sampai batas waktu. Penjualan dibatalkan dan stok kembali.` }
    default:
      return { key, tone: 'danger', title: 'Dibatalkan', body: `${hold} · ${amount}: ${cancelReasonText(s.reason)} Stok dan voucher sudah kembali.` }
  }
}

export function cancelReasonText(reason: string | null): string {
  switch (reason) {
    case 'failed':
      return 'gateway menyatakan pembayaran gagal.'
    case 'cashier':
      return 'dibatalkan dari kasir.'
    case 'gateway_refused':
      return 'toko belum boleh menagih lewat gateway.'
    case 'unpaid':
      return 'tidak ada pembayaran yang tercatat.'
    default:
      return 'penjualan ditutup tanpa pembayaran.'
  }
}

// ---- Where the till remembers its cursor (a convenience: without it only the time the screen opened counts) ----

export const SINCE_KEY = 'pos.kasir.since'
type Store = Pick<Storage, 'getItem' | 'setItem'>

/**
 * What the till keeps: the cursor (`since`, `afterId`) and the keys of what it already told, so a remount, a reload or
 * a tab that was hidden does not announce the same sale again when the last page's overlap (10 s) repeats it.
 * `seen` is `id:status` keys; `own` are sale ids this till showed or ended itself.
 */
export type Saved = { since: string; afterId: string | null; seen: string[]; own: string[] }

/** The most keys kept of each: the overlap is seconds, this is generous and keeps the record small. */
export const KEEP_KEYS = 200

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 80).slice(-KEEP_KEYS) : []

/** The remembered record, or null when there is none or it is not usable. The first format (a bare time) still reads. Never throws. */
export function readSaved(store: Store | null): Saved | null {
  try {
    const raw = store?.getItem(SINCE_KEY) ?? null
    if (!raw) return null
    if (!raw.startsWith('{')) return Number.isNaN(Date.parse(raw)) ? null : { since: raw, afterId: null, seen: [], own: [] }
    const o = JSON.parse(raw) as Record<string, unknown>
    if (typeof o.since !== 'string' || Number.isNaN(Date.parse(o.since))) return null
    return { since: o.since, afterId: typeof o.afterId === 'string' && o.afterId.length <= 80 ? o.afterId : null, seen: strings(o.seen), own: strings(o.own) }
  } catch {
    return null
  }
}

export function writeSaved(store: Store | null, saved: Saved): void {
  try {
    store?.setItem(SINCE_KEY, JSON.stringify({ ...saved, seen: saved.seen.slice(-KEEP_KEYS), own: saved.own.slice(-KEEP_KEYS) }))
  } catch {
    // private window or full storage: the cursor then lives only until the screen closes
  }
}
