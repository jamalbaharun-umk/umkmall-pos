import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parsePayment, resumeDecision, type ResumeAnswer, type SalePayment } from './-online'
import {
  canAck,
  finishPlan,
  FORGOTTEN_NOTICE,
  gateOf,
  holdsStock,
  initialState,
  isOwn,
  isTracked,
  KEY_REUSED_TEXT,
  MAX_TRACKED,
  onlineBlocked,
  orderNotice,
  ownSale,
  planSend,
  recordedDescription,
  reduce,
  rehydrate,
  reopened,
  resumePlan,
  saleAnswerEvent,
  sendPlan,
  serialize,
  toCheck,
  type PendingEvent,
  type PendingState,
} from './-pending'

// The register's memory of unfinished sales (UMK-1991). One test per event; the scenarios are the ones that wrote a
// second sale or lost a sale in the reviews of PR 27.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const K1 = id(1)
const A = id(101)
const B = id(102)
const QRIS = 'method-qris'
const VA = 'method-va'
const CASH = 'method-cash'
const DEBIT = 'method-debit'

/** A till: the state plus the keys it is handed, in order (K2, K3, ...), so a test can say which key was sent. */
function till(start: PendingState = initialState(K1)) {
  let state = start
  let n = 1
  const next = () => id(++n)
  return {
    get state() {
      return state
    },
    do(...events: PendingEvent[]) {
      for (const ev of events) state = reduce(state, ev, next())
      return state
    },
    /** What `pay()` does first: the key that is sent, or `blocked`. */
    send(methodId: string) {
      const r = planSend(state, methodId, next())
      state = r.state
      return 'key' in r.plan ? r.plan.key : 'blocked'
    },
    /** Which key a request with this method would send now, without sending it. */
    peek(methodId: string) {
      const r = planSend(state, methodId, id(999))
      return 'key' in r.plan ? r.plan.key : r.plan.blocked
    },
    /** A request goes out and pos-api refuses it cleanly (a field, stock): nothing was written. */
    refused(methodId: string) {
      const key = this.send(methodId)
      if (key !== 'blocked') this.do({ type: 'sale_refused', key })
      return key
    },
    reload() {
      state = rehydrate(serialize(state), null, next())
      return state
    },
  }
}

const payment = (over: Record<string, unknown> = {}) =>
  parsePayment({
    saleId: A,
    saleNumber: 12,
    saleStatus: 'awaiting_payment',
    status: 'awaiting_payment',
    online: true,
    method: 'fake_qris',
    paymentMethodName: 'QRIS',
    amount: 5000,
    attempt: 1,
    checkout: { qrString: '000201' },
    expiresAt: '2026-11-25T10:15:00.000Z',
    ...over,
  }) as SalePayment
const resumed = (answer: ResumeAnswer) => resumeDecision(answer).do

describe('the key is a pure function of the state', () => {
  it('a new till sends its key for any method, and the same state always sends the same key', () => {
    const s = initialState(K1)
    expect(sendPlan(s)).toEqual({ key: K1 })
    expect(planSend(s, CASH, id(9)).plan).toEqual({ key: K1 })
    expect(planSend(s, QRIS, id(9)).plan).toEqual({ key: K1 })
    expect(planSend(s, CASH, id(9))).toEqual(planSend(s, CASH, id(8)))
  })
  it('a request that goes out is in doubt from before it is sent until its answer', () => {
    const t = till()
    expect(t.send(CASH)).toBe(K1)
    expect(t.state.sending).toBe(true)
    expect(JSON.parse(serialize(t.state)).sending).toBe(true)
    t.do({ type: 'sale_refused', key: K1 })
    expect(t.state).toEqual(initialState(K1))
  })
})

describe('online 503 with a sale id (written, not charged)', () => {
  const held = () => {
    const t = till()
    expect(t.send(QRIS)).toBe(K1)
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true })
    return t
  }
  it('remembers the sale as the cart\'s own and repeats the same method with the same key: never a second sale', () => {
    const t = held()
    expect(t.state.held).toEqual({ saleId: A, methodId: QRIS, online: true })
    expect(t.state.sales).toEqual([{ id: A, key: K1, shown: false, phase: 'held' }])
    expect(isOwn(t.state, A)).toBe(true)
    expect(holdsStock(t.state)).toBe(true)
    expect(t.send(QRIS)).toBe(K1)
    expect(t.send(QRIS)).toBe(K1)
    // nothing to poll and nothing blocked: no code was shown
    expect(toCheck(t.state)).toEqual([])
    expect(onlineBlocked(t.state)).toBe(false)
  })
  it('another method is another sale under a new key, and the first sale stays remembered', () => {
    const t = held()
    const k2 = t.send(CASH)
    expect(k2).not.toBe(K1)
    expect(t.state.held).toBeNull()
    expect(isTracked(t.state, A)).toBe(true)
    expect(isOwn(t.state, A)).toBe(false)
  })
  it('the error dialog\'s "Coba lagi" after QRIS 503 then cash 503 sends the cash sale\'s key again (review 3, major 1)', () => {
    const t = held()
    const k2 = t.send(CASH)
    t.do({ type: 'sale_held', key: k2, saleId: B, methodId: CASH, online: false })
    // the retry is an older closure of pay(): it holds nothing, the key is read from the state when it runs
    expect(t.send(CASH)).toBe(k2)
    expect(t.send(CASH)).toBe(k2)
    // and QRIS then VA: the VA sale's key is repeated too
    const u = held()
    const v2 = u.send(VA)
    u.do({ type: 'sale_held', key: v2, saleId: B, methodId: VA, online: true })
    expect(u.send(VA)).toBe(v2)
    expect(u.state.sales.map((x) => x.id)).toEqual([A, B])
  })
  it('the repeat that is answered with the bill puts the sale on the waiting screen', () => {
    const t = held()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    expect(t.state.held).toBeNull()
    expect(t.state.sales).toEqual([{ id: A, key: K1, shown: true, phase: 'open' }])
    expect(t.state.showing).toBe(A)
    expect(holdsStock(t.state)).toBe(false)
  })
})

