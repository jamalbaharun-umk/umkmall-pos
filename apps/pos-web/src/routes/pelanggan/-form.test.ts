import { describe, expect, it } from 'vitest'
import { checkFields, isPhone, parseRupiah, toBody, type Field } from './-form'

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
