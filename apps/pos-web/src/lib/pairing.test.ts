import { describe, expect, it } from 'vitest'
import { describePairError } from './pair-errors'
import {
  buildForwardedFor,
  encodePairingCookie,
  formatCountdown,
  groupCode,
  isPairingCode,
  parsePairingCookie,
  secondsLeft,
} from './pairing'

describe('code and countdown', () => {
  it('a code is exactly six digits', () => {
    expect(isPairingCode('482913')).toBe(true)
    for (const bad of ['48291', '4829133', '48291a', '', '482 913']) expect(isPairingCode(bad)).toBe(false)
  })
  it('groups for reading, keeping leading zeros', () => {
    expect(groupCode('482913')).toBe('482 913')
    expect(groupCode('004213')).toBe('004 213')
  })
  it('counts down as M:SS and never below zero', () => {
    expect(formatCountdown(600)).toBe('10:00')
    expect(formatCountdown(580)).toBe('9:40')
    expect(formatCountdown(65)).toBe('1:05')
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-5)).toBe('0:00')
    expect(secondsLeft(10_000, 4_500)).toBe(6)
    expect(secondsLeft(10_000, 20_000)).toBe(0)
  })
})

describe('buildForwardedFor: the device address pos-web passes on', () => {
  it('the device alone behind no proxy', () => {
    expect(buildForwardedFor(undefined, '203.0.113.9')).toBe('203.0.113.9')
    expect(buildForwardedFor('', '203.0.113.9')).toBe('203.0.113.9')
  })
  it('keeps what the relay received and appends the address it saw', () => {
    expect(buildForwardedFor('198.51.100.7, 10.0.0.2', '10.0.0.3')).toBe('198.51.100.7, 10.0.0.2, 10.0.0.3')
    expect(buildForwardedFor(' 198.51.100.7 ,, ', ' 10.0.0.3 ')).toBe('198.51.100.7, 10.0.0.3')
  })
  it('handles IPv6', () => {
    expect(buildForwardedFor(null, '2001:db8::1')).toBe('2001:db8::1')
  })
  it('says nothing when there is no address at all', () => {
    expect(buildForwardedFor(undefined, undefined)).toBeUndefined()
    expect(buildForwardedFor('', null)).toBeUndefined()
  })
})

describe('the pairing cookie', () => {
  const live = { token: 'id.secret', code: '482913', expiresAt: 2_000_000 }
  it('round-trips while the code is live', () => {
    expect(parsePairingCookie(encodePairingCookie(live), 1_000_000)).toEqual(live)
  })
  it('is dropped when over, malformed or carrying a wrong code', () => {
    expect(parsePairingCookie(encodePairingCookie(live), 2_000_000)).toBeNull()
    expect(parsePairingCookie(undefined, 0)).toBeNull()
    expect(parsePairingCookie('{nope', 0)).toBeNull()
    expect(parsePairingCookie(JSON.stringify({ t: 1, c: '482913', e: 9e9 }), 0)).toBeNull()
    expect(parsePairingCookie(encodePairingCookie({ ...live, code: '12' }), 0)).toBeNull()
  })
})

describe('describePairError (owner enters the code)', () => {
  it('422: wrong, used and expired codes read the same', () => {
    const d = describePairError({ status: 422, error: 'Kode pasang salah atau sudah tidak berlaku' }, 'x')
    expect(d.what).toMatch(/salah, sudah dipakai, atau lewat 10 menit/)
    expect(d.code).toBe('PAIRING_CODE_INVALID')
  })
  it('429: locked, with the wait in seconds or minutes', () => {
    expect(describePairError({ status: 429, retryAfter: 30 }, 'x').todo).toMatch(/30 detik/)
    expect(describePairError({ status: 429, retryAfter: 300 }, 'x').todo).toMatch(/5 menit/)
    expect(describePairError({ status: 429 }, 'x').todo).toMatch(/beberapa saat/)
  })
  it('403 names the missing right without server text; others use the shared mapping', () => {
    expect(describePairError({ status: 403, error: 'Forbidden' }, 'x').what).toMatch(/tidak boleh menghubungkan/)
    expect(describePairError({ status: 0 }, 'x').code).toBe('OFFLINE')
    expect(describePairError({ status: 503 }, 'x').primary).toBe('retry')
  })
})
