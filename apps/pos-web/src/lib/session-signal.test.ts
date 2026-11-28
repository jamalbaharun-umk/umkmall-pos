import { describe, expect, it } from 'vitest'
import { fromOtherTab, isSessionSignal, SESSION_SIGNAL_KEY } from './session-signal'

describe('session signal across tabs (UMK-2124)', () => {
  it('reacts only to the session key being set', () => {
    expect(isSessionSignal({ key: SESSION_SIGNAL_KEY, newValue: '1' })).toBe(true)
    expect(isSessionSignal({ key: SESSION_SIGNAL_KEY, newValue: null })).toBe(false)
    expect(isSessionSignal({ key: 'pos.guide.device', newValue: '1' })).toBe(false)
    expect(isSessionSignal({ key: null, newValue: null })).toBe(false)
  })

  it('ignores the channel message this tab sent itself', () => {
    expect(fromOtherTab({ tab: 'a', at: 1 }, 'a')).toBe(false)
    expect(fromOtherTab({ tab: 'b', at: 1 }, 'a')).toBe(true)
    expect(fromOtherTab(123, 'a')).toBe(true)
    expect(fromOtherTab(null, 'a')).toBe(true)
  })
})
