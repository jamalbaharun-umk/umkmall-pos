import { describe, expect, it } from 'vitest'
import {
  allZero,
  clip,
  monthName,
  parseTarget,
  setupProgress,
  showSetupBoard,
  targetPercent,
  usedPercent,
  voucherStatus,
  weekday,
} from './-summary'

describe('summary helpers', () => {
  it('names the weekday of a store date without a timezone shift', () => {
    expect(weekday('2026-11-27')).toBe('Jum')
    expect(weekday('2026-11-29')).toBe('Min')
    expect(weekday('2026-11-30')).toBe('Sen')
    expect(monthName('2026-06')).toBe('Jun')
    expect(monthName('2026-12')).toBe('Des')
  })

  it('treats a list with nothing above zero as empty', () => {
    expect(allZero([0, 0, 0])).toBe(true)
    expect(allZero([])).toBe(true)
    expect(allZero([0, 1])).toBe(false)
  })

  it('cuts long names for a bar label', () => {
    expect(clip('Gula')).toBe('Gula')
    expect(clip('a'.repeat(30), 10)).toBe('aaaaaaaaa…')
  })

  it('works out voucher quota use and its status', () => {
    expect(usedPercent(40, 100)).toBe(40)
    expect(usedPercent(1, 3)).toBe(33)
    expect(usedPercent(0, 0)).toBe(100)
    expect(voucherStatus(40, 100)).toBe('ok')
    expect(voucherStatus(92, 100)).toBe('low')
    expect(voucherStatus(90, 100)).toBe('low')
    expect(voucherStatus(100, 100)).toBe('empty')
  })

  it('shows the store setup board only while a step is missing', () => {
    expect(showSetupBoard(undefined)).toBe(false)
    expect(showSetupBoard({ complete: false })).toBe(true)
    expect(showSetupBoard({ complete: true })).toBe(false)
    expect(setupProgress(3, 4)).toBe('3 dari 4 langkah selesai.')
  })

  it('reads the typed daily target', () => {
    expect(parseTarget('')).toBeNull()
    expect(parseTarget('  ')).toBeNull()
    expect(parseTarget('2.000.000')).toBe(2_000_000)
    expect(parseTarget('Rp 2.000.000')).toBe(2_000_000)
    expect(parseTarget('0')).toBe('invalid')
    expect(parseTarget('12,5')).toBe('invalid')
    expect(parseTarget('-5')).toBe('invalid')
    expect(parseTarget('abc')).toBe('invalid')
    expect(parseTarget('1000000001')).toBe('invalid')
  })

  it('computes the target percent as a whole number that may pass 100', () => {
    expect(targetPercent(1_350_000, 2_000_000)).toBe(67)
    expect(targetPercent(2_400_000, 2_000_000)).toBe(120)
    expect(targetPercent(-5000, 2_000_000)).toBe(0)
  })
})
