import { describe, expect, it } from 'vitest'
import { rupiah } from './rupiah'

describe('rupiah', () => {
  it('groups thousands with dots', () => {
    expect(rupiah(0)).toBe('Rp0')
    expect(rupiah(32000)).toBe('Rp32.000')
    expect(rupiah(1_250_000)).toBe('Rp1.250.000')
  })

  it('writes a negative amount with the sign before Rp', () => {
    expect(rupiah(-32000)).toBe('−Rp32.000')
    expect(rupiah(-5)).toBe('−Rp5')
  })

  it('never prints a minus zero', () => {
    expect(rupiah(-0)).toBe('Rp0')
    expect(rupiah(-0.4)).toBe('Rp0')
    expect(rupiah(0 * -1)).toBe('Rp0')
  })

  it('a negated amount (how callers print a deduction) is a real minus, and Rp0 when nothing is deducted', () => {
    const deduction = 30_000
    expect(rupiah(-deduction)).toBe('−Rp30.000')
    expect(rupiah(-0)).toBe('Rp0')
    expect(rupiah(-(5 - 5))).toBe('Rp0')
    expect(rupiah(-deduction)).not.toContain('-')
  })
})
