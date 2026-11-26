import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReceiptMark, receiptMarkTitle } from './-receipt-mark'

const base = { voidedAt: null, voidReasonCode: null, refunded: false }
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
    const out = html({ ...base, status: 'void', refunded: true })
    expect(out).toContain('DIKEMBALIKAN')
    expect(out).not.toContain('DIBATALKAN')
  })
})
