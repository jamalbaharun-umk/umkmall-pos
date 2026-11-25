import { describe, expect, it } from 'vitest'
import { confirmButtonLabel, isStaticQris, payStepOf, qrisScanHint, qrisSrc } from './-pay-step'

describe('payStepOf', () => {
  it('maps each kind to its step', () => {
    expect(payStepOf('cash')).toBe('cash')
    expect(payStepOf('credit')).toBe('kasbon')
    expect(payStepOf('wallet')).toBe('confirm')
    expect(payStepOf('debit')).toBe('confirm')
  })
  it('falls back to cash before a method is chosen', () => {
    expect(payStepOf(undefined)).toBe('cash')
  })
})

describe('static QRIS copy', () => {
  it('only wallet is the store QRIS', () => {
    expect(isStaticQris('wallet')).toBe(true)
    expect(isStaticQris('debit')).toBe(false)
  })
  it('names the amount and the confirm button', () => {
    expect(qrisScanHint('Rp130.536')).toContain('Rp130.536')
    expect(confirmButtonLabel('wallet')).toBe('Sudah diterima')
    expect(confirmButtonLabel('debit')).toBe('Bayar')
    expect(confirmButtonLabel('cash')).toBe('Bayar')
  })
})

describe('qrisSrc', () => {
  it('versions the image url', () => {
    expect(qrisSrc('2026-11-25T01:00:00Z')).toBe('/pengaturan/qris?v=2026-11-25T01%3A00%3A00Z')
  })
})
