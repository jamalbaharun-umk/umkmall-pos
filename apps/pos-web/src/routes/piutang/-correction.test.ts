import { describe, expect, it } from 'vitest'
import {
  cashEffect,
  cashNotice,
  correctionBody,
  correctionErrors,
  correctionReasonLabel,
  correctionToast,
  correctionTodo,
  fieldErrorsOf,
  paidFromBook,
  restAfterCorrection,
  rowStatus,
  signedRupiah,
  type CorrectionForm,
} from './-correction'

const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`

const form = (f: Partial<CorrectionForm> = {}): CorrectionForm => ({
  mode: 'replace',
  amount: 3000,
  methodId: 'tunai',
  reasonCode: 'wrong_amount',
  note: '',
  approverId: 'owner',
  pin: '482913',
  ...f,
})

describe('koreksi kasbon helpers (UMK-1971)', () => {
  it('the design example: Rp6.000 kasbon, Rp2.500 corrected to Rp3.000 leaves Rp3.000; cancelling leaves Rp6.000', () => {
    expect(restAfterCorrection(3500, 2500, 3000)).toBe(3000)
    expect(restAfterCorrection(5000, 1000, null)).toBe(6000)
    // Dibayar = payments − reversals, from the book.
    expect(paidFromBook([{ amount: 1000 }, { amount: -1000 }, { amount: 2500 }, { amount: -2500 }, { amount: 3000 }])).toBe(3000)
  })

  it('labels the three history rows as the design does', () => {
    expect(rowStatus('active')).toEqual({ label: 'Aktif', color: 'success' })
    expect(rowStatus('reversed').label).toBe('Dibatalkan')
    expect(rowStatus('reversal').label).toBe('Pembalik')
    expect(signedRupiah(-1000, rp)).toBe('−Rp1.000')
    expect(signedRupiah(2500, rp)).toBe('Rp2.500')
    expect(correctionReasonLabel('wrong_amount')).toBe('Salah jumlah')
    expect(correctionReasonLabel(null)).toBe('Koreksi')
  })

  it('checks the form in pos-api’s words before sending', () => {
    const old = { amount: 2500, methodId: 'tunai' }
    expect(correctionErrors(form(), 3500, old)).toEqual({})
    expect(correctionErrors(form({ amount: 6001 }), 3500, old).amount).toBe('Pembayaran melebihi sisa piutang (Rp6.000)')
    expect(correctionErrors(form({ amount: 6000 }), 3500, old)).toEqual({})
    expect(correctionErrors(form({ amount: 0 }), 3500, old).amount).toBe('Harus lebih dari 0')
    expect(correctionErrors(form({ amount: Number.NaN }), 3500, old).amount).toBe('Harus bilangan bulat rupiah')
    expect(correctionErrors(form({ amount: 2500 }), 3500, old).amount).toMatch(/sama dengan pembayaran lama/)
    expect(correctionErrors(form({ amount: 2500, methodId: 'transfer' }), 3500, old)).toEqual({})
    expect(correctionErrors(form({ reasonCode: '' }), 3500, old).reasonCode).toBe('Pilih alasan koreksi')
    expect(correctionErrors(form({ reasonCode: 'other' }), 3500, old).note).toBe('Tulis alasan koreksi')
    expect(correctionErrors(form({ approverId: '', pin: '123' }), 3500, old)).toEqual({
      approverId: 'Pilih admin yang menyetujui',
      pin: 'PIN harus 6 angka',
    })
    // "Batalkan saja" needs no amount.
    expect(correctionErrors(form({ mode: 'cancel', amount: Number.NaN, methodId: '' }), 3500, old)).toEqual({})
  })

  it('builds the body: a replacement or null, a trimmed note only when written', () => {
    expect(correctionBody(form({ note: '  salah ketik ' }))).toEqual({
      replacement: { amount: 3000, paymentMethodId: 'tunai' },
      reasonCode: 'wrong_amount',
      note: 'salah ketik',
      approverId: 'owner',
      pin: '482913',
    })
    expect(correctionBody(form({ mode: 'cancel' }))).toEqual({
      replacement: null,
      reasonCode: 'wrong_amount',
      approverId: 'owner',
      pin: '482913',
    })
  })

  it('says where the cash goes: a closed shift and today’s drawer stay as they are, the store cash gives it back', () => {
    const cash = { amount: 2500, isCash: true, shiftId: 's1', shiftClosed: true, collectedOutsideShift: false }
    const open = { hasOpenShift: true, canOpenShift: true }
    const closed = cashEffect(cash, { amount: 3000, isCash: true }, open)
    expect(closed).toEqual({ reversal: 'closedShift', newNeedsShift: false })
    expect(cashNotice(closed)).toBe('Shift tertutup: uang dikembalikan lewat kas toko')
    // Without an open shift the reversal still goes (owner ruling 2026-11-26); only a new CASH payment needs one.
    const none = cashEffect(cash, null, { hasOpenShift: false, canOpenShift: true })
    expect(none).toEqual({ reversal: 'closedShift', newNeedsShift: false })
    expect(cashEffect(cash, { amount: 2500, isCash: false }, { hasOpenShift: false, canOpenShift: true }).newNeedsShift).toBe(false)
    expect(cashEffect(cash, { amount: 3000, isCash: true }, { hasOpenShift: false, canOpenShift: true }).newNeedsShift).toBe(true)
    expect(cashEffect({ ...cash, shiftClosed: false }, null, open).reversal).toBe('sameShift')
    expect(cashEffect({ ...cash, shiftId: null, collectedOutsideShift: true }, null, open).reversal).toBe('collector')
    expect(cashNotice(cashEffect({ ...cash, isCash: false }, null, open))).toBeUndefined()
    expect(cashEffect({ ...cash, isCash: false }, { amount: 1000, isCash: true }, { hasOpenShift: false, canOpenShift: true }).newNeedsShift).toBe(true)
    expect(cashEffect({ ...cash, isCash: false }, { amount: 1000, isCash: true }, { hasOpenShift: false, canOpenShift: false }).newNeedsShift).toBe(false)
  })

  it('words the toast and maps pos-api’s field errors to the form', () => {
    expect(correctionToast(2500, 3000, rp)).toBe('Pembayaran dikoreksi: Rp2.500 jadi Rp3.000')
    expect(correctionToast(1000, null, rp)).toBe('Pembayaran Rp1.000 dibatalkan')
    expect(fieldErrorsOf({ 'replacement.amount': 'Terlalu besar', pin: 'PIN salah', _: 'x' })).toEqual({
      amount: 'Terlalu besar',
      pin: 'PIN salah',
    })
    expect(fieldErrorsOf(undefined)).toEqual({})
  })

  it('says what to do after a refusal with a way forward, in the correction dialog', () => {
    expect(correctionTodo('ALREADY_REVERSED', undefined, rp)).toBe('Muat ulang riwayat pembayaran.')
    const store = correctionTodo('STORE_CASH_INSUFFICIENT', 1_500, rp)!
    expect(store).toContain('kas toko, yang sekarang berisi Rp1.500')
    expect(store).toContain('tidak boleh minus')
    expect(correctionTodo('STORE_CASH_INSUFFICIENT', undefined, rp)).toContain('Rp0')
    expect(correctionTodo('PIN_INVALID', undefined, rp)).toBeUndefined()
  })
})