describe('online 503 without a sale id, or no answer at all', () => {
  it('the same order repeated at once keeps the key, whatever the method: a sale that was written is replayed or refused, never doubled', () => {
    const t = till()
    t.send(QRIS)
    t.do({ type: 'sale_unanswered', key: K1 })
    expect(t.state.unanswered).toBe(true)
    expect(t.state.sending).toBe(false)
    expect(t.send(QRIS)).toBe(K1)
    t.do({ type: 'sale_unanswered', key: K1 })
    expect(t.send(CASH)).toBe(K1)
  })
  it('a clean refusal (422 of a field, 409 stock) leaves no doubt and changes nothing else', () => {
    const t = till()
    expect(t.refused(CASH)).toBe(K1)
    expect(t.state).toEqual(initialState(K1))
    t.do({ type: 'cart_edited' }, { type: 'order_cleared' })
    expect(t.state).toEqual(initialState(K1))
    // but it does not clear the doubt an earlier unanswered request left
    t.do({ type: 'sale_unanswered', key: K1 })
    t.refused(CASH)
    expect(t.state.unanswered).toBe(true)
  })
})

describe('the next customer\'s identical order is never answered with a lost sale (review 4, major)', () => {
  // Sale 1 was written but its answer was lost. Under the kept key an identical next order would replay sale 1 as
  // "Pembayaran berhasil": two customers paid, one sale recorded. So once the order is no longer surely the same one,
  // nothing is sent under that key until the cashier checked Riwayat.
  const lost = () => {
    const t = till()
    t.send(CASH)
    t.do({ type: 'sale_unanswered', key: K1 })
    return t
  }
  const mustCheckFirst = (t: ReturnType<typeof till>) => {
    expect(t.state.recorded).toBe(true)
    expect(orderNotice(t.state)).toBe('recorded')
    expect(sendPlan(t.state)).toEqual({ blocked: 'recorded' })
    expect(t.send(CASH)).toBe('blocked')
    expect(t.send(DEBIT)).toBe('blocked')
    expect(t.state.key).toBe(K1) // the key is not thrown away either: only the cashier's answer moves on
    t.do({ type: 'recorded_acked' })
    expect(t.state.recorded).toBe(false)
    expect(t.state.unanswered).toBe(false)
    const k = t.send(CASH)
    expect(k).not.toBe('blocked')
    expect(k).not.toBe(K1)
  }
  it('lost answer, Hapus semua, same items again', () => {
    const t = lost()
    t.do({ type: 'order_cleared' })
    mustCheckFirst(t)
  })
  it('lost answer, the cart edited into the next order by hand', () => {
    const t = lost()
    t.do({ type: 'cart_edited' })
    mustCheckFirst(t)
  })
  it('lost answer, then a reload', () => {
    const t = lost()
    t.reload()
    mustCheckFirst(t)
  })
  it('a reload in the middle of the request: the doubt was stored before the request went out', () => {
    const t = till()
    expect(t.send(CASH)).toBe(K1)
    // no answer event at all: the page went away
    t.reload()
    expect(t.state.sending).toBe(false)
    expect(t.state.unanswered).toBe(true)
    mustCheckFirst(t)
  })
  it('a request still out when the order is cleared (the answer comes after the screen moved on)', () => {
    const t = till()
    t.send(CASH)
    t.do({ type: 'order_cleared' })
    expect(t.send(CASH)).toBe('blocked')
    // the late answer settles it: paid means that order is done, and a new one starts
    t.do({ type: 'sale_paid', key: K1 })
    expect(t.state).toEqual(initialState(t.state.key))
    expect(t.state.key).not.toBe(K1)
  })
  it('the corrected amount or method of the same order (422 of a used key) asks for the same check (review 3, major 4)', () => {
    const t = lost()
    expect(t.send(CASH)).toBe(K1)
    const ev = saleAnswerEvent(t.state, { key: K1, methodId: CASH, online: false }, { ok: false, status: 422, error: KEY_REUSED_TEXT })
    expect(ev).toEqual({ type: 'sale_mismatch', key: K1 })
    t.do(ev)
    expect(t.state.sending).toBe(false)
    t.reload()
    mustCheckFirst(t)
  })
  it('the dialog of that 422 tells the cashier to check Riwayat first and never offers a retry', () => {
    const d = recordedDescription(KEY_REUSED_TEXT)
    expect(d.what).toMatch(/Penjualan sebelumnya mungkin sudah tercatat/)
    expect(d.todo).toMatch(/Cek Riwayat dulu/)
    expect(d.primary).toBe('none')
    // another 422 text is kept in front of the warning; an unsafe one is not shown
    expect(recordedDescription('Uang dibayar kurang').what).toMatch(/^Uang dibayar kurang\. Permintaan ini berbeda/)
    expect(recordedDescription('select * from sales').what).toMatch(/^Permintaan ini berbeda/)
  })
})

