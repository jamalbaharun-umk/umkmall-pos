import { describe, expect, it } from 'vitest'
import { endsAtText, helperMethods, helperPaid, helperTitle, nameError, pinFailure, pinInputError } from './-helper'

describe('helper handover rules (UMK-2124)', () => {
  it('titles the restricted till with the helper name when there is one', () => {
    expect(helperTitle('Dina')).toBe('Mode pembantu · Dina')
    expect(helperTitle('  ')).toBe('Mode pembantu')
    expect(helperTitle(null)).toBe('Mode pembantu')
  })

  it('says when the handover ends, or nothing when it is unknown', () => {
    expect(endsAtText('2026-11-28T14:30:00Z', 'Asia/Jakarta')).toBe('21.30')
    expect(endsAtText('')).toBe('')
    expect(endsAtText('nope')).toBe('')
  })

  it('offers a helper cash, debit and the store QRIS only', () => {
    const methods = [
      { id: '1', kind: 'cash' },
      { id: '2', kind: 'credit' },
      { id: '3', kind: 'debit' },
      { id: '4', kind: 'online' },
      { id: '5', kind: 'wallet' },
    ]
    expect(helperMethods(methods).map((m) => m.id)).toEqual(['1', '3', '5'])
  })

  it('checks the PIN and the optional name', () => {
    expect(pinInputError('')).toBe('Masukkan PIN pemilik')
    expect(pinInputError('12345')).toBe('PIN harus 6 angka')
    expect(pinInputError('123456')).toBeUndefined()
    expect(nameError('Dina')).toBeUndefined()
    expect(nameError('x'.repeat(41))).toBe('Nama paling banyak 40 huruf')
  })

  it('takes cash of at least the rounded total; debit and QRIS pay the total', () => {
    expect(helperPaid('debit', 5050, '')).toEqual({ amount: 5050 })
    expect(helperPaid('wallet', 5050, 'x')).toEqual({ amount: 5050 })
    expect(helperPaid('cash', 5050, '')).toEqual({ error: 'Wajib diisi: masukkan uang diterima' })
    expect(helperPaid('cash', 5050, 'abc')).toEqual({ error: 'Harus bilangan bulat rupiah, misalnya 50.000' })
    expect(helperPaid('cash', 5050, '5.050')).toEqual({ error: 'Uang dibayar kurang dari jumlah yang harus dibayar' })
    expect(helperPaid('cash', 5050, '5.100')).toEqual({ amount: 5100 })
    expect(helperPaid('cash', 5000, '10.000')).toEqual({ amount: 10000 })
  })

  it('words a refused owner PIN for the error dialog', () => {
    expect(pinFailure({ status: 422, errors: { pin: 'PIN salah' }, error: 'PIN salah' })).toMatchObject({
      error: 'PIN pemilik salah.',
      todo: expect.stringContaining('5 menit'),
    })
    expect(pinFailure({ status: 429, code: 'owner_pin_locked', retryAfter: 300 })).toMatchObject({
      status: 429,
      retryAfter: 300,
      error: 'PIN pemilik dikunci karena 5 kali salah.',
    })
    const missing = { status: 422, code: 'owner_pin_missing', errors: { pin: 'Belum ada' }, error: 'Belum ada' }
    expect(pinFailure(missing)).toBe(missing)
    const busy = { status: 409, code: 'helper_active', error: 'Sudah diserahkan' }
    expect(pinFailure(busy)).toBe(busy)
  })
})
