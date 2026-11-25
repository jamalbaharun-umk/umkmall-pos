import { afterAll, describe, expect, it } from 'vitest'
import { checkFields, formatDay, formatMomentDay, isPhone, parseRupiah, toBody, type Field } from './-form'

const fields: Field[] = [
  { name: 'name', label: 'Nama', max: 5 },
  { name: 'code', label: 'Kode', noSpaces: true },
  { name: 'phone', label: 'Telepon', type: 'phone', optional: true },
  { name: 'nominal', label: 'Potongan', type: 'number', check: (v) => (parseRupiah(v) > 100 ? 'Persen antara 1 dan 100' : undefined) },
  { name: 'start', label: 'Mulai', type: 'date' },
  { name: 'end', label: 'Berakhir', type: 'date', check: (v, all) => (v < all.start ? 'Setelah mulai' : undefined) },
]

describe('U7 form checks', () => {
  it('names every empty required field', () => {
    expect(checkFields(fields, {})).toEqual({
      name: 'Wajib diisi',
      code: 'Wajib diisi',
      nominal: 'Wajib diisi',
      start: 'Wajib diisi',
      end: 'Wajib diisi',
    })
  })

  it('mirrors the server rules', () => {
    expect(
      checkFields(fields, {
        name: 'panjang sekali',
        code: 'A B',
        phone: 'abc',
        nominal: '1,5',
        start: '2026-02-31',
        end: '2026-01-01',
      }),
    ).toEqual({
      name: 'Maksimal 5 karakter',
      code: 'Kode tanpa spasi',
      phone: 'Nomor telepon tidak valid',
      nominal: 'Harus bilangan bulat',
      start: 'Tanggal tidak valid',
      end: 'Setelah mulai',
    })
    expect(checkFields(fields, { name: 'a', code: 'A', nominal: '150', start: '2026-01-02', end: '2026-01-03' })).toEqual({
      nominal: 'Persen antara 1 dan 100',
    })
  })

  it('parses rupiah with thousand dots and refuses decimals', () => {
    expect(parseRupiah('10.000')).toBe(10000)
    expect(parseRupiah('2500')).toBe(2500)
    expect(parseRupiah('1.5')).toBeNaN()
    expect(parseRupiah('10,000')).toBeNaN()
    expect(checkFields([{ name: 'kuota', label: 'Kuota', type: 'number' }], { kuota: '-1' })).toEqual({ kuota: 'Tidak boleh negatif' })
  })

  it('accepts Indonesian phone numbers', () => {
    expect(isPhone('0812-3456-7890')).toBe(true)
    expect(isPhone('+62 812 3456 789')).toBe(true)
    expect(isPhone('12345')).toBe(false)
  })

  it('builds the body: numbers parsed, blank optionals null', () => {
    expect(toBody(fields, { name: 'a', code: 'B', phone: '', nominal: '10.000', start: 'x', end: 'y' })).toEqual({
      name: 'a',
      code: 'B',
      phone: null,
      nominal: 10000,
      start: 'x',
      end: 'y',
    })
  })
})

describe('U7 dates are the same in every timezone', () => {
  const zones = ['UTC', 'Asia/Jakarta', 'Pacific/Honolulu', 'Pacific/Kiritimati']
  const original = process.env.TZ
  afterAll(() => {
    process.env.TZ = original
  })

  it('a due date prints its own day, whatever the runtime timezone', () => {
    for (const tz of zones) {
      process.env.TZ = tz
      expect(formatDay('2026-12-02')).toBe('2 Des 2026')
    }
  })

  it('a sale at 00:22 WIB (17:22 UTC the day before) is on the WIB day everywhere', () => {
    for (const tz of zones) {
      process.env.TZ = tz
      expect(formatMomentDay('2026-11-17T17:22:00.000Z')).toBe('18 Nov 2026')
    }
  })
})

describe('a field that exists only for some values (UMK-1991: the gateway method of an online payment method)', () => {
  const method: Field[] = [
    { name: 'name', label: 'Nama' },
    { name: 'kind', label: 'Jenis', options: [{ label: 'Tunai', value: 'cash' }, { label: 'Online', value: 'online' }] },
    { name: 'gatewayMethod', label: 'Metode gateway', options: [{ label: 'QRIS', value: 'fake_qris' }], showWhen: (v) => v.kind === 'online' },
  ]
  it('is sent with an online method', () => {
    expect(toBody(method, { name: 'QRIS', kind: 'online', gatewayMethod: 'fake_qris' })).toEqual({
      name: 'QRIS',
      kind: 'online',
      gatewayMethod: 'fake_qris',
    })
  })
  it('is neither checked nor sent with another kind, even when a value is left over from an earlier choice', () => {
    expect(toBody(method, { name: 'Debit', kind: 'cash', gatewayMethod: 'fake_qris' })).toEqual({ name: 'Debit', kind: 'cash' })
    expect(checkFields(method, { name: 'Debit', kind: 'cash', gatewayMethod: '' })).toEqual({})
  })
  it('is required with an online method', () => {
    expect(checkFields(method, { name: 'QRIS', kind: 'online', gatewayMethod: '' })).toEqual({ gatewayMethod: 'Wajib diisi' })
  })
})
