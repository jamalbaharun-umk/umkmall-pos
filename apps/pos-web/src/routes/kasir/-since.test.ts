import { describe, expect, it } from 'vitest'
import { advance, freshNews, noticeOf, parsePaidSince, KEEP_KEYS, readSaved, SINCE_KEY, writeSaved, type EndedSale } from './-since'

const rp = (n: number) => `Rp${n}`
const row = (o: Record<string, unknown> = {}) => ({
  id: 'a',
  number: 5,
  receiptNumber: 5,
  holdNumber: 2,
  status: 'completed',
  reason: null,
  total: 5000,
  amountDue: 5000,
  paymentMethod: 'QRIS',
  completedByJob: false,
  onlinePayment: true,
  createdAt: '2026-11-26T03:00:00Z',
  endedAt: '2026-11-26T03:10:00Z',
  ...o,
})
const page = (o: Record<string, unknown> = {}) => ({ data: [row()], hasMore: false, asOf: '2026-11-26T03:09:50.123456Z', afterId: null, ...o })
const sale = (o: Record<string, unknown> = {}) => parsePaidSince(page({ data: [row(o)] }))!.items[0]

describe('parsePaidSince', () => {
  it('reads a page, copying only known fields', () => {
    const p = parsePaidSince(page({ data: [row({ extra: 'x' })] }))!
    expect(p.items).toHaveLength(1)
    expect(p.items[0]).toMatchObject({ id: 'a', receiptNumber: 5, holdNumber: 2, status: 'completed', total: 5000, onlinePayment: true })
    expect('extra' in p.items[0]).toBe(false)
  })
  it('drops rows with an unknown status or no whole-rupiah total; a page without asOf is no page', () => {
    expect(parsePaidSince(page({ data: [row({ status: 'weird' }), row({ total: 1.5 }), row({ id: 3 })] }))!.items).toEqual([])
    expect(parsePaidSince({ data: [] })).toBeNull()
    expect(parsePaidSince(page({ asOf: 'later' }))).toBeNull()
    expect(parsePaidSince(null)).toBeNull()
  })
  it('keeps afterId only with hasMore', () => {
    expect(parsePaidSince(page({ hasMore: true, afterId: 'z' }))!.afterId).toBe('z')
    expect(parsePaidSince(page({ hasMore: false, afterId: 'z' }))!.afterId).toBeNull()
  })
})

describe('advance: the cursor and paging', () => {
  it('while hasMore the cursor is the page end and it asks again at once', () => {
    const r = advance(parsePaidSince(page({ hasMore: true, afterId: 'z', asOf: '2026-11-26T03:00:00.000001Z' }))!)
    expect(r).toEqual({ cursor: { since: '2026-11-26T03:00:00.000001Z', afterId: 'z' }, again: true })
  })
  it('the last page clears afterId and waits for the next poll', () => {
    const r = advance(parsePaidSince(page())!)
    expect(r).toEqual({ cursor: { since: '2026-11-26T03:09:50.123456Z', afterId: null }, again: false })
  })
  it('hasMore without an afterId cannot continue: it stops instead of asking the same page forever', () => {
    expect(advance(parsePaidSince(page({ hasMore: true, afterId: null }))!).again).toBe(false)
  })
})

describe('freshNews: dedupe', () => {
  const a = sale()
  it('shows a sale once even when the overlap of the last page repeats it', () => {
    const seen = new Set<string>()
    expect(freshNews([a, a], seen, new Set())).toHaveLength(1)
    seen.add('a:completed')
    expect(freshNews([a], seen, new Set())).toEqual([])
  })
  it('a refund after the payment is new news for the same sale', () => {
    expect(freshNews([sale({ status: 'void' })], new Set(['a:completed']), new Set())).toHaveLength(1)
  })
  it('a sale this till showed or finished itself is not "while you were away"', () => {
    expect(freshNews([a], new Set(), new Set(['a']))).toEqual([])
  })
})