describe('an answer that arrives after the order was cleared, edited or reopened (review 5, major B)', () => {
  // The request is out; the cashier clears the order (or leaves and returns), so `recorded` is set. The late answer
  // tells what happened to the sale, never that the order on screen is that sale's order.
  const cleared = () => {
    const t = till()
    expect(t.send(CASH)).toBe(K1)
    t.do({ type: 'order_cleared' })
    expect(t.state.recorded).toBe(true)
    return t
  }
  const stillChecked = (t: ReturnType<typeof till>) => {
    expect(t.state.recorded).toBe(true)
    expect(t.state.key).toBe(K1)
    expect(t.send(CASH)).toBe('blocked')
    expect(canAck(t.state)).toBe(true)
  }
  it('a late 503 with a sale id (held) does not reopen sending under the key', () => {
    const t = cleared()
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: CASH, online: false })
    expect(t.state.held).toEqual({ saleId: A, methodId: CASH, online: false })
    stillChecked(t)
  })
  it('a late online 503 with a sale id keeps the sale tracked and still sends nothing', () => {
    const t = cleared()
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true })
    expect(isTracked(t.state, A)).toBe(true)
    stillChecked(t)
  })
  it('a late "no answer" does not either', () => {
    const t = cleared()
    t.do({ type: 'sale_unanswered', key: K1 })
    stillChecked(t)
  })
  it('a late clean refusal does not either: an earlier request under the key may still have written', () => {
    const t = cleared()
    t.do({ type: 'sale_refused', key: K1 })
    expect(t.state.sending).toBe(false)
    stillChecked(t)
  })
  it('a late bill puts the sale on its waiting screen; the order is free again only when that sale ends', () => {
    const t = cleared()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    expect(t.state.recorded).toBe(true)
    expect(t.send(CASH)).toBe('blocked')
    t.do({ type: 'sale_finished', saleId: A })
    expect(t.state.recorded).toBe(false)
    expect(t.send(CASH)).not.toBe('blocked')
  })
  it('the same after the register was left and opened again mid-request', () => {
    const t = till()
    t.send(CASH)
    const back = reopened(t.state, id(50))
    expect(back.recorded).toBe(true)
    const late = reduce(back, { type: 'sale_held', key: K1, saleId: A, methodId: CASH, online: false }, id(51))
    expect(late.recorded).toBe(true)
    expect(sendPlan(late)).toEqual({ blocked: 'recorded' })
  })
})

describe('"Sudah saya cek" waits for a request that is still out in this page load', () => {
  it('is refused until the answer came, also after the register was left and opened again', () => {
    const t = till()
    t.send(CASH)
    t.do({ type: 'order_cleared' })
    expect(canAck(t.state)).toBe(false)
    const before = t.state
    expect(t.do({ type: 'recorded_acked' })).toBe(before)
    const back = reopened(t.state, id(50))
    expect(back.out).toBe(K1)
    expect(canAck(back)).toBe(false)
    expect(reduce(back, { type: 'recorded_acked' }, id(51))).toBe(back)
    const answered = reduce(back, { type: 'sale_unanswered', key: K1 }, id(52))
    expect(answered.out).toBeNull()
    expect(canAck(answered)).toBe(true)
    expect(reduce(answered, { type: 'recorded_acked' }, id(53)).key).toBe(id(53))
  })
  it('a real reload forgets "out" (the request is gone with the page), and it is never stored', () => {
    const t = till()
    t.send(CASH)
    expect(JSON.parse(serialize(t.state)).out).toBeUndefined()
    t.reload()
    expect(t.state.out).toBeNull()
    expect(canAck(t.state)).toBe(true)
  })
  it('every answer of that request ends "out"; an answer of another key does not', () => {
    for (const ev of [
      { type: 'sale_paid', key: K1 },
      { type: 'sale_refused', key: K1 },
      { type: 'sale_unanswered', key: K1 },
      { type: 'sale_mismatch', key: K1 },
      { type: 'sale_cancelled', key: K1, saleId: A },
      { type: 'sale_held', key: K1, saleId: A, methodId: CASH, online: false },
      { type: 'sale_awaiting', key: K1, saleId: A, readable: true },
    ] as PendingEvent[]) {
      const t = till()
      t.send(CASH)
      expect(t.state.out).toBe(K1)
      t.do({ type: 'sale_refused', key: id(77) })
      expect(t.state.out).toBe(K1)
      t.do(ev)
      expect(t.state.out, ev.type).toBeNull()
    }
  })
})

describe('cash 503 with a sale id (the job completes it)', () => {
  const held = () => {
    const t = till()
    t.send(CASH)
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: CASH, online: false })
    return t
  }
  it('is not listed as a waiting online sale, and the untouched order repeats under the same key whatever the method, also after a reload', () => {
    const t = held()
    expect(t.state.sales).toEqual([])
    expect(t.state.sending).toBe(false)
    expect(orderNotice(t.state)).toBe('held_same')
    expect(t.peek(CASH)).toBe(K1)
    expect(t.peek(DEBIT)).toBe(K1)
    expect(t.peek(QRIS)).toBe(K1)
    expect(t.reload().held).toEqual({ saleId: A, methodId: CASH, online: false })
    expect(t.peek(CASH)).toBe(K1)
  })
  it('a cart edited by hand (the minus button, not Hapus semua) is no longer surely that sale\'s order: nothing is sent under its key until the cashier checked (review 5, major A)', () => {
    // the job completes sale 1; the next customer's order, edited into the same items, must not be answered with it
    const t = held()
    t.do({ type: 'cart_edited' })
    expect(t.state.key).toBe(K1)
    expect(t.state.recorded).toBe(true)
    expect(orderNotice(t.state)).toBe('recorded')
    expect(t.peek(CASH)).toBe('recorded')
    expect(t.send(CASH)).toBe('blocked')
    t.do({ type: 'recorded_acked' })
    const k = t.send(CASH)
    expect(k).not.toBe('blocked')
    expect(k).not.toBe(K1)
  })
  it('Hapus semua keeps the key and says a sale exists, until the cashier says it was checked', () => {
    const t = held()
    t.do({ type: 'order_cleared' })
    expect(t.state.key).toBe(K1)
    expect(orderNotice(t.state)).toBe('recorded')
    expect(t.send(CASH)).toBe('blocked')
    t.do({ type: 'recorded_acked' })
    expect(t.state.key).not.toBe(K1)
    expect(orderNotice(t.state)).toBeNull()
  })
})

