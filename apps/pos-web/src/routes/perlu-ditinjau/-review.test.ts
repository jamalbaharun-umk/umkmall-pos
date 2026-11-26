import { describe, expect, it } from 'vitest'
import { filterOf, kindLabel, needsReviewOf, parseReview, receiptTodo, refundLabel, saleHasPage } from './-review'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  kind: 'late_payment',
  amount: 5123,
  needsReview: true,
  refundStatus: 'failed',
  receivedAt: '2026-11-26T03:00:00.000Z',
  saleId: 's1',
  saleNumber: 7,
  saleStatus: 'cancelled',
  ...over,
})

describe('"Perlu ditinjau" (UMK-2041)', () => {
  it('reads the answer, copying only the known fields', () => {
    const r = parseReview({
      enabled: true,
      receipts: { items: [row({ paymentId: 'p', feeAmount: 1 }), { id: 'bad' }, null], page: 1, perPage: 20, total: 1 },
      failedRefunds: [{ saleId: 's2', saleNumber: 3, amount: 9000, reasonCode: 'customer_cancelled', requestedAt: 'x' }, { amount: 1 }],
    })!
    expect(r.enabled).toBe(true)
    expect(r.receipts.items).toHaveLength(1)
    expect(r.receipts.items[0]).not.toHaveProperty('paymentId')
    expect(r.receipts.items[0]).toMatchObject({ saleId: 's1', saleNumber: 7, refundStatus: 'failed' })
    expect(r.failedRefunds).toEqual([{ saleId: 's2', saleNumber: 3, amount: 9000, reasonCode: 'customer_cancelled', requestedAt: 'x' }])
    expect(parseReview(null)).toBeNull()
    expect(parseReview({ receipts: {} })).toBeNull()
    // an unknown kind or refund status is not guessed at
    expect(parseReview({ receipts: { items: [row({ kind: 'x', refundStatus: 'y', saleId: null })] } })!.receipts.items[0]).toMatchObject({
      kind: 'unknown',
      refundStatus: 'none',
      saleId: null,
    })
  })

  it('says where each row stands and what to do', () => {
    expect(refundLabel({ refundStatus: 'refunded', needsReview: false })).toEqual({ text: 'Sudah dikembalikan', tone: 'success' })
    expect(refundLabel({ refundStatus: 'pending', needsReview: true }).tone).toBe('warning')
    expect(refundLabel({ refundStatus: 'failed', needsReview: true })).toEqual({ text: 'Pengembalian gagal', tone: 'danger' })
    expect(refundLabel({ refundStatus: 'none', needsReview: true }).text).toBe('Belum dikembalikan')
    expect(receiptTodo({ refundStatus: 'failed', needsReview: true })).toMatch(/manual/)
    expect(receiptTodo({ refundStatus: 'refunded', needsReview: false })).toBe('Tidak perlu tindakan.')
    expect(kindLabel('duplicate')).toBe('Pembayaran ganda')
    expect(kindLabel('amount_mismatch')).toBe('Jumlah tidak cocok')
  })

  it('filters by review state, defaulting to what needs review', () => {
    expect(filterOf(undefined)).toBe('tinjau')
    expect(filterOf('selesai')).toBe('selesai')
    expect(filterOf('x')).toBe('tinjau')
    expect(needsReviewOf('tinjau')).toBe(true)
    expect(needsReviewOf('selesai')).toBe(false)
    expect(needsReviewOf('semua')).toBeUndefined()
  })

  it('links a sale only when it has a receipt page', () => {
    expect(saleHasPage('completed')).toBe(true)
    expect(saleHasPage('void')).toBe(true)
    expect(saleHasPage('cancelled')).toBe(false)
    expect(saleHasPage(null)).toBe(false)
  })
})
