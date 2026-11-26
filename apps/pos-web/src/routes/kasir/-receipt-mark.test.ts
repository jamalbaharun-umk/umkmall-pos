import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReceiptMark, receiptMarkTitle } from './-receipt-mark'

const base = { voidedAt: null, voidReasonCode: null, refunded: false, refundStatus: null }
const html = (r: Parameters<typeof ReceiptMark>[0]['receipt']) =>
  renderToStaticMarkup(createElement(ReceiptMark, { receipt: r }))

describe('receipt mark', () => {
  it('shows nothing on a completed receipt', () => {
    expect(receiptMarkTitle({ ...base, status: 'completed' })).toBeNull()
    expect(html({ ...base, status: 'completed' })).toBe('')
  })
  it('says DIBATALKAN with reason and time on a voided one', () => {
    const out = html({ ...base, status: 'void', voidReasonCode: 'customer_cancelled', voidedAt: '2026-11-26T03:00:00Z' })
    expect(out).toContain('DIBATALKAN')
    expect(out).not.toContain('DIKEMBALIKAN')
    expect(out).toContain('Pelanggan batal membeli')
    expect(out).toContain('border-4')
  })
  it('says DIKEMBALIKAN on a refunded one', () => {
    const out = html({ ...base, status: 'void', refunded: true, refundStatus: 'succeeded' })
    expect(out).toContain('DIKEMBALIKAN')
    expect(out).not.toContain('DIBATALKAN')
    expect(out).toContain('Struk ini tidak berlaku')
  })
  it('says the refund is on its way, not DIKEMBALIKAN, while the gateway refund is pending', () => {
    const r = { ...base, status: 'void' as const, refundStatus: 'pending' as const }
    expect(receiptMarkTitle(r)).toBe('Refund diproses')
    const out = html(r)
    expect(out).toContain('Refund diproses')
    expect(out).not.toContain('DIKEMBALIKAN')
    expect(out).not.toContain('DIBATALKAN')
    expect(out).toContain('Struk ini tidak berlaku')
  })
  it('tells the cashier to call the owner when the gateway refused the refund', () => {
    const r = { ...base, status: 'void' as const, refundStatus: 'failed' as const }
    expect(receiptMarkTitle(r)).toBe('Refund gagal, hubungi pemilik')
    const out = html(r)
    expect(out).toContain('Refund gagal, hubungi pemilik')
    expect(out).not.toContain('DIKEMBALIKAN')
    expect(out).toContain('Struk ini tidak berlaku')
  })
})
