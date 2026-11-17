import { describe, expect, it } from 'vitest'
import { failureText, sessionKind } from './sign-in'

const token = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`

describe('sign-in helpers', () => {
  it('reads the actor kind from a session token, or nothing from garbage', () => {
    expect(sessionKind(token({ kind: 'cashier' }))).toBe('cashier')
    expect(sessionKind(token({ kind: 'owner' }))).toBe('owner')
    expect(sessionKind(token({ kind: 'admin' }))).toBeUndefined()
    expect(sessionKind('not-a-jwt')).toBeUndefined()
  })

  it('explains a failed sign-in by status', () => {
    expect(failureText(503)).toMatch(/UMKMall sedang tidak bisa dihubungi/)
    expect(failureText(0)).toMatch(/UMKMall sedang tidak bisa dihubungi/)
    expect(failureText(401)).toMatch(/kedaluwarsa/)
    expect(failureText(1)).toMatch(/Gagal masuk/)
  })
})
