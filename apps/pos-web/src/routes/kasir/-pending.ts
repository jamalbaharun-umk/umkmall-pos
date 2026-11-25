import { isSafeText, type ErrorDescription } from '../../lib/describe-error'
import type { ResumeDecision } from './-online'

// The ONE place that decides what the register remembers about sales that are not finished (UMK-1991): the
// Idempotency-Key of the next POST /sales, the sale written under it, and every sale that still waits for its payment.
// Pure: no React, no storage, no clock, no random (a new key is handed in as `fresh`). The screens only dispatch the
// events below and read the state; `-pending-store.ts` keeps it per tab and is the only reader and writer of its
// storage record.
//
// Two rules carry the money:
//   1. THE KEY CHANGES ONLY WHEN THE SALE UNDER IT IS KNOWN TO BE OVER, or the order visibly moved on from a sale
//      that no customer can pay. A lost answer, a typed amount, a cart edit, "Hapus semua" or a reload never change
//      it, so a sale that was written without this screen knowing is answered again (same order) or refused with 422
//      (another order), never written twice.
//   2. A TRACKED SALE LEAVES THE LIST ONLY ON ITS OWN ANSWER (pos-api said it ended, or its waiting screen was
//      closed after its end). Nothing that happens to another sale or to the cart removes it.
//
// "Own" is not stored: a sale is the cart's own while it was written under the current key. When the key moves on,
// the sale stays tracked and stops being the cart's.
//
// Transition table (state: key K, held H, sales S; "new order" = fresh key, no held, no doubt flags; S is kept):
//
//   event                         | condition                                  | change
//   ------------------------------|--------------------------------------------|------------------------------------------
//   sale_sending(method)          | own sale has a pay code shown               | none (sendPlan answers `blocked`)
//                                 | H online, another method                    | new order (H's sale stays tracked)
//                                 | else                                        | none: same K
//   sale_paid(k)                  | k = K                                       | drop sales under k; new order
//   sale_awaiting(k, id)          |                                             | track id under k, code shown, open
//                                 | answer unreadable                           | ... as `unchecked` (asked again)
//   sale_held(k, id) [503+saleId] | online                                      | track id under k as `held`; H = it
//                                 | cash/EDC                                    | H = it (the job completes it; not listed)
//   sale_cancelled(k, id) [409]   |                                             | drop id; k = K: new order
//   sale_mismatch(k) [422]        | k = K                                       | recorded = true (K kept until acked)
//   sale_unanswered(k) [0, 5xx]   | k = K                                       | unanswered = true (K kept)
//   sale_refused(k) [other 4xx]   |                                             | none
//   cart_edited                   | H online, its code never shown              | new order (sale stays tracked)
//                                 | else                                        | none: K kept
//   order_cleared (Hapus semua)   | own tracked sale, or H online               | new order (sale stays tracked)
//                                 | H cash/EDC                                  | recorded = true (K kept until acked)
//                                 | else                                        | none: K kept
//   recorded_acked                |                                             | new order
//   sale_picked(id) (Menunggu)    | tracked                                     | open, code shown; its key (own) is kept
//                                 | not tracked                                 | track id without a key (never own)
//   sale_finished(id)             | own                                         | drop id; new order
//                                 | not own                                     | drop id only
//   resume_answered(id, wait)     |                                             | open, code shown
//   resume_answered(id, retry)    | [503, offline, timeout]                     | `unreachable`: asked again, never dropped
//   resume_answered(id, completed | own                                         | drop id; new order
//     / ended / forget[404,403])  | not own                                     | drop id only
//   resume_answered(unknown id)   |                                             | none (a late answer changes nothing)
//   set_aside (Lanjut tunai saja) | a sale still needs its check                | aside = true; cleared when none needs one
//   reload                        | `rehydrate`: validated; every sale becomes `unchecked`

export type TrackedPhase =
  /** Written in this page load, its charge got no answer (503 with a sale id): no pay code was shown, nothing to poll. */
  | 'held'
  /** Must be asked from pos-api (after a reload, or an answer that could not be read). */
  | 'unchecked'
  /** Asked, no usable answer (503, offline, timeout): asked again. */
  | 'unreachable'
  /** pos-api said it still waits: it is on a waiting screen (or queued for it). */
  | 'open'

