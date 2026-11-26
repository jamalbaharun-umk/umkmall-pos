import { beforeEach, describe, expect, it, vi } from 'vitest'

// umkmallSession(): only UMKMall's two auth cookies go to pos-api, and every Set-Cookie it answers reaches the browser.
const cookies = new Map<string, string>()
const appended: [string, string][] = []
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
  appendResponseHeader: (name: string, value: string) => appended.push([name, value]),
}))
process.env.POS_API_URL = 'http://pos-api.test'

const { setReturnTo, takeLandingPath, umkmallSession } = await import('./session.server')

const ownerToken = `h.${Buffer.from(JSON.stringify({ kind: 'owner' })).toString('base64url')}.s`
const minted = [
  'auth_token=new; Path=/; Domain=.umkmall.id; HttpOnly; Secure; SameSite=Lax',
  'auth_refresh=sid.minted; Path=/; Domain=.umkmall.id; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000',
]

function posApi(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const headers = new Headers({ 'content-type': 'application/json' })
    for (const c of minted) headers.append('set-cookie', c)
    return new Response(JSON.stringify(body), { status, headers })
  })
  return calls
}

describe('umkmallSession()', () => {
  beforeEach(() => {
    cookies.clear()
    appended.length = 0
    set.length = 0
  })

  it('forwards only auth_token and auth_refresh, relays every Set-Cookie and stores the session', async () => {
    for (const [k, v] of [['auth_token', 'at'], ['auth_refresh', 'sid.secret'], ['pos_session', 'old'], ['_ga', 'x']])
      cookies.set(k, v)
    const calls = posApi(200, { sessionToken: ownerToken, expiresIn: 900 })
    expect(await umkmallSession()).toBe(ownerToken)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://pos-api.test/auth/umkmall/session')
    expect(new Headers(calls[0].init.headers).get('cookie')).toBe('auth_token=at; auth_refresh=sid.secret')
    expect(new Headers(calls[0].init.headers).has('authorization')).toBe(false)
    expect(appended).toEqual(minted.map((c) => ['set-cookie', c]))
    expect(set).toEqual(['pos_session'])
  })

  it('relays Set-Cookie on a refusal too, and answers its status', async () => {
    cookies.set('auth_refresh', 'sid.secret')
    posApi(401, { message: 'x' })
    expect(await umkmallSession()).toBe(401)
    expect(appended).toHaveLength(2)
    expect(set).toEqual([])
  })

  it('answers 401 without calling pos-api when neither UMKMall cookie is there', async () => {
    cookies.set('pos_session', 'old')
    const calls = posApi(200, {})
    expect(await umkmallSession()).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('answers 0 when pos-api cannot be reached', async () => {
    cookies.set('auth_token', 'at')
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    expect(await umkmallSession()).toBe(0)
  })

  it('UMK-2054 tells pos-api about a sign-in only when asked: a refresh sends an empty body', async () => {
    cookies.set('auth_token', 'at')
    const calls = posApi(200, { sessionToken: ownerToken, expiresIn: 900 })
    await umkmallSession()
    await umkmallSession(false)
    await umkmallSession(true)
    expect(calls.map((c) => c.init.body)).toEqual(['{}', '{}', '{"signIn":true}'])
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
