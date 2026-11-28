import { describe, expect, it } from 'vitest'
import { devSignInUser, failureText, landingPath, parseNativeSession, returnKeyOf, sessionKind, whatsappNotSetUp, WHATSAPP_NOT_SET_UP_TEXT } from './sign-in'

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
    expect(sessionKind(token({ kind: 'helper' }))).toBe('helper')
    expect(sessionKind(token({ kind: 'admin' }))).toBeUndefined()
    expect(sessionKind('not-a-jwt')).toBeUndefined()
  })

  it('explains a failed sign-in by status', () => {
    expect(failureText(503)).toMatch(/tidak bisa dihubungi/)
    expect(failureText(0)).toMatch(/tidak bisa dihubungi/)
    expect(failureText(401)).toMatch(/nomor WhatsApp/)
    expect(failureText(1)).toMatch(/Gagal masuk/)
  })

  it('UMK-2065 reads the native session cookie, or nothing from anything else', () => {
    expect(parseNativeSession('{"sid":"s1","refreshToken":"r1","x":1}')).toEqual({ sid: 's1', refreshToken: 'r1' })
    for (const bad of [undefined, '', 'nope', '{"sid":"s1"}', '{"sid":1,"refreshToken":"r"}', '{"sid":"","refreshToken":"r"}', 'null'])
      expect(parseNativeSession(bad)).toBeUndefined()
  })

  it('UMK-2054 lands a sign-in on a listed page by its key only', () => {
    expect(landingPath('keamanan')).toBe('/pengaturan/keamanan?lupa=1')
    expect(landingPath(undefined)).toBe('/?masuk=1')
    expect(landingPath('pembantu')).toBe('/kasir?pembantu=akhiri')
    expect(returnKeyOf('pembantu')).toBe('pembantu')
    expect(returnKeyOf('toString')).toBe('keamanan')
    expect(returnKeyOf(null)).toBe('keamanan')
    expect(landingPath('toString')).toBe('/?masuk=1')
    expect(landingPath('/pengaturan/keamanan?lupa=1')).toBe('/?masuk=1')
  })
})

describe('WhatsApp sign-in availability', () => {
  it('reads a bare 404 from pos-api as "not set up", never as missing data', () => {
    expect(whatsappNotSetUp(404)).toBe(true)
    for (const s of [0, 200, 401, 422, 429, 503]) expect(whatsappNotSetUp(s)).toBe(false)
    expect(WHATSAPP_NOT_SET_UP_TEXT).toBe('Masuk lewat WhatsApp belum diatur di lingkungan ini.')
  })
})
