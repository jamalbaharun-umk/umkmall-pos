import { beforeEach, describe, expect, it, vi } from 'vitest'

// The owner's WhatsApp sign-in (UMK-2065): pos-api's answer stores the POS token and UMKMall's native session; the
// refresh sends that session back; signing out ends it.
const cookies = new Map<string, string>()
const set: string[] = []
vi.mock('@tanstack/react-start/server', () => ({
  getCookie: (name: string) => cookies.get(name),
  setCookie: (name: string, value: string) => {
    set.push(name)
    cookies.set(name, value)
  },
  deleteCookie: (name: string) => {
    cookies.delete(name)
  },
}))
process.env.POS_API_URL = 'http://pos-api.test'

const { endOwnerSession, refreshOwner, setReturnTo, startSession, takeLandingPath } = await import('./session.server')

const ownerToken = `h.${Buffer.from(JSON.stringify({ kind: 'owner' })).toString('base64url')}.s`
const NATIVE = JSON.stringify({ sid: 'sid-1', refreshToken: 'r1' })

function posApi(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  })
  return calls
}

describe('owner session from a WhatsApp sign-in', () => {
  beforeEach(() => {
    cookies.clear()
    set.length = 0
  })

  it('stores the POS token and the native session pos-api answers', async () => {
    posApi(200, { sessionToken: ownerToken, expiresIn: 900, umkmall: { sid: 'sid-1', refreshToken: 'r1' } })
    expect(await startSession('/auth/otp/verify', {})).toBe(ownerToken)
    expect(cookies.get('pos_session')).toBe(ownerToken)
    expect(JSON.parse(cookies.get('pos_umkmall')!)).toEqual({ sid: 'sid-1', refreshToken: 'r1' })
  })

  it('refreshes with the stored native session, keeping it when UMKMall did not rotate it', async () => {
    cookies.set('pos_umkmall', NATIVE)
    const calls = posApi(200, { sessionToken: ownerToken, expiresIn: 900, umkmall: { sid: 'sid-1' } })
    expect(await refreshOwner()).toBe(ownerToken)
    expect(calls[0].url).toBe('http://pos-api.test/auth/umkmall/refresh')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ sid: 'sid-1', refreshToken: 'r1' })
    expect(cookies.get('pos_umkmall')).toBe(NATIVE)
    // a rotated token replaces it
    posApi(200, { sessionToken: ownerToken, expiresIn: 900, umkmall: { sid: 'sid-1', refreshToken: 'r2' } })
    await refreshOwner()
    expect(JSON.parse(cookies.get('pos_umkmall')!).refreshToken).toBe('r2')
  })

  it('answers 401 without a call when there is no native session, and the refusal status otherwise', async () => {
    const calls = posApi(200, {})
    expect(await refreshOwner()).toBe(401)
    expect(calls).toHaveLength(0)
    cookies.set('pos_umkmall', NATIVE)
    posApi(401, { message: 'x' })
    expect(await refreshOwner()).toBe(401)
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    expect(await refreshOwner()).toBe(0)
  })

  it('signing out ends the native session at pos-api and drops every session cookie, even when pos-api is down', async () => {
    for (const [k, v] of [['pos_session', ownerToken], ['pos_umkmall', NATIVE], ['pos_me', '{}']]) cookies.set(k, v)
    const calls = posApi(204, {})
    await endOwnerSession()
    expect(calls.map((c) => c.url)).toEqual(['http://pos-api.test/auth/umkmall/sign-out'])
    expect([...cookies.keys()]).toEqual([])
    cookies.set('pos_umkmall', NATIVE)
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    await endOwnerSession()
    expect(cookies.has('pos_umkmall')).toBe(false)
  })
})

describe('where a sign-in lands (UMK-2054)', () => {
  beforeEach(() => cookies.clear())

  it('the POS home by default; Keamanan once after "Masuk lagi"', () => {
    expect(takeLandingPath()).toBe('/?masuk=1')
    setReturnTo('keamanan')
    expect(cookies.get('pos_kembali')).toBe('keamanan')
    expect(takeLandingPath()).toBe('/pengaturan/keamanan?lupa=1')
    // used once
    expect(cookies.has('pos_kembali')).toBe(false)
    expect(takeLandingPath()).toBe('/?masuk=1')
  })

  it('a cookie value that is not a listed key lands on the home, never on a path of its own', () => {
    for (const forged of ['https://evil.example/', '//evil.example', '/pengaturan/keamanan', 'constructor', '']) {
      cookies.set('pos_kembali', forged)
      expect(takeLandingPath()).toBe('/?masuk=1')
    }
  })
})
