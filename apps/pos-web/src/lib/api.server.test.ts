import { beforeEach, describe, expect, it, vi } from 'vitest'

// The page-status mapping in api(): 403/404 reads and unreachable upstreams set the real HTTP status.
const statuses: number[] = []
vi.mock('@tanstack/react-start/server', () => ({ setResponseStatus: (s: number) => statuses.push(s) }))
vi.mock('./session.server', () => ({
  getSessionToken: () => 'h.eyJraW5kIjoib3duZXIifQ.s',
  clearSessionToken: () => {},
  posApiUrl: () => 'http://pos-api.test',
  startSession: async () => 503,
}))

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
})
