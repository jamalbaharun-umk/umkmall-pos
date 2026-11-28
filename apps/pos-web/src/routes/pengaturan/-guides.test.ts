import { describe, expect, it } from 'vitest'
import { seenText } from './-guides'

describe('guide center words (UMK-2134)', () => {
  it('counts the guides seen as design 46 says', () => {
    expect(seenText(5, 18)).toBe('5 dari 18 sudah dilihat')
  })
})