describe('saleAnswerEvent: the answer of POST /sales as an event', () => {
  const s = initialState(K1)
  const sent = { key: K1, methodId: QRIS, online: true }
  it('reads each answer', () => {
    expect(saleAnswerEvent(s, sent, { ok: true, awaiting: false })).toEqual({ type: 'sale_paid', key: K1 })
    expect(saleAnswerEvent(s, sent, { ok: true, awaiting: true, saleId: A, readable: true })).toEqual({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    expect(saleAnswerEvent(s, sent, { ok: false, status: 503, saleId: A })).toEqual({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true })
    expect(saleAnswerEvent(s, sent, { ok: false, status: 503 })).toEqual({ type: 'sale_unanswered', key: K1 })
    expect(saleAnswerEvent(s, sent, { ok: false, status: 0 })).toEqual({ type: 'sale_unanswered', key: K1 })
    expect(saleAnswerEvent(s, sent, { ok: false, status: 500 })).toEqual({ type: 'sale_unanswered', key: K1 })
    expect(saleAnswerEvent(s, sent, { ok: false, status: 409, saleId: A })).toEqual({ type: 'sale_cancelled', key: K1, saleId: A })
    expect(saleAnswerEvent(s, sent, { ok: false, status: 409 })).toEqual({ type: 'sale_refused', key: K1 })
    expect(saleAnswerEvent(s, sent, { ok: false, status: 403 })).toEqual({ type: 'sale_refused', key: K1 })
  })
  it('a 422 is "a sale exists" for pos-api\'s own text, and for any text while a sale may exist under the key', () => {
    expect(saleAnswerEvent(s, sent, { ok: false, status: 422, error: 'Uang dibayar kurang' }).type).toBe('sale_refused')
    expect(saleAnswerEvent(s, sent, { ok: false, status: 422, error: KEY_REUSED_TEXT }).type).toBe('sale_mismatch')
    expect(saleAnswerEvent({ ...s, unanswered: true }, sent, { ok: false, status: 422, error: 'teks lain' }).type).toBe('sale_mismatch')
    const held = { ...s, held: { saleId: A, methodId: CASH, online: false } }
    expect(saleAnswerEvent(held, sent, { ok: false, status: 422, error: 'teks lain' }).type).toBe('sale_mismatch')
    // an answer for another key says nothing about this one
    expect(saleAnswerEvent({ ...s, unanswered: true }, { ...sent, key: id(7) }, { ok: false, status: 422, error: 'teks lain' }).type).toBe('sale_refused')
  })
})

describe('paid', () => {
  it('starts a new order under a new key', () => {
    const t = till()
    t.send(CASH)
    t.do({ type: 'sale_paid', key: K1 })
    expect(t.state).toEqual(initialState(id(3)))
  })
  it('a cash sale that is paid never forgets another sale (review 3, major 2)', () => {
    const t = till()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    t.reload()
    t.do({ type: 'resume_answered', saleId: A, result: 'retry' }, { type: 'set_aside' }, { type: 'order_cleared' })
    const k = t.send(CASH)
    expect(k).not.toBe('blocked')
    t.do({ type: 'sale_paid', key: k })
    expect(isTracked(t.state, A)).toBe(true)
    expect(toCheck(t.state)).toEqual([A])
    expect(onlineBlocked(t.state)).toBe(true)
  })
  it('a held sale that the repeat finds paid is forgotten with its key', () => {
    const t = till()
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true }, { type: 'sale_paid', key: K1 })
    expect(t.state.sales).toEqual([])
    expect(t.state.key).not.toBe(K1)
  })
  it('an answer for an older key leaves the current order alone', () => {
    const t = till()
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true })
    const k2 = t.send(CASH)
    t.do({ type: 'sale_paid', key: K1 })
    expect(t.state.key).toBe(k2)
    expect(t.state.sales).toEqual([])
  })
})

describe('a sale the gateway refused (409 with a sale id)', () => {
  it('is cancelled for good: forgotten, and the next request gets a new key', () => {
    const t = till()
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true }, { type: 'sale_cancelled', key: K1, saleId: A })
    expect(t.state).toEqual(initialState(id(3)))
  })
})

describe('a sale that waits for its payment', () => {
  it('is tracked as the cart\'s own with its code shown, and is the one on screen', () => {
    const t = till()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    expect(ownSale(t.state)).toEqual({ id: A, key: K1, shown: true, phase: 'open' })
    expect(t.state.showing).toBe(A)
  })
  it('one whose payment could not be read is never "paid": it is asked for again', () => {
    const t = till()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: false })
    expect(toCheck(t.state)).toEqual([A])
    expect(t.state.showing).toBeNull()
    expect(gateOf(t.state)).toBe('checking')
  })
  it('no second sale of the same order is sent while its code can still be paid', () => {
    const t = till()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    expect(t.send(CASH)).toBe('blocked')
    expect(sendPlan(t.state)).toEqual({ blocked: 'own_sale_open', saleId: A })
    expect(orderNotice(t.state)).toBe('own_sale_open')
    expect(t.state.key).toBe(K1)
  })
})

