import { describe, expect, it } from 'vitest'
import { failureText, landingPath, loginUrl, sessionKind } from './sign-in'

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

  it('UMK-2054 lands a sign-in on a listed page by its key only', () => {
    expect(landingPath('keamanan')).toBe('/pengaturan/keamanan?lupa=1')
    expect(landingPath(undefined)).toBe('/?masuk=1')
    expect(landingPath('toString')).toBe('/?masuk=1')
    expect(landingPath('/pengaturan/keamanan?lupa=1')).toBe('/?masuk=1')
  })
})
