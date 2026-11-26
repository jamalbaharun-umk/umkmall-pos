import { describe, expect, it } from 'vitest'
import { pinKeyOf } from './-pin-keys'

describe('pinKeyOf: the keyboard on the PIN keypad', () => {
  it('maps digits, Backspace and Enter', () => {
    expect(pinKeyOf({ key: '7' })).toBe('7')
    expect(pinKeyOf({ key: '0' })).toBe('0')
    expect(pinKeyOf({ key: 'Backspace' })).toBe('hapus')
    expect(pinKeyOf({ key: 'Enter', target: { tagName: 'DIV' } })).toBe('masuk')
  })
  it('ignores other keys and shortcuts', () => {
    expect(pinKeyOf({ key: 'a' })).toBeNull()
    expect(pinKeyOf({ key: '12' })).toBeNull()
    expect(pinKeyOf({ key: 'Tab' })).toBeNull()
    expect(pinKeyOf({ key: '1', ctrlKey: true })).toBeNull()
    expect(pinKeyOf({ key: 'Backspace', metaKey: true })).toBeNull()
  })
  it('does not press a key twice: Enter on a focused button is its own click, a held digit adds one', () => {
    expect(pinKeyOf({ key: 'Enter', target: { tagName: 'BUTTON' } })).toBeNull()
    expect(pinKeyOf({ key: 'Enter', repeat: true })).toBeNull()
    expect(pinKeyOf({ key: '5', repeat: true })).toBeNull()
    expect(pinKeyOf({ key: 'Backspace', repeat: true })).toBe('hapus')
  })
})
