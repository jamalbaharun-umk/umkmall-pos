import { describe, expect, it } from 'vitest'
import { describeError } from '../../lib/describe-error'
import { voidFailure } from '../kasir/-void-helpers'
import { freshSignInText, needsFreshSignIn, wrongOldPin, type FreshReason } from './-keamanan-helpers'

describe("the owner's own PIN (UMK-2054)", () => {
  it('reads pos-api\'s "sign in again" refusal by its code, on a 403 only', () => {
    const body = { message: 'Untuk keamanan, masuk lagi dengan akun UMKMall, lalu ulangi dalam 5 menit.', code: 'fresh_sign_in_required' }
    expect(needsFreshSignIn(403, body)).toBe(true)
    // a plain 403 is a missing permission
    expect(needsFreshSignIn(403, { message: 'Forbidden' })).toBe(false)
    expect(needsFreshSignIn(403, null)).toBe(false)
    expect(needsFreshSignIn(403, 'fresh_sign_in_required')).toBe(false)
    expect(needsFreshSignIn(422, body)).toBe(false)
    expect(needsFreshSignIn(0, null)).toBe(false)
  })

  it('the refusal still reads as a 403 for a caller that does not know the code', () => {
    expect(voidFailure(403, { code: 'fresh_sign_in_required' }).kind).toBe('forbidden')
  })

  it('every "Masuk lagi" dialog says to sign in again with UMKMall and names the 5 minutes', () => {
    for (const reason of ['forgot', 'first', 'unlock', 'expired'] as FreshReason[]) {
      const { title, body } = freshSignInText(reason)
      expect(title.length).toBeGreaterThan(0)
      expect(body).toMatch(/[Mm]asuk lagi/)
      expect(body).toMatch(/akun UMKMall/)
      expect(body).toMatch(/5 menit/)
    }
    expect(freshSignInText('forgot').title).toBe('Lupa PIN?')
    expect(freshSignInText('expired').body).toMatch(/PIN belum berubah/)
  })

  it('a wrong old PIN says the PIN did not change and where to go when it is forgotten', () => {
    const owner = wrongOldPin(true)
    expect(owner.status).toBe(422)
    expect(owner.error).toMatch(/PIN lama tidak cocok/)
    expect(owner.todo).toMatch(/Lupa PIN/)
    expect(wrongOldPin(false).todo).toMatch(/minta pemilik/)
    // the error dialog shows both sentences as they are (no digit run, no internals)
    const shown = describeError(owner, 'x')
    expect(shown.what).toBe(owner.error)
    expect(shown.todo).toBe(owner.todo)
  })
})
