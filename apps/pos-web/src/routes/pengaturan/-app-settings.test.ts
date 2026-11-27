import { describe, expect, it } from 'vitest'
import { appSettingsPayload } from './-app-settings'

describe('appSettingsPayload', () => {
  it('a timezone-only change does not send the tax', () => {
    expect(appSettingsPayload({ bps: 0, taxTouched: false, timezone: 'Asia/Jakarta', tz: 'Asia/Makassar' })).toEqual({
      timezone: 'Asia/Makassar',
    })
  })
  it('typing 0% is a tax choice, with or without a timezone change', () => {
    expect(appSettingsPayload({ bps: 0, taxTouched: true, timezone: 'Asia/Jakarta', tz: 'Asia/Makassar' })).toEqual({
      taxBps: 0,
      timezone: 'Asia/Makassar',
    })
    expect(appSettingsPayload({ bps: 0, taxTouched: true, timezone: 'Asia/Jakarta', tz: 'Asia/Jakarta' })).toEqual({
      taxBps: 0,
      timezone: 'Asia/Jakarta',
    })
  })
  it('pressing save with nothing changed confirms the tax; no timezone on file sends the tax alone', () => {
    expect(appSettingsPayload({ bps: 0, taxTouched: false, timezone: 'Asia/Jakarta', tz: 'Asia/Jakarta' })).toEqual({
      taxBps: 0,
      timezone: 'Asia/Jakarta',
    })
    expect(appSettingsPayload({ bps: 1100, taxTouched: false, timezone: null, tz: 'Asia/Jakarta' })).toEqual({ taxBps: 1100 })
  })
})
