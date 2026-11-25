import { describe, expect, it } from 'vitest'
import { createPendingStore, type PendingIo } from './-pending-store'

// The per-tab store without React or a browser: what it reads, when it writes, and that there is one state however
// many screens (or late answers) use it.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = id(101)
const KEY = 'pos.kasir.pending'
const LEGACY = 'pos.online-sale'

function tab(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed))
  const writes: string[] = []
  let n = 0
  const io: PendingIo = {
    read: (k) => data.get(k) ?? null,
    write: (k, text) => {
      writes.push(text)
      data.set(k, text)
    },
    remove: (k) => void data.delete(k),
    fresh: () => id(++n),
  }
  return { io, data, writes, stored: () => JSON.parse(data.get(KEY) ?? 'null') as Record<string, unknown> | null }
}

describe('createPendingStore', () => {
  it('starts with a key and stores it at once, so a reload sends the same key', () => {
    const t = tab()
    const s = createPendingStore(t.io)
    const key = s.current().key
    expect(t.stored()?.key).toBe(key)
    expect(createPendingStore(t.io).current().key).toBe(key)
  })
  it('stores "a request is out" BEFORE send() returns the key: a reload in the middle of the request finds the doubt', () => {
    const t = tab()
    const s = createPendingStore(t.io)
    const plan = s.send('m-cash')
    expect(plan).toEqual({ key: s.current().key })
    expect(t.stored()?.sending).toBe(true)
    // the page goes away here; the next page load must not send anything under that key unasked
    const next = createPendingStore(t.io)
    expect(next.current().recorded).toBe(true)
    expect(next.send('m-cash')).toEqual({ blocked: 'recorded' })
  })
  it('an answer that arrives after the screen was left and opened again lands in the one state, never over it', () => {
    const t = tab()
    const s = createPendingStore(t.io)
    const plan = s.send('m-qris')
    const key = 'key' in plan ? plan.key : ''
    s.open() // the cashier left the register mid-request and came back: a new screen, the same store
    expect(s.current().recorded).toBe(true)
    // the request is still out in this page load: the cashier is not asked to decide before its answer
    expect(s.current().out).toBe(key)
    s.dispatch({ type: 'recorded_acked' })
    expect(s.current().key).toBe(key)
    // the old screen's request now answers: the sale waits for its payment
    s.dispatch({ type: 'sale_awaiting', key, saleId: A, readable: false })
    expect(s.current().out).toBeNull()
    expect(s.current().sales).toEqual([{ id: A, key, shown: true, phase: 'unchecked' }])
    expect((t.stored()?.sales as unknown[]).length).toBe(1)
    // and a late answer never frees the key by itself
    expect(s.current().recorded).toBe(true)
    expect(s.send('m-cash')).toEqual({ blocked: 'own_sale_open', saleId: A })
  })
  it('open() reads the state as after a reload: every sale is asked again, nothing is dropped', () => {
    const t = tab()
    const s = createPendingStore(t.io)
    s.dispatch({ type: 'sale_picked', saleId: A })
    expect(s.current().showing).toBe(A)
    s.open()
    expect(s.current().showing).toBeNull()
    expect(s.current().sales).toEqual([{ id: A, key: null, shown: true, phase: 'unchecked' }])
  })
  it('tells its listeners of a change, not of the first read and not of an event that changes nothing', () => {
    const t = tab()
    const s = createPendingStore(t.io)
    let told = 0
    const off = s.subscribe(() => told++)
    s.current()
    expect(told).toBe(0)
    s.dispatch({ type: 'set_aside' })
    expect(told).toBe(0)
    s.dispatch({ type: 'sale_picked', saleId: A })
    expect(told).toBe(1)
    off()
    s.dispatch({ type: 'sale_finished', saleId: A })
    expect(told).toBe(1)
  })
  it('reads the record of the first format once and removes it', () => {
    const t = tab({ [LEGACY]: A })
    const s = createPendingStore(t.io)
    expect(s.current().sales.map((x) => x.id)).toEqual([A])
    expect(t.data.has(LEGACY)).toBe(false)
    expect((t.stored()?.sales as unknown[]).length).toBe(1)
  })
  it('works for the page load when storage throws (private window): nothing is remembered, nothing breaks', () => {
    const boom = () => {
      throw new Error('blocked')
    }
    let n = 0
    const s = createPendingStore({ read: boom, write: boom, remove: boom, fresh: () => id(++n) })
    expect(s.durable()).toBe(true) // nothing was written yet
    const key = s.current().key
    expect(s.durable()).toBe(false) // not hidden: the pay dialog warns that a reload forgets a sale in progress
    expect(s.send('m-cash')).toEqual({ key })
    s.dispatch({ type: 'sale_paid', key })
    expect(s.current().key).not.toBe(key)
  })
  it('says so when a write fails later (storage full), and again when writes work', () => {
    const t = tab()
    let full = false
    const s = createPendingStore({ ...t.io, write: (k, text) => (full ? (() => { throw new Error('quota') })() : t.io.write(k, text)) })
    s.current()
    expect(s.durable()).toBe(true)
    full = true
    s.send('m-cash')
    expect(s.durable()).toBe(false)
    expect(t.stored()?.sending).toBe(false) // the doubt did NOT reach storage: that is what the warning is for
    full = false
    s.dispatch({ type: 'sale_unanswered', key: s.current().key })
    expect(s.durable()).toBe(true)
  })
  it('a tampered record starts empty', () => {
    const t = tab({ [KEY]: '{"v":1,"key":"../../x","sales":[{"id":"x"}]}' })
    const s = createPendingStore(t.io)
    expect(s.current().sales).toEqual([])
    expect(s.current().key).toBe(id(1))
  })
})