describe('the waiting screen ends (sale_finished)', () => {
  const waiting = () => {
    const t = till()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    return t
  }
  it('own and paid: the cart is cleared and a new order starts', () => {
    const t = waiting()
    expect(finishPlan(t.state, A, { kind: 'paid' })).toEqual({ clearCart: true, openPay: false })
    t.do({ type: 'sale_finished', saleId: A })
    expect(t.state).toEqual(initialState(id(3)))
  })
  it('own and ended unpaid: the cart stays, payment reopens only when asked, and the spent key is replaced', () => {
    const t = waiting()
    expect(finishPlan(t.state, A, { kind: 'closed', again: true })).toEqual({ clearCart: false, openPay: true })
    expect(finishPlan(t.state, A, { kind: 'closed', again: false })).toEqual({ clearCart: false, openPay: false })
    t.do({ type: 'sale_finished', saleId: A })
    expect(t.state.key).not.toBe(K1)
  })
  it('a sale that is not the cart\'s touches neither the cart, the key nor another sale', () => {
    const t = waiting()
    t.do({ type: 'sale_picked', saleId: B })
    expect(finishPlan(t.state, B, { kind: 'paid' })).toEqual({ clearCart: false, openPay: false })
    expect(finishPlan(t.state, B, { kind: 'closed', again: true })).toEqual({ clearCart: false, openPay: false })
    t.do({ type: 'sale_finished', saleId: B })
    expect(t.state.key).toBe(K1)
    expect(t.state.sales).toEqual([{ id: A, key: K1, shown: true, phase: 'open' }])
    expect(t.state.showing).toBe(A)
  })
  it('a sale that is not tracked changes nothing', () => {
    const t = waiting()
    const before = t.state
    expect(t.do({ type: 'sale_finished', saleId: B })).toBe(before)
  })
})

describe('Hapus semua (order_cleared)', () => {
  it('with nothing sent keeps the key', () => {
    const t = till()
    expect(t.do({ type: 'order_cleared' }).key).toBe(K1)
  })
  it('gives up the order, never the sale made from it: the sale stays remembered and checked, no longer the cart\'s (review 3, major 2)', () => {
    const t = till()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    t.reload()
    t.do({ type: 'resume_answered', saleId: A, result: 'retry' }, { type: 'set_aside' })
    expect(t.send(CASH)).toBe('blocked') // the same order cannot be rung again while A may still be paid
    t.do({ type: 'order_cleared' })
    expect(t.state.key).not.toBe(K1)
    expect(t.state.sales).toEqual([{ id: A, key: K1, shown: true, phase: 'unreachable' }])
    expect(isOwn(t.state, A)).toBe(false)
    expect(t.send(CASH)).toBe(t.state.key)
    // a late "completed" for A no longer clears the new cart
    expect(resumePlan(t.state, A, 'completed')).toEqual({ known: true, clearCart: false })
  })
  it('after an online 503 the uncharged sale stays remembered under its own key', () => {
    const t = till()
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true }, { type: 'order_cleared' })
    expect(t.state.key).not.toBe(K1)
    expect(t.state.held).toBeNull()
    expect(t.state.sales).toEqual([{ id: A, key: K1, shown: false, phase: 'held' }])
  })
})

describe('a cart edit (cart_edited)', () => {
  it('with nothing sent keeps the key', () => {
    const t = till()
    const before = t.state
    expect(t.do({ type: 'cart_edited' })).toBe(before)
  })
  it('after an online 503 is another sale: new key, and the uncharged sale is no longer the cart\'s (a reload does not resume it as own)', () => {
    const t = till()
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true }, { type: 'cart_edited' })
    expect(t.state.key).not.toBe(K1)
    expect(isOwn(t.state, A)).toBe(false)
    t.reload()
    expect(isOwn(t.state, A)).toBe(false)
    expect(toCheck(t.state)).toEqual([A])
  })
  it('never frees the order from a sale whose code may still be paid', () => {
    const t = till()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    t.reload()
    t.do({ type: 'resume_answered', saleId: A, result: 'retry' }, { type: 'set_aside' }, { type: 'cart_edited' })
    expect(t.state.key).toBe(K1)
    expect(t.send(CASH)).toBe('blocked')
  })
})

describe('picking a sale from Menunggu (sale_picked)', () => {
  it('another sale is tracked next to the cart\'s own, never instead of it (review 3, major 3)', () => {
    const t = till()
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true }, { type: 'sale_picked', saleId: B })
    expect(t.state.sales.map((x) => x.id)).toEqual([A, B])
    expect(isOwn(t.state, A)).toBe(true)
    expect(isOwn(t.state, B)).toBe(false)
    expect(t.state.showing).toBe(B)
    // a reload still knows whose sale is whose
    t.reload()
    expect(isOwn(t.state, A)).toBe(true)
    expect(isOwn(t.state, B)).toBe(false)
  })
  it('the cart\'s own sale picked from the list is still the cart\'s own: paid clears the cart and renews the key', () => {
    const t = till()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    t.reload()
    t.do({ type: 'resume_answered', saleId: A, result: 'retry' }, { type: 'set_aside' }, { type: 'sale_picked', saleId: A })
    expect(t.state.sales).toEqual([{ id: A, key: K1, shown: true, phase: 'open' }])
    expect(t.state.showing).toBe(A)
    expect(finishPlan(t.state, A, { kind: 'paid' })).toEqual({ clearCart: true, openPay: false })
    t.do({ type: 'sale_finished', saleId: A })
    expect(t.state.key).not.toBe(K1)
    expect(t.state.sales).toEqual([])
  })
  it('a held sale that is picked now has its code on screen: the order is bound to it', () => {
    const t = till()
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true }, { type: 'sale_picked', saleId: A })
    expect(t.state.held).toBeNull()
    expect(t.send(CASH)).toBe('blocked')
  })
})

