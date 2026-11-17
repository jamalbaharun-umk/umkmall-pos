import { describe, expect, it } from 'vitest'
import { change } from './-reports'

describe('change', () => {
  it('rounds the percentage and refuses a zero base', () => {
    expect(change(15_000, 10_000)).toBe(50)
    expect(change(5_000, 10_000)).toBe(-50)
    expect(change(1, 3)).toBe(-67)
    expect(change(100, 0)).toBeNull()
    expect(change(-50, -100)).toBe(50)
  })
})
