import { describe, expect, it } from 'vitest'
import { shouldAskOwnerPin } from './owner-pin'

const solo = { active: true, storeCash: false, ownerPin: false, freshSignIn: true }

describe('shouldAskOwnerPin', () => {
  it('asks an owner without a PIN right after a fresh sign-in', () => {
    expect(shouldAskOwnerPin(solo, true)).toBe(true)
    expect(shouldAskOwnerPin({ ...solo, active: false }, true)).toBe(true)
  })
  it('does not ask when the owner has a PIN, the sign-in is old, it is not a sign-in, or for a cashier', () => {
    expect(shouldAskOwnerPin({ ...solo, ownerPin: true }, true)).toBe(false)
    expect(shouldAskOwnerPin({ ...solo, freshSignIn: false }, true)).toBe(false)
    expect(shouldAskOwnerPin(solo, false)).toBe(false)
    expect(shouldAskOwnerPin(null, true)).toBe(false)
    expect(shouldAskOwnerPin(undefined, true)).toBe(false)
  })
})
