import { describe, expect, it } from 'vitest'
import { failureOf, voidFailure } from './-void-helpers'

describe('failureOf (the error dialog reads the void refusal)', () => {
  it('maps each kind to a status and keeps only pos-api text', () => {
    expect(failureOf(voidFailure(0, null))).toEqual({ status: 0 })
    expect(failureOf(voidFailure(403, { message: 'x' }))).toEqual({ status: 403 })
    expect(failureOf(voidFailure(404, null))).toEqual({ status: 404 })
    expect(failureOf(voidFailure(429, { message: 'Terkunci', retryAfter: 120 }))).toEqual({
      status: 429,
      retryAfter: 120,
    })
    expect(failureOf(voidFailure(409, { message: 'Struk sudah dibatalkan' }))).toEqual({
      status: 409,
      error: 'Struk sudah dibatalkan',
    })
    expect(failureOf(voidFailure(500, { message: 'stack' }))).toEqual({ status: 500 })
  })

  it('a wrong PIN becomes its own code, never the PIN', () => {
    expect(failureOf(voidFailure(422, { message: 'Isian salah', errors: { pin: 'PIN salah' } }))).toEqual({
      code: 'PIN_INVALID',
    })
  })
})
