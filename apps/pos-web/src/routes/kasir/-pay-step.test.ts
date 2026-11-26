import { describe, expect, it } from 'vitest'
import { confirmButtonLabel, isStaticQris, offeredMethods, payStepOf, qrisScanHint, qrisSrc, saleToast } from './-pay-step'

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

describe('online (payment gateway) methods, UMK-1991', () => {
  it('an online method is its own step and never the store QRIS', () => {
    expect(payStepOf('online')).toBe('online')
    expect(isStaticQris('online')).toBe(false)
  })
  it('the button says what it makes', () => {
    expect(confirmButtonLabel('online', 'fake_qris')).toBe('Tampilkan kode QR')
    expect(confirmButtonLabel('online', 'fake_va')).toBe('Buat nomor VA')
    expect(confirmButtonLabel('wallet')).toBe('Sudah diterima')
  })
  it('offers an online method only while its gateway method is chargeable, and counts the hidden ones', () => {
    const methods = [
      { id: 'a', kind: 'cash' as const },
      { id: 'b', kind: 'online' as const, gatewayMethod: 'fake_qris' },
      { id: 'c', kind: 'online' as const, gatewayMethod: 'fake_va' },
      { id: 'd', kind: 'online' as const, gatewayMethod: null },
    ]
    const r = offeredMethods(methods, ['fake_qris'])
    expect(r.offered.map((m) => m.id)).toEqual(['a', 'b'])
    expect(r.hidden).toBe(2)
    expect(offeredMethods(methods, []).offered.map((m) => m.id)).toEqual(['a'])
  })
})

describe('saleToast', () => {
  const rp = (n: number) => `Rp${n}`
  it('says payment only when money was paid', () => {
    expect(saleToast(50, 0, rp)).toBe('Pembayaran berhasil')
    expect(saleToast(50, null, rp)).toBe('Pembayaran berhasil')
    expect(saleToast(0, 80, rp)).toBe('Kasbon Rp80 dicatat')
    expect(saleToast(30, 50, rp)).toBe('Pembayaran Rp30 diterima. Sisa kasbon Rp50')
  })
})
