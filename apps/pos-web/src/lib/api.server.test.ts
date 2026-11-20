import { beforeEach, describe, expect, it, vi } from 'vitest'

// The page-status mapping in api(): 403/404 reads and unreachable upstreams set the real HTTP status.
const statuses: number[] = []
vi.mock('@tanstack/react-start/server', () => ({ setResponseStatus: (s: number) => statuses.push(s) }))
vi.mock('./session.server', () => ({
  getSessionToken: () => 'h.eyJraW5kIjoib3duZXIifQ.s',
  clearSessionToken: () => {},
  posApiUrl: () => 'http://pos-api.test',
  umkmallSession: async () => refresh,
  umkmallLoginUrl: () => 'https://umkmall.id/login?next=https%3A%2F%2Fpos.umkmall.id%2F',
}))
let refresh: string | number = 503

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

  it('sets 503 when the owner refresh finds UMKMall down', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }))
    await expect(api('/x')).rejects.toThrow(UMKMALL_DOWN)
    expect(statuses).toEqual([503])
  })

  it('sends the owner to the UMKMall login when the UMKMall re-check refuses (signed out, revoked, deleted)', async () => {
    refresh = 401
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }))
    const thrown = await api('/x').catch((e: unknown) => e)
    expect(thrown).toMatchObject({ options: { href: 'https://umkmall.id/login?next=https%3A%2F%2Fpos.umkmall.id%2F' } })
    refresh = 503
  })

  it('retries with the fresh session after a successful re-check', async () => {
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
})