describe('noticeOf: every status says what it is', () => {
  const n = (o: Record<string, unknown>) => noticeOf(sale(o) as EndedSale, rp)
  it('paid by the customer', () => {
    const x = n({})
    expect(x.title).toBe('Lunas saat Anda pergi')
    expect(x.tone).toBe('success')
    expect(x.body).toMatch(/Struk #5 · Rp5000 lewat QRIS/)
  })
  it('completed by the job says the system did it', () => {
    expect(n({ completedByJob: true, onlinePayment: false, paymentMethod: 'Tunai' }).body).toMatch(/oleh sistem/)
  })
  it('refunded, expired and cancelled are told apart, with the hold number and never a receipt number', () => {
    expect(n({ status: 'void' }).title).toMatch(/direfund/)
    const e = n({ status: 'expired', receiptNumber: null, reason: 'expired' })
    expect(e.title).toBe('Kedaluwarsa')
    expect(e.body).toMatch(/Nomor tunggu #2/)
    expect(e.body).not.toMatch(/Struk/)
    expect(n({ status: 'cancelled', receiptNumber: null, reason: 'failed' }).body).toMatch(/gagal/)
    expect(n({ status: 'cancelled', receiptNumber: null, reason: 'cashier' }).body).toMatch(/dari kasir/)
    expect(n({ status: 'cancelled', receiptNumber: null, reason: 'gateway_refused' }).body).toMatch(/belum boleh menagih/)
    expect(n({ status: 'cancelled', receiptNumber: null, reason: null }).body).toMatch(/tanpa pembayaran/)
  })
})

describe('the remembered record', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
  const rec = { since: '2026-11-26T03:00:00.000Z', afterId: 'z', seen: ['a:completed'], own: ['b'] }
  it('keeps the cursor with its afterId and the keys told in the overlap, and reads them back', () => {
    const s = mem()
    expect(readSaved(s)).toBeNull()
    writeSaved(s, rec)
    expect(readSaved(s)).toEqual(rec)
  })
  it('a remount does not announce again what the overlap repeats (seen and own come back)', () => {
    const s = mem()
    writeSaved(s, rec)
    const back = readSaved(s)!
    const items = [sale(), sale({ id: 'b' })]
    expect(freshNews(items, new Set(back.seen), new Set(back.own))).toEqual([])
  })
  it('reads the first format (a bare time); garbage, a bad time and a missing store read as none', () => {
    const s = mem()
    s.setItem(SINCE_KEY, '2026-11-26T03:00:00.000Z')
    expect(readSaved(s)).toEqual({ since: '2026-11-26T03:00:00.000Z', afterId: null, seen: [], own: [] })
    s.setItem(SINCE_KEY, 'not a time')
    expect(readSaved(s)).toBeNull()
    s.setItem(SINCE_KEY, '{"since":"nope"}')
    expect(readSaved(s)).toBeNull()
    s.setItem(SINCE_KEY, '{broken')
    expect(readSaved(s)).toBeNull()
    expect(readSaved(null)).toBeNull()
  })
  it('keeps only the latest keys and drops non-strings', () => {
    const s = mem()
    const many = Array.from({ length: KEEP_KEYS + 50 }, (_, i) => `k${i}`)
    writeSaved(s, { ...rec, seen: many })
    const back = readSaved(s)!
    expect(back.seen).toHaveLength(KEEP_KEYS)
    expect(back.seen.at(-1)).toBe(`k${KEEP_KEYS + 49}`)
    s.setItem(SINCE_KEY, JSON.stringify({ since: rec.since, seen: [1, 'x', null], own: 'no' }))
    expect(readSaved(s)).toMatchObject({ seen: ['x'], own: [] })
  })
  it('a storage that throws never breaks the till', () => {
    const bad = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } }
    expect(readSaved(bad)).toBeNull()
    expect(() => writeSaved(bad, rec)).not.toThrow()
  })
})