export type Tracked = {
  id: string
  /** The Idempotency-Key it was written under; null for a sale picked from "Menunggu" (another order or tablet). */
  key: string | null
  /** A QR or VA of it was shown, or may have been: a customer can still pay it. */
  shown: boolean
  phase: TrackedPhase
}

export type Held = { saleId: string; methodId: string; online: boolean }

export type PendingState = {
  /** The Idempotency-Key of the next POST /sales. */
  key: string
  /** The sale written under `key` whose charge got no answer (503 with a sale id). */
  held: Held | null
  /** A request under `key` got no answer at all: a sale may exist under it. */
  unanswered: boolean
  /** pos-api refused `key` for another body, or a held cash sale's order was cleared: a sale exists under it. */
  recorded: boolean
  /** Online sales that are not finished, in the order they were first seen. */
  sales: Tracked[]
  /** The sale on the waiting screen. */
  showing: string | null
  /** "Lanjut tunai saja": the gate is put aside while the check keeps asking. */
  aside: boolean
}

export type PendingEvent =
  | { type: 'sale_sending'; methodId: string }
  | { type: 'sale_paid'; key: string }
  | { type: 'sale_awaiting'; key: string; saleId: string; readable: boolean }
  | { type: 'sale_held'; key: string; saleId: string; methodId: string; online: boolean }
  | { type: 'sale_cancelled'; key: string; saleId: string }
  | { type: 'sale_mismatch'; key: string }
  | { type: 'sale_unanswered'; key: string }
  | { type: 'sale_refused'; key: string }
  | { type: 'cart_edited' }
  | { type: 'order_cleared' }
  | { type: 'recorded_acked' }
  | { type: 'sale_picked'; saleId: string }
  | { type: 'sale_finished'; saleId: string }
  | { type: 'resume_answered'; saleId: string; result: ResumeDecision['do'] }
  | { type: 'set_aside' }

export const initialState = (fresh: string): PendingState => ({
  key: fresh,
  held: null,
  unanswered: false,
  recorded: false,
  sales: [],
  showing: null,
  aside: false,
})

// ---- Reading the state ----

const find = (s: PendingState, id: string) => s.sales.find((t) => t.id === id)

/** The tracked sale written under the current key (the order in the cart made it), if any. */
export const ownSale = (s: PendingState): Tracked | undefined => s.sales.find((t) => t.key === s.key)
export const isOwn = (s: PendingState, saleId: string): boolean => find(s, saleId)?.key === s.key
export const isTracked = (s: PendingState, saleId: string): boolean => !!find(s, saleId)

const needsCheck = (t: Tracked) => t.phase === 'unchecked' || t.phase === 'unreachable'
/** The sales pos-api must be asked about, in order. */
export const toCheck = (s: PendingState): string[] => s.sales.filter(needsCheck).map((t) => t.id)
/** While a remembered sale is unchecked no new online sale starts (its code may still be payable); cash never waits. */
export const onlineBlocked = (s: PendingState): boolean => s.sales.some(needsCheck)
/** The blocking "Memeriksa pembayaran sebelumnya" dialog: shown until every check answered, or it was put aside. */
export function gateOf(s: PendingState): 'none' | 'checking' | 'unreachable' {
  if (s.aside || !s.sales.some(needsCheck)) return 'none'
  return s.sales.some((t) => t.phase === 'unreachable') ? 'unreachable' : 'checking'
}
/** An online sale written but never charged still holds its stock until the job closes it. */
export const holdsStock = (s: PendingState): boolean => s.sales.some((t) => t.phase === 'held')

export type SendPlan = { key: string } | { blocked: 'own_sale_open'; saleId: string }

/**
 * The key of a sale request, read when the request is sent (never kept in a closure). Refused while the order's own
 * sale has a pay code a customer may still pay: a second sale of the same order could then be paid twice.
 */
export function sendPlan(s: PendingState): SendPlan {
  const own = ownSale(s)
  if (own?.shown) return { blocked: 'own_sale_open', saleId: own.id }
  return { key: s.key }
}

