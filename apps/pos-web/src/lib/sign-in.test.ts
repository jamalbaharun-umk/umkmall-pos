import { describe, expect, it } from 'vitest'
import { devSignInUser, failureText, loginUrl, sessionKind } from './sign-in'

const token = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`

describe('sign-in helpers', () => {
  it('offers the dev sign-in only where pos-api accepts it: explicit development or test, with a user', () => {
    const id = '00000000-0000-4000-8000-00000000000a'
    expect(devSignInUser({ NODE_ENV: 'development', POS_DEV_USER_ID: id })).toBe(id)
    expect(devSignInUser({ NODE_ENV: 'test', POS_DEV_USER_ID: id })).toBe(id)
    expect(devSignInUser({ POS_DEV_USER_ID: id })).toBeUndefined()
    expect(devSignInUser({ NODE_ENV: 'production', POS_DEV_USER_ID: id })).toBeUndefined()
    expect(devSignInUser({ NODE_ENV: 'development' })).toBeUndefined()
  })

  it('reads the actor kind from a session token, or nothing from garbage', () => {
    expect(sessionKind(token({ kind: 'cashier' }))).toBe('cashier')
    expect(sessionKind(token({ kind: 'owner' }))).toBe('owner')
    expect(sessionKind(token({ kind: 'admin' }))).toBeUndefined()
    expect(sessionKind('not-a-jwt')).toBeUndefined()
  })

  it('explains a failed sign-in by status', () => {
    expect(failureText(503)).toMatch(/UMKMall sedang tidak bisa dihubungi/)
    expect(failureText(0)).toMatch(/UMKMall sedang tidak bisa dihubungi/)
    expect(failureText(401)).toMatch(/Masuk lagi ke UMKMall/)
    expect(failureText(1)).toMatch(/Gagal masuk/)
  })

  it('sends a signed-out owner to the UMKMall login, coming back to the POS host only', () => {
    const url = new URL(loginUrl('https://umkmall.id', 'https://pos.umkmall.id'))
    expect(url.origin + url.pathname).toBe('https://umkmall.id/login')
    expect(url.searchParams.get('next')).toBe('https://pos.umkmall.id/')
    // only the POS origin is kept: a path, query or credentials in the setting never reach `next`
    const odd = new URL(loginUrl('https://preview.umkmall.id/', 'https://u:p@pos.preview.umkmall.id/x?y=//evil.example'))
    expect(odd.searchParams.get('next')).toBe('https://pos.preview.umkmall.id/')
  })

  it('falls back to the POS sign-in page when UMKMall or the POS URL is not configured (localhost)', () => {
    expect(loginUrl(undefined, 'https://pos.umkmall.id')).toBe('/')
    expect(loginUrl('https://umkmall.id', undefined)).toBe('/')
  })
})
