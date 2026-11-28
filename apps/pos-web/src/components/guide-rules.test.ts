import { describe, expect, it } from 'vitest'
import { blocksGuide, DEVICE_GUIDES_KEY, readDeviceProgress, writeDeviceProgress } from './guide-rules'

describe('guide rules (UMK-2134)', () => {
  const doc = (match: string | null) => ({ querySelector: (s: string) => (match && s.includes(match) ? {} : null) }) as never

  it('hides the guide while a dialog, a payment sheet or a PIN entry is open', () => {
    expect(blocksGuide(doc('[role="dialog"]'))).toBe(true)
    expect(blocksGuide(doc('[role="alertdialog"]'))).toBe(true)
    expect(blocksGuide(doc('[autocomplete="one-time-code"]'))).toBe(true)
    expect(blocksGuide(doc(null))).toBe(false)
  })

  it('keeps a helper guide mark on the device, and ignores storage it cannot use (UMK-2124)', () => {
    const data: Record<string, string> = {}
    const storage = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
    expect(readDeviceProgress(storage).size).toBe(0)
    expect(writeDeviceProgress(storage, 'kasir.pembantu', 'skipped')).toBe(true)
    expect(writeDeviceProgress(storage, 'other', 'done')).toBe(true)
    expect([...readDeviceProgress(storage)]).toEqual([
      ['kasir.pembantu', 'skipped'],
      ['other', 'done'],
    ])
    data[DEVICE_GUIDES_KEY] = '{"a":"done","b":"maybe"}'
    expect([...readDeviceProgress(storage)]).toEqual([['a', 'done']])
    data[DEVICE_GUIDES_KEY] = 'not json'
    expect(readDeviceProgress(storage).size).toBe(0)
    expect(readDeviceProgress(undefined).size).toBe(0)
    expect(writeDeviceProgress(undefined, 'x', 'done')).toBe(false)
    const throwing = { getItem: () => null, setItem: () => { throw new Error('full') } }
    expect(writeDeviceProgress(throwing, 'x', 'done')).toBe(false)
  })
})
