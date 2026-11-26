import { describe, expect, it } from 'vitest'
import { bankError, bankRefusalText, bankToSend, banksFor, parseOnlineMethods, confirmButtonLabel, hiddenOnlineNote, isStaticQris, offeredMethods, payStepOf, qrisScanHint, qrisSrc, saleToast } from './-pay-step'

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

describe('hiddenOnlineNote', () => {
  it('says "belum aktif" only when the service answered, and offers a retry only when it did not', () => {
    expect(hiddenOnlineNote(0, false)).toBeNull()
    expect(hiddenOnlineNote(0, true)).toBeNull()
    expect(hiddenOnlineNote(2, false)).toEqual({ text: '2 metode online tidak tampil karena belum aktif di Pembayaran Online toko ini.', retry: false })
    const down = hiddenOnlineNote(2, true)!
    expect(down.text).toBe('Metode online tidak dapat dimuat sekarang (layanan pembayaran tidak menjawab). Coba lagi.')
    expect(down.text).not.toMatch(/belum aktif/)
    expect(down.retry).toBe(true)
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

describe('banks of a virtual account (UMK-2037)', () => {
  const answer = {
    methods: ['fake_qris', 'fake_va'],
    banks: { fake_va: [{ code: 'FAKE', name: 'Bank Fake' }, { code: 'FAKE2', name: 'Bank Fake 2' }, { code: 'bad code!', name: 'x' }, { name: 'no code' }] },
  }
  it('reads the methods as a list of names and the banks by method, dropping malformed banks', () => {
    const r = parseOnlineMethods(answer)
    expect(r.methods).toEqual(['fake_qris', 'fake_va'])
    expect(r.banks).toEqual({ fake_va: [{ code: 'FAKE', name: 'Bank Fake' }, { code: 'FAKE2', name: 'Bank Fake 2' }] })
    expect(parseOnlineMethods(null)).toEqual({ methods: [], banks: {} })
    expect(parseOnlineMethods({ methods: 'x', banks: [] })).toEqual({ methods: [], banks: {} })
  })
  it('only a method with banks asks for one', () => {
    const { banks } = parseOnlineMethods(answer)
    expect(banksFor(banks, 'fake_qris')).toEqual([])
    expect(banksFor(banks, null)).toEqual([])
    const list = banksFor(banks, 'fake_va')
    expect(bankError(list, '')).toMatch(/Pilih bank/)
    expect(bankError(list, 'NOPE')).toMatch(/Pilih bank/)
    expect(bankError(list, 'FAKE2')).toBeUndefined()
    expect(bankError([], '')).toBeUndefined()
  })
  it('sends the chosen bank only when it is one of the method\'s, never a stale one', () => {
    const list = [{ code: 'FAKE', name: 'Bank Fake' }]
    expect(bankToSend(list, 'FAKE')).toBe('FAKE')
    expect(bankToSend(list, 'FAKE2')).toBeNull()
    expect(bankToSend([], 'FAKE')).toBeNull()
  })
  it('each refusal code has its own advice, an unknown one gets the general one', () => {
    expect(bankRefusalText('bank_required')).toMatch(/belum dipilih/)
    expect(bankRefusalText('bank_unknown')).toMatch(/tidak dikenal/)
    expect(bankRefusalText('bank_not_supported')).toMatch(/tidak memakai bank/)
    expect(bankRefusalText(undefined)).toMatch(/Pilih bank lagi/)
  })
})