describe('the check of a remembered sale (resume_answered)', () => {
  const afterReload = (own = true) => {
    const t = till()
    if (own) t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    else t.do({ type: 'sale_picked', saleId: A })
    t.reload()
    expect(t.state.sales[0].phase).toBe('unchecked')
    expect(gateOf(t.state)).toBe('checking')
    return t
  }
  it('ok, still open: the waiting screen comes back and online sales are free again', () => {
    const t = afterReload()
    const d = resumed({ ok: true, data: payment() })
    expect(d).toBe('wait')
    t.do({ type: 'resume_answered', saleId: A, result: d })
    expect(t.state.sales).toEqual([{ id: A, key: K1, shown: true, phase: 'open' }])
    expect(t.state.showing).toBe(A)
    expect(gateOf(t.state)).toBe('none')
    expect(onlineBlocked(t.state)).toBe(false)
  })
  it('ok, completed while away: forgotten; the cart is cleared and the key renewed only for the cart\'s own sale', () => {
    const d = resumed({ ok: true, data: payment({ saleStatus: 'completed', status: 'paid' }) })
    expect(d).toBe('completed')
    const t = afterReload()
    expect(resumePlan(t.state, A, d)).toEqual({ known: true, clearCart: true })
    t.do({ type: 'resume_answered', saleId: A, result: d })
    expect(t.state.sales).toEqual([])
    expect(t.state.key).not.toBe(K1)
    const u = afterReload(false)
    expect(resumePlan(u.state, A, d)).toEqual({ known: true, clearCart: false })
    u.do({ type: 'resume_answered', saleId: A, result: d })
    expect(u.state.sales).toEqual([])
    expect(u.state.key).toBe(K1)
  })
  it('ended unpaid: forgotten, the cart stays, and the spent key of an own sale is replaced', () => {
    const d = resumed({ ok: true, data: payment({ saleStatus: 'cancelled', status: 'expired' }) })
    expect(d).toBe('ended')
    const t = afterReload()
    expect(resumePlan(t.state, A, d)).toEqual({ known: true, clearCart: false })
    t.do({ type: 'resume_answered', saleId: A, result: d })
    expect(t.state.sales).toEqual([])
    expect(t.state.key).not.toBe(K1)
  })
  it.each([404, 400, 422])('%i: not this account\'s sale, gone, or a request that can never be answered: forgotten (the register says so)', (status) => {
    const d = resumed({ ok: false, failure: { status } })
    expect(d).toBe('forget')
    const t = afterReload()
    t.do({ type: 'resume_answered', saleId: A, result: d })
    expect(t.state.sales).toEqual([])
    expect(gateOf(t.state)).toBe('none')
  })
  it.each([503, 0, 500, 403, 408, 429])('%i or no answer: never forgotten, online sales stay blocked, asked again', (status) => {
    const d = resumed({ ok: false, failure: { status } })
    expect(d).toBe('retry')
    const t = afterReload()
    t.do({ type: 'resume_answered', saleId: A, result: d })
    expect(t.state.sales).toEqual([{ id: A, key: K1, shown: true, phase: 'unreachable' }])
    expect(toCheck(t.state)).toEqual([A])
    expect(onlineBlocked(t.state)).toBe(true)
    expect(gateOf(t.state)).toBe('unreachable')
    expect(resumed(null)).toBe('retry')
  })
  it('a late answer about a sale that is no longer tracked changes and clears nothing', () => {
    const t = till()
    const before = t.state
    expect(resumePlan(t.state, A, 'completed')).toEqual({ known: false, clearCart: false })
    expect(t.do({ type: 'resume_answered', saleId: A, result: 'completed' })).toBe(before)
  })
  it('one sale ending never ends another', () => {
    const t = till()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true }, { type: 'sale_picked', saleId: B })
    t.reload()
    t.do({ type: 'resume_answered', saleId: B, result: 'ended' })
    expect(t.state.sales).toEqual([{ id: A, key: K1, shown: true, phase: 'unchecked' }])
    expect(onlineBlocked(t.state)).toBe(true)
  })
})

describe('an uncharged online sale the order moved on from', () => {
  const left = () => {
    const t = till()
    t.send(QRIS)
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true })
    const k2 = t.send(CASH)
    t.do({ type: 'sale_paid', key: k2 })
    return t
  }
  it('is asked about in the background, without the gate and without blocking online sales', () => {
    const t = left()
    expect(toCheck(t.state)).toEqual([A])
    expect(gateOf(t.state)).toBe('none')
    expect(onlineBlocked(t.state)).toBe(false)
    expect(holdsStock(t.state)).toBe(true)
  })
  it('while it is the cart\'s own it is not asked about: the same method simply repeats it', () => {
    const t = till()
    t.do({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true })
    expect(toCheck(t.state)).toEqual([])
  })
  it('still open or unreachable changes nothing: no code was shown, so none is shown now', () => {
    const t = left()
    const before = t.state
    expect(t.do({ type: 'resume_answered', saleId: A, result: 'wait' })).toBe(before)
    expect(t.do({ type: 'resume_answered', saleId: A, result: 'retry' })).toBe(before)
    expect(t.state.showing).toBeNull()
  })
  it('once it ended it is forgotten, so the "stock is held" hint does not linger', () => {
    const t = left()
    const key = t.state.key
    t.do({ type: 'resume_answered', saleId: A, result: 'ended' })
    expect(t.state.sales).toEqual([])
    expect(holdsStock(t.state)).toBe(false)
    expect(t.state.key).toBe(key)
  })
})

