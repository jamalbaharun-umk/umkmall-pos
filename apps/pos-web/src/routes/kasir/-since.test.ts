import { describe, expect, it } from 'vitest'
import { advance, freshNews, noticeOf, parsePaidSince, readSince, SINCE_KEY, writeSince, type EndedSale } from './-since'

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
    expect(e.body).toMatch(/Menunggu #2/)
    expect(e.body).not.toMatch(/Struk/)
    expect(n({ status: 'cancelled', receiptNumber: null, reason: 'failed' }).body).toMatch(/gagal/)
    expect(n({ status: 'cancelled', receiptNumber: null, reason: 'cashier' }).body).toMatch(/dari kasir/)
    expect(n({ status: 'cancelled', receiptNumber: null, reason: 'gateway_refused' }).body).toMatch(/belum boleh menagih/)
    expect(n({ status: 'cancelled', receiptNumber: null, reason: null }).body).toMatch(/tanpa pembayaran/)
  })
})

describe('the remembered cursor', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
  it('is written and read back; garbage and a missing store read as none', () => {
    const s = mem()
    expect(readSince(s)).toBeNull()
    writeSince(s, '2026-11-26T03:00:00.000Z')
    expect(readSince(s)).toBe('2026-11-26T03:00:00.000Z')
    s.setItem(SINCE_KEY, 'not a time')
    expect(readSince(s)).toBeNull()
    expect(readSince(null)).toBeNull()
  })
  it('a storage that throws never breaks the till', () => {
    const bad = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } }
    expect(readSince(bad)).toBeNull()
    expect(() => writeSince(bad, '2026-11-26T03:00:00Z')).not.toThrow()
  })
})
