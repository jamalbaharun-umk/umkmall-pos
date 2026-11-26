import { beforeEach, describe, expect, it, vi } from 'vitest'

// The page-status mapping in api(): 403/404 reads and unreachable upstreams set the real HTTP status.
const statuses: number[] = []
vi.mock('@tanstack/react-start/server', () => ({ setResponseStatus: (s: number) => statuses.push(s) }))
vi.mock('./session.server', () => ({
  getSessionToken: () => 'h.eyJraW5kIjoib3duZXIifQ.s',
  clearSessionToken: () => {},
  posApiUrl: () => 'http://pos-api.test',
  refreshOwner: async (...args: unknown[]) => {
    refreshArgs.push(args)
    return refresh
  },
}))
let refresh: string | number = 503
const refreshArgs: unknown[][] = []

const { api, API_DOWN, UMKMALL_DOWN } = await import('./api.server')

describe('api() page status', () => {
  beforeEach(() => {
    statuses.length = 0
  })

  it('sets 403 and 404 for refused reads, nothing for successes or mutations', async () => {
    for (const [status, method] of [[403, 'GET'], [404, 'GET'], [200, 'GET'], [403, 'POST']] as const) {
      vi.stubGlobal('fetch', async () => new Response('{}', { status }))
      await api('/x', { method })
    }
    expect(statuses).toEqual([403, 404])
  })

  it('sets 503 with an Indonesian message when pos-api cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    await expect(api('/x')).rejects.toThrow(API_DOWN)
    expect(statuses).toEqual([503])
  })

  it('a pos-api that never answers is cut off by the timeout and reads as "no answer" (UMK-2051)', async () => {
    process.env.POS_API_TIMEOUT_MS = '30'
    try {
      vi.stubGlobal(
        'fetch',
        (_: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')))),
      )
      await expect(api('/x', { method: 'POST' })).rejects.toThrow(API_DOWN)
      expect(statuses).toEqual([503])
    } finally {
      delete process.env.POS_API_TIMEOUT_MS
    }
  })

  it('passes a signal to every request, and keeps the caller\'s own abort', async () => {
    let seen: AbortSignal | undefined
    vi.stubGlobal('fetch', async (_: string, init: RequestInit) => {
      seen = init.signal ?? undefined
      return new Response('{}', { status: 200 })
    })
    await api('/x')
    expect(seen).toBeInstanceOf(AbortSignal)
    const own = new AbortController()
    await api('/x', { signal: own.signal })
    own.abort()
    expect(seen?.aborted).toBe(true)
  })

  it('sets 503 when the owner refresh finds UMKMall down', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }))
    await expect(api('/x')).rejects.toThrow(UMKMALL_DOWN)
    expect(statuses).toEqual([503])
  })

  it('sends the owner to the sign-in page when the refresh is refused (signed out, revoked, deleted)', async () => {
    refresh = 401
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }))
    const thrown = await api('/x').catch((e: unknown) => e)
    expect(thrown).toMatchObject({ options: { to: '/' } })
    refresh = 503
  })

  it('retries with the fresh session after a successful refresh', async () => {
    refresh = 'fresh'
    const seen: (string | null)[] = []
    vi.stubGlobal('fetch', async (_: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get('authorization'))
      return new Response('{}', { status: seen.length === 1 ? 401 : 200 })
    })
    expect((await api('/x')).status).toBe(200)
    expect(seen).toEqual(['Bearer h.eyJraW5kIjoib3duZXIifQ.s', 'Bearer fresh'])
    refresh = 503
  })

  it('UMK-2054 the refresh after a 401 is never a sign-in: it goes through refreshOwner, which pos-api never stamps as a sign-in', async () => {
    refresh = 'h.eyJraW5kIjoib3duZXIifQ.new'
    refreshArgs.length = 0
    let n = 0
    vi.stubGlobal('fetch', async () => new Response('{}', { status: n++ === 0 ? 401 : 200 }))
    expect((await api('/void-pin')).status).toBe(200)
    expect(refreshArgs).toEqual([[]])
    refresh = 503
  })
})