/** What a sale request does to the state and which key it sends: both a pure function of the state. */
export function planSend(s: PendingState, methodId: string, fresh: string): { state: PendingState; plan: SendPlan } {
  const state = reduce(s, { type: 'sale_sending', methodId }, fresh)
  return { state, plan: sendPlan(state) }
}

export type OrderNotice = 'own_sale_open' | 'recorded' | 'held_same' | null

/** What the pay dialog must tell the cashier before another request is sent. */
export function orderNotice(s: PendingState): OrderNotice {
  if (ownSale(s)?.shown) return 'own_sale_open'
  if (s.recorded) return 'recorded'
  if (s.held && !s.held.online) return 'held_same'
  return null
}

export const OWN_SALE_OPEN_TEXT =
  'Pesanan ini sudah punya penjualan yang masih menunggu pembayaran. Buka dari Menunggu untuk menyelesaikan atau membatalkannya. Untuk pelanggan lain, tekan Hapus semua lalu buat pesanan baru.'
export const HELD_SAME_TEXT =
  'Penjualan ini sudah tersimpan, tetapi pembayarannya belum tercatat. Tekan tombol bayar lagi dengan cara bayar dan jumlah yang sama: penjualan tidak akan tercatat dua kali.'
export const RECORDED_TEXT =
  'Penjualan sebelumnya mungkin sudah tercatat. Cek Riwayat (dan Menunggu) dulu sebelum membuat penjualan lagi. Bila sudah tercatat, jangan dibuat ulang.'
export const HELD_STOCK_HINT =
  'Stok mungkin masih ditahan penjualan online yang belum tertagih. Batalkan penjualan itu dari Menunggu, lalu coba lagi.'

/** pos-api's 422 for a known Idempotency-Key with another body (`sales.service.ts`, `replay`). It carries no code. */
export const KEY_REUSED_TEXT = 'Permintaan berbeda dengan transaksi sebelumnya'

/** The error dialog of that 422: the first sale exists (or may), so the cashier is sent to check before ringing again. */
export function recordedDescription(serverText: string | undefined): ErrorDescription {
  const other = isSafeText(serverText) && serverText !== KEY_REUSED_TEXT && serverText.length <= 160 ? `${serverText.trim().replace(/\.$/, '')}. ` : ''
  return {
    what: `${other}Permintaan ini berbeda dengan yang sudah terkirim dari kasir ini. Penjualan sebelumnya mungkin sudah tercatat.`,
    todo: 'Cek Riwayat dulu. Bila penjualan itu sudah tercatat, jangan dibuat lagi. Untuk pesanan lain, tekan "Buat penjualan baru" di layar pembayaran.',
    code: 'SALE_MAY_EXIST',
    primary: 'none',
  }
}

// ---- The answer of POST /sales as an event ----

export type SaleAnswer =
  | { ok: true; awaiting: false }
  /** `readable`: the answer carried a payment this screen could read (it goes straight to the waiting screen). */
  | { ok: true; awaiting: true; saleId: string; readable: boolean }
  | { ok: false; status: number; saleId?: string; error?: string }

/** Pure: which event an answer of POST /sales is, for the request that was sent (its key, method and kind). */
export function saleAnswerEvent(
  s: PendingState,
  sent: { key: string; methodId: string; online: boolean },
  a: SaleAnswer,
): PendingEvent {
  const { key } = sent
  if (a.ok) return a.awaiting ? { type: 'sale_awaiting', key, saleId: a.saleId, readable: a.readable } : { type: 'sale_paid', key }
  if (a.status === 409 && a.saleId) return { type: 'sale_cancelled', key, saleId: a.saleId }
  if (a.status === 503 && a.saleId) return { type: 'sale_held', key, saleId: a.saleId, methodId: sent.methodId, online: sent.online }
  // Another body under a known key; also any 422 while a sale may exist under the key (the text is pos-api's, not a contract).
  if (a.status === 422 && (a.error === KEY_REUSED_TEXT || (s.key === key && (s.unanswered || s.held !== null))))
    return { type: 'sale_mismatch', key }
  if (a.status === 0 || a.status >= 500) return { type: 'sale_unanswered', key }
  return { type: 'sale_refused', key }
}