describe('the cart was changed by hand after its own sale was written', () => {
  const editedWhileAside = () => {
    const t = till()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    t.reload()
    t.do({ type: 'resume_answered', saleId: A, result: 'retry' }, { type: 'set_aside' }, { type: 'cart_edited' })
    return t
  }
  it('the sale completing in the background no longer clears the cart; the key is still renewed', () => {
    const t = editedWhileAside()
    expect(t.state.edited).toBe(true)
    expect(t.reload().edited).toBe(true)
    expect(resumePlan(t.state, A, 'completed')).toEqual({ known: true, clearCart: false })
    expect(finishPlan(t.state, A, { kind: 'paid' })).toEqual({ clearCart: false, openPay: false })
    t.do({ type: 'resume_answered', saleId: A, result: 'completed' })
    expect(t.state.key).not.toBe(K1)
    expect(t.state.edited).toBe(false)
  })
  it('an untouched cart is still cleared', () => {
    const t = till()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    t.reload()
    expect(resumePlan(t.state, A, 'completed')).toEqual({ known: true, clearCart: true })
  })
})

describe('a remembered sale that is not this account\'s', () => {
  it('is said once, with no retry', () => {
    expect(FORGOTTEN_NOTICE.what).toMatch(/tidak bisa dibuka dengan akun Anda/)
    expect(FORGOTTEN_NOTICE.todo).toMatch(/Menunggu dan Riwayat/)
    expect(FORGOTTEN_NOTICE.primary).toBe('none')
  })
})

describe('"Lanjut tunai saja" (set_aside)', () => {
  const aside = () => {
    const t = till()
    t.do({ type: 'sale_picked', saleId: A })
    t.reload()
    t.do({ type: 'resume_answered', saleId: A, result: 'retry' }, { type: 'set_aside' })
    return t
  }
  it('only puts the dialog aside: the sale stays remembered, checked and blocking online sales', () => {
    const t = aside()
    expect(t.state.aside).toBe(true)
    expect(gateOf(t.state)).toBe('none')
    expect(toCheck(t.state)).toEqual([A])
    expect(onlineBlocked(t.state)).toBe(true)
  })
  it('cash sales, cart edits and Hapus semua while aside never drop it', () => {
    const t = aside()
    const k = t.send(CASH)
    t.do({ type: 'sale_paid', key: k as string }, { type: 'cart_edited' }, { type: 'order_cleared' }, { type: 'resume_answered', saleId: A, result: 'retry' })
    expect(toCheck(t.state)).toEqual([A])
    expect(t.state.aside).toBe(true)
    expect(t.reload().sales.map((x) => x.id)).toEqual([A])
  })
  it('ends when the sale is resolved, so the next unchecked sale blocks again', () => {
    const t = aside()
    t.do({ type: 'resume_answered', saleId: A, result: 'ended' })
    expect(t.state.aside).toBe(false)
    expect(onlineBlocked(t.state)).toBe(false)
  })
  it('does nothing when no sale needs a check', () => {
    const t = till()
    const before = t.state
    expect(t.do({ type: 'set_aside' })).toBe(before)
  })
})

describe('a reload (rehydrate)', () => {
  it('keeps the key, the held sale, the doubt flags and every sale; nothing of the page load survives', () => {
    const t = till()
    t.do(
      { type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true },
      { type: 'sale_picked', saleId: B },
      { type: 'sale_unanswered', key: K1 },
    )
    const before = t.state
    const after = t.reload()
    expect(after.key).toBe(before.key)
    expect(after.held).toEqual(before.held)
    expect(after.unanswered).toBe(true)
    expect(after.sales).toEqual([
      { id: A, key: K1, shown: false, phase: 'unchecked' },
      { id: B, key: null, shown: true, phase: 'unchecked' },
    ])
    expect(after.showing).toBeNull()
    expect(after.aside).toBe(false)
    // the same method still repeats the held sale; after a reload it is checked first
    expect(onlineBlocked(after)).toBe(true)
  })
  it('stores ids, keys and flags only', () => {
    const t = till()
    t.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    expect(JSON.parse(serialize(t.state))).toEqual({
      v: 1,
      key: K1,
      held: null,
      sending: false,
      unanswered: false,
      recorded: false,
      edited: false,
      sales: [{ id: A, key: K1, shown: true }],
    })
  })
  it('starts empty with a new key on nothing, garbage or another version, and never throws', () => {
    const empty = initialState(id(5))
    for (const text of [null, '', 'x', '{', 'null', '[]', '42', '"../../x"', JSON.stringify({ v: 2, key: K1 }), JSON.stringify({ v: 1, key: 'no-uuid' }), JSON.stringify({ v: 1 })])
      expect(rehydrate(text, null, id(5))).toEqual(empty)
  })
  it('drops what is not a real id, a repeated sale and whatever is over the limit', () => {
    const many = Array.from({ length: MAX_TRACKED + 5 }, (_, i) => ({ id: id(500 + i), key: null, shown: true }))
    const text = JSON.stringify({
      v: 1,
      key: K1,
      held: { saleId: '../../x', methodId: QRIS, online: true },
      recorded: 'yes',
      sales: [{ id: 'a'.repeat(36) }, null, 7, { id: A, key: 'bad' }, { id: A, key: K1, shown: false }, ...many],
    })
    const s = rehydrate(text, null, id(5))
    expect(s.key).toBe(K1)
    expect(s.held).toBeNull()
    expect(s.recorded).toBe(false)
    expect(s.sales).toHaveLength(MAX_TRACKED)
    // a bad key reads as "not the cart's", a missing flag as "a code may have been shown"
    expect(s.sales[0]).toEqual({ id: A, key: null, shown: true, phase: 'unchecked' })
  })
  it('reads the record of the earlier format once (the id alone, or { id, own })', () => {
    const own = rehydrate(null, A, id(5))
    expect(own.sales).toEqual([{ id: A, key: id(5), shown: true, phase: 'unchecked' }])
    expect(isOwn(own, A)).toBe(true)
    const picked = rehydrate(null, JSON.stringify({ id: A, own: false }), id(5))
    expect(isOwn(picked, A)).toBe(false)
    expect(toCheck(picked)).toEqual([A])
    expect(rehydrate(null, JSON.stringify({ id: 'a'.repeat(36), own: true }), id(5)).sales).toEqual([])
    // already known: not added twice
    const text = JSON.stringify({ v: 1, key: K1, sales: [{ id: A, key: K1, shown: true }] })
    expect(rehydrate(text, A, id(5)).sales).toHaveLength(1)
  })
})

