import { describe, expect, it } from 'vitest'
import { GENERIC_ERROR, placeErrors, refusalOf } from './refusal'

const res = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

describe('refusals', () => {
  it('reads message and field errors; hides 5xx and junk', async () => {
    expect(await refusalOf(res(422, { message: 'Periksa', errors: { name: 'Wajib diisi' } }))).toEqual({
      error: 'Periksa',
      errors: { name: 'Wajib diisi' },
      status: 422,
    })
    expect(await refusalOf(res(409, { message: 'Kategori masih dipakai produk' }))).toEqual({
      error: 'Kategori masih dipakai produk',
      status: 409,
    })
    expect(await refusalOf(res(500, { message: 'stack trace' }))).toEqual({ error: GENERIC_ERROR, status: 500 })
    expect(await refusalOf(res(502, '<html>'))).toEqual({ error: GENERIC_ERROR, status: 502 })
  })

  it('puts known fields on inputs and the rest in a form-level message', () => {
    expect(
      placeErrors(
        { error: 'Periksa', errors: { name: 'Nama wajib diisi', 'barcodes.1': 'Barcode minimal 3 karakter', x: 'Lain' } },
        ['name', 'barcodes'],
      ),
    ).toEqual({
      byField: { name: 'Nama wajib diisi', 'barcodes.1': 'Barcode minimal 3 karakter' },
      formError: 'Lain',
    })
    expect(placeErrors({ error: 'Kategori masih dipakai produk' }, ['name'])).toEqual({
      byField: {},
      formError: 'Kategori masih dipakai produk',
    })
  })
})