// ---- What the register does besides the state change ----

export type FinishInfo = { kind: 'paid' } | { kind: 'closed'; again: boolean }

/**
 * What the register does when a waiting screen ends, read BEFORE `sale_finished` is dispatched. Only the cart's own
 * sale touches the cart: a paid one clears it, one that expired or failed reopens the payment dialog.
 */
export function finishPlan(s: PendingState, saleId: string, r: FinishInfo): { clearCart: boolean; openPay: boolean } {
  if (!isOwn(s, saleId)) return { clearCart: false, openPay: false }
  return r.kind === 'paid' ? { clearCart: true, openPay: false } : { clearCart: false, openPay: r.again }
}

/**
 * What the register does with an answer of the resume check, read BEFORE `resume_answered` is dispatched. `known`
 * false: the sale is no longer tracked (a late answer), so nothing is shown or cleared for it.
 */
export function resumePlan(s: PendingState, saleId: string, result: ResumeDecision['do']): { known: boolean; clearCart: boolean } {
  if (!isTracked(s, saleId)) return { known: false, clearCart: false }
  return { known: true, clearCart: result === 'completed' && isOwn(s, saleId) }
}

// ---- The reducer ----

const newOrder = (s: PendingState, fresh: string): PendingState => ({ ...s, key: fresh, held: null, unanswered: false, recorded: false })
const without = (s: PendingState, id: string): Tracked[] => s.sales.filter((t) => t.id !== id)
const upsert = (s: PendingState, t: Tracked): Tracked[] =>
  find(s, t.id) ? s.sales.map((x) => (x.id === t.id ? t : x)) : [...s.sales, t]

/** Invariants kept after every event. */
function settle(s: PendingState): PendingState {
  let next = s
  // a held sale whose code is now shown is no longer "not charged"
  if (next.held?.online && find(next, next.held.saleId)?.shown) next = { ...next, held: null }
  const shown = next.showing ? find(next, next.showing) : undefined
  if (!shown || shown.phase !== 'open') {
    const first = next.sales.find((t) => t.phase === 'open')
    if ((first?.id ?? null) !== next.showing) next = { ...next, showing: first?.id ?? null }
  }
  if (next.aside && !next.sales.some(needsCheck)) next = { ...next, aside: false }
  return next
}

/** `fresh`: an unused Idempotency-Key, taken only when the event starts a new order. */
export function reduce(state: PendingState, ev: PendingEvent, fresh: string): PendingState {
  return settle(step(state, ev, fresh))
}