describe('guard: one place remembers unfinished sales', () => {
  const dir = dirname(fileURLToPath(import.meta.url))
  const sources = readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))
    .map((f) => ({ f, text: readFileSync(join(dir, f), 'utf8') }))
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  it('only the pending store and the open bill touch browser storage', () => {
    const users = sources.filter((s) => /\b(sessionStorage|localStorage)\b/.test(code(s.text))).map((s) => s.f)
    expect(users.sort()).toEqual(['-cart.ts', '-pending-store.ts'])
  })
  it('the register and the waiting screens make no key and hold none: they dispatch and read the state', () => {
    for (const f of ['index.tsx', '-online-pay.tsx']) {
      const text = code(sources.find((s) => s.f === f)!.text)
      expect(text, f).not.toMatch(/randomUUID|idempotencyKey|pos\.online-sale|pos\.kasir\.pending/)
    }
    expect(code(sources.find((s) => s.f === 'index.tsx')!.text)).toMatch(/pend\.send\(methodId\)/)
  })
  it('pay() asks the store for the key (which stores "a request is out") BEFORE the one createSale call, and sends that key', () => {
    const text = code(sources.find((s) => s.f === 'index.tsx')!.text)
    const start = text.indexOf('async function pay(')
    const body = text.slice(start, text.indexOf('const notice = orderNotice', start))
    expect(start).toBeGreaterThan(-1)
    const send = body.indexOf('pend.send(methodId)')
    const create = body.indexOf('createSale(')
    expect(send).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(send)
    expect(body.split('createSale(').length - 1).toBe(1)
    expect(body.split('pend.send(').length - 1).toBe(1)
    expect(body).toMatch(/const sendKey = plan\.key/)
    expect(body.slice(create)).toMatch(/^createSale\(\{\s*data: \{\s*key: sendKey,/)
    // and nothing is sent when the store says no
    expect(body.slice(send, create)).toMatch(/if \('blocked' in plan\) return/)
  })
  it('the reducer is pure: no storage, clock or random in it', () => {
    const text = code(sources.find((s) => s.f === '-pending.ts')!.text)
    expect(text).not.toMatch(/sessionStorage|localStorage|randomUUID|Date\.now|new Date|Math\.random|from 'react'/)
  })
})

describe('rehydrate takes a fresh key when nothing may exist under the stored one (UMK-2050)', () => {
  it('a clean state: a reload or a reopened register sends a new key', () => {
    const s = initialState(K1)
    expect(rehydrate(serialize(s), null, id(2)).key).toBe(id(2))
    expect(reopened(s, id(3)).key).toBe(id(3))
  })
  it('keeps the key with doubt, a held sale or a tracked sale', () => {
    const t = till()
    t.send(CASH)
    expect(rehydrate(serialize(t.state), null, id(9)).key).toBe(K1) // a request was out
    t.do({ type: 'sale_unanswered', key: K1 })
    expect(rehydrate(serialize(t.state), null, id(9)).key).toBe(K1)
    const h = till()
    h.send(QRIS)
    h.do({ type: 'sale_held', key: K1, saleId: A, methodId: QRIS, online: true })
    expect(rehydrate(serialize(h.state), null, id(9)).key).toBe(K1)
    const w = till()
    w.send(QRIS)
    w.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    w.do({ type: 'sale_finished', saleId: A })
    const open = till()
    open.send(QRIS)
    open.do({ type: 'sale_awaiting', key: K1, saleId: A, readable: true })
    expect(rehydrate(serialize(open.state), null, id(9)).key).toBe(K1)
  })
  it('keeps the key of a sale of the earlier storage format', () => {
    expect(rehydrate(serialize(initialState(K1)), JSON.stringify({ id: A, own: true }), id(9)).key).toBe(K1)
  })
  it('a recorded state keeps its key too', () => {
    expect(rehydrate(serialize({ ...initialState(K1), recorded: true }), null, id(9)).key).toBe(K1)
  })
})