function step(s: PendingState, ev: PendingEvent, fresh: string): PendingState {
  switch (ev.type) {
    case 'sale_sending': {
      if (ownSale(s)?.shown) return s
      // An online sale was written but never charged and no code was shown: another method is another sale.
      if (s.held?.online && s.held.methodId !== ev.methodId) return newOrder(s, fresh)
      return s
    }
    case 'sale_paid': {
      const next = { ...s, sales: s.sales.filter((t) => t.key !== ev.key) }
      return ev.key === s.key ? newOrder(next, fresh) : next
    }
    case 'sale_awaiting': {
      const sales = upsert(s, { id: ev.saleId, key: ev.key, shown: true, phase: ev.readable ? 'open' : 'unchecked' })
      return ev.key === s.key ? { ...s, sales, held: null, unanswered: false, recorded: false } : { ...s, sales }
    }
    case 'sale_held': {
      const known = find(s, ev.saleId)
      const sales = !ev.online
        ? s.sales
        : upsert(s, known ? { ...known, key: ev.key } : { id: ev.saleId, key: ev.key, shown: false, phase: 'held' })
      if (ev.key !== s.key) return { ...s, sales }
      return { ...s, sales, held: { saleId: ev.saleId, methodId: ev.methodId, online: ev.online }, unanswered: false, recorded: false }
    }
    case 'sale_cancelled': {
      const next = { ...s, sales: without(s, ev.saleId) }
      return ev.key === s.key ? newOrder(next, fresh) : next
    }
    case 'sale_mismatch':
      return ev.key === s.key ? { ...s, recorded: true, unanswered: false } : s
    case 'sale_unanswered':
      return ev.key === s.key ? { ...s, unanswered: true } : s
    case 'sale_refused':
      return s
    case 'cart_edited': {
      if (s.held?.online && !ownSale(s)?.shown) return newOrder(s, fresh)
      return s
    }
    case 'order_cleared': {
      if (ownSale(s) || s.held?.online) return newOrder(s, fresh)
      if (s.held) return { ...s, recorded: true }
      return s
    }
    case 'recorded_acked':
      return newOrder(s, fresh)
    case 'sale_picked': {
      const known = find(s, ev.saleId)
      const sales = upsert(s, known ? { ...known, shown: true, phase: 'open' } : { id: ev.saleId, key: null, shown: true, phase: 'open' })
      return { ...s, sales, showing: ev.saleId }
    }
    case 'sale_finished': {
      const t = find(s, ev.saleId)
      if (!t) return s
      const next = { ...s, sales: without(s, ev.saleId) }
      return t.key === s.key ? newOrder(next, fresh) : next
    }
    case 'resume_answered': {
      const t = find(s, ev.saleId)
      if (!t) return s
      if (ev.result === 'wait') return { ...s, sales: upsert(s, { ...t, shown: true, phase: 'open' }) }
      if (ev.result === 'retry') return { ...s, sales: upsert(s, { ...t, phase: 'unreachable' }) }
      const next = { ...s, sales: without(s, ev.saleId) }
      return t.key === s.key ? newOrder(next, fresh) : next
    }
    case 'set_aside':
      return s.sales.some(needsCheck) ? { ...s, aside: true } : s
  }
}

// ---- Across a reload ----

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
/** More than a till can have open at once; the rest of a tampered record is dropped. */
export const MAX_TRACKED = 20

/** What is kept per tab: ids, keys and flags only. Never an amount, a QR or a name. */
export function serialize(s: PendingState): string {
  return JSON.stringify({
    v: 1,
    key: s.key,
    held: s.held,
    unanswered: s.unanswered,
    recorded: s.recorded,
    sales: s.sales.map(({ id, key, shown }) => ({ id, key, shown })),
  })
}

function parse(text: string | null): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * The state after a reload, from the stored text (and the record of the earlier format, `{ id, own }` or the id
 * alone). Everything is validated; what does not fit is dropped. Nothing this page load knew survives: every sale
 * must be asked again (`unchecked`), no screen is showing and the gate is not aside. Never throws.
 */
export function rehydrate(text: string | null, legacyText: string | null, fresh: string): PendingState {
  const raw = parse(text)
  let state = initialState(fresh)
  if (isObject(raw) && raw.v === 1 && uuid(raw.key)) {
    const h = raw.held
    const held: Held | null =
      isObject(h) && uuid(h.saleId) && typeof h.methodId === 'string' && h.methodId.length > 0 && h.methodId.length <= 64
        ? { saleId: h.saleId, methodId: h.methodId, online: h.online === true }
        : null
    const sales: Tracked[] = []
    for (const t of Array.isArray(raw.sales) ? raw.sales : []) {
      if (sales.length >= MAX_TRACKED) break
      if (!isObject(t) || !uuid(t.id) || sales.some((x) => x.id === t.id)) continue
      // unknown flags read as the careful value: a code may have been shown
      sales.push({ id: t.id, key: uuid(t.key) ? t.key : null, shown: t.shown !== false, phase: 'unchecked' })
    }
    state = { ...state, key: raw.key, held, unanswered: raw.unanswered === true, recorded: raw.recorded === true, sales }
  }
  const legacy = parse(legacyText)
  const old = uuid(legacy) ? { id: legacy, own: true } : isObject(legacy) && uuid(legacy.id) ? { id: legacy.id, own: legacy.own !== false } : null
  if (old && !find(state, old.id) && state.sales.length < MAX_TRACKED)
    state = { ...state, sales: [...state.sales, { id: old.id, key: old.own ? state.key : null, shown: true, phase: 'unchecked' }] }
  return settle(state)
}
