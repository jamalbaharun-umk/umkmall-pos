import { describe, expect, it } from 'vitest'
import {
  VOID_REASONS,
  approverBlock,
  approverOptions,
  isWrongPin,
  lockText,
  pinDigits,
  pinSetErrors,
  refundGuidance,
  refundStateText,
  manualNoteError,
  voidBody,
  voidFailure,
  voidFormErrors,
  type Approver,
} from './-void-helpers'

const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`
const ok = { reasonCode: 'customer_cancelled', note: '', approverId: 'a1', pin: '123456' }

describe('void form', () => {
  it('has the six fixed reason codes', () => {
    expect(VOID_REASONS.map((r) => r.code)).toEqual([
      'wrong_item_or_qty',
      'wrong_payment_method',
      'customer_cancelled',
      'duplicate_transaction',
      'goods_returned',
      'other',
    ])
  })
  it('accepts a complete form', () => {
    expect(voidFormErrors(ok)).toEqual({})
  })
  it('needs a reason, an approver and a 6-digit PIN', () => {
    expect(voidFormErrors({ reasonCode: '', note: '', approverId: '', pin: '12345' })).toEqual({
      reasonCode: 'Pilih alasan pembatalan',
      approverId: 'Pilih admin yang menyetujui',
      pin: 'PIN harus 6 angka',
    })
  })
  it('"Lainnya" needs a note, other reasons do not', () => {
    expect(voidFormErrors({ ...ok, reasonCode: 'other', note: '  ' }).note).toBe('Tulis alasan pembatalan')
    expect(voidFormErrors({ ...ok, reasonCode: 'other', note: 'Salah toko' }).note).toBeUndefined()
    expect(voidFormErrors({ ...ok, note: 'x'.repeat(201) }).note).toMatch(/maksimal 200/)
  })
  it('sends the note only when there is one, trimmed', () => {
    expect(voidBody(ok)).toEqual({ reasonCode: 'customer_cancelled', approverId: 'a1', pin: '123456' })
    expect(voidBody({ ...ok, note: '  rusak ' }).note).toBe('rusak')
  })
  it('keeps only six digits of a PIN', () => {
    expect(pinDigits('12a3 45-678')).toBe('123456')
  })
})

describe('approvers', () => {
  const now = Date.parse('2026-11-25T10:00:00Z')
  const a = (o: Partial<Approver>): Approver => ({
    id: 'x',
    kind: 'cashier',
    name: 'Rina',
    hasPin: true,
    lockedUntil: null,
    ...o,
  })
  it('blocks one without a PIN and one that is locked, with the minutes left', () => {
    expect(approverBlock(a({}), now)).toBeNull()
    expect(approverBlock(a({ hasPin: false }), now)).toBe('Belum membuat PIN')
    expect(approverBlock(a({ lockedUntil: '2026-11-25T10:04:10Z' }), now)).toBe('Terkunci, coba lagi 5 menit lagi')
    expect(approverBlock(a({ lockedUntil: '2026-11-25T09:59:00Z' }), now)).toBeNull()
  })
  it('names the owner and disables blocked approvers', () => {
    const opts = approverOptions([a({ id: 'o', kind: 'owner', name: 'Budi' }), a({ id: 'r', hasPin: false })], now)
    expect(opts[0]).toMatchObject({ value: 'o', label: 'Pemilik', disabled: false })
    expect(opts[1]).toMatchObject({ value: 'r', label: 'Rina', disabled: true, hint: 'Belum membuat PIN' })
  })
})

describe('refund guidance', () => {
  it('cash comes out of the drawer and needs an open shift', () => {
    const g = refundGuidance('cash', 10000, rp)
    expect(g.needsShift).toBe(true)
    expect(g.text).toContain('Rp10.000')
    expect(g.text).toContain('laci')
  })
  it('debit and wallet go back by transfer, no shift', () => {
    for (const k of ['debit', 'wallet'] as const) {
      const g = refundGuidance(k, 10000, rp)
      expect(g.needsShift).toBe(false)
      expect(g.text).toContain('transfer balik')
    }
  })
  it('kasbon and unknown kinds have their own wording', () => {
    expect(refundGuidance('credit', 6000, rp).text).toContain('Sisa kasbon dihapus')
    expect(refundGuidance(null, 6000, rp).needsShift).toBe(false)
  })
})

describe('void failures', () => {
  it('maps the statuses the server answers with', () => {
    expect(voidFailure(403, {}).kind).toBe('forbidden')
    expect(voidFailure(404, {}).kind).toBe('gone')
    expect(voidFailure(409, { message: 'Struk ini sudah dibatalkan' })).toMatchObject({
      kind: 'done',
      error: 'Struk ini sudah dibatalkan',
    })
    expect(voidFailure(0, null).kind).toBe('offline')
  })
  it('reads the lock: server text and retryAfter', () => {
    const f = voidFailure(429, {
      message: 'Terlalu banyak PIN salah. Coba lagi dalam 5 menit.',
      errors: { pin: 'x' },
      retryAfter: 300,
    })
    expect(f).toMatchObject({ kind: 'locked', retryAfter: 300 })
    expect(f.error).toContain('5 menit')
  })
  it('a wrong PIN is a 422 with errors.pin', () => {
    const f = voidFailure(422, { message: 'Periksa isian', errors: { pin: 'PIN salah' } })
    expect(isWrongPin(f)).toBe(true)
    expect(isWrongPin(voidFailure(422, { message: 'x', errors: { note: 'Tulis alasan pembatalan' } }))).toBe(false)
  })
  it('hides 5xx and junk bodies, and ignores non-string field errors', () => {
    expect(voidFailure(500, { message: 'stack trace' }).error).toBe('Terjadi kesalahan. Coba lagi sebentar lagi.')
    expect(voidFailure(502, '<html>').kind).toBe('other')
    expect(voidFailure(422, { message: 'm', errors: { a: 1, b: 'ok' } }).errors).toEqual({ b: 'ok' })
  })
})

describe('PIN set form', () => {
  it('a first PIN needs six digits and a matching repeat', () => {
    expect(pinSetErrors({ pin: '480213', confirm: '480213', currentPin: '' }, false)).toEqual({})
    expect(pinSetErrors({ pin: '48021', confirm: '', currentPin: '' }, false).pin).toBe('PIN harus 6 angka')
    expect(pinSetErrors({ pin: '480213', confirm: '480214', currentPin: '' }, false).confirm).toBe(
      'Ulangi PIN harus sama',
    )
  })
  it('refuses repeated digits and the obvious runs', () => {
    expect(pinSetErrors({ pin: '111111', confirm: '111111', currentPin: '' }, false).pin).toMatch(/mudah ditebak/)
    expect(pinSetErrors({ pin: '123456', confirm: '123456', currentPin: '' }, false).pin).toMatch(/mudah ditebak/)
  })
  it('a change needs the current PIN', () => {
    expect(pinSetErrors({ pin: '480213', confirm: '480213', currentPin: '' }, true).currentPin).toBeDefined()
    expect(pinSetErrors({ pin: '480213', confirm: '480213', currentPin: '135790' }, true)).toEqual({})
  })
})

describe('lock text', () => {
  it('shows the minutes left, nothing for an expired or missing lock', () => {
    const now = Date.parse('2026-11-25T10:00:00Z')
    expect(lockText('2026-11-25T10:02:30Z', now)).toBe('Terkunci 3 menit lagi')
    expect(lockText('2026-11-25T09:00:00Z', now)).toBeNull()
    expect(lockText(null, now)).toBeNull()
  })
})

describe('refund of an online sale, UMK-1991', () => {
  it('refund guidance for a gateway payment needs no shift and no transfer by the cashier', () => {
    const g = refundGuidance('online', 5123, (n) => `Rp${n}`)
    expect(g.needsShift).toBe(false)
    expect(g.text).toMatch(/gateway/)
    expect(g.text).toMatch(/Rp5123/)
  })
  it('each refund state has its label and next step', () => {
    expect(refundStateText('pending')?.label).toBe('Refund diproses')
    expect(refundStateText('succeeded')?.color).toBe('success')
    const failed = refundStateText('failed')
    expect(failed?.color).toBe('danger')
    expect(failed?.body).toMatch(/dikembalikan manual/)
    expect(refundStateText(null)).toBeNull()
    expect(refundStateText(undefined)).toBeNull()
  })
  it('the manual note is required and at most 200 characters', () => {
    expect(manualNoteError('  ')).toMatch(/Tulis/)
    expect(manualNoteError('transfer ke rekening pelanggan')).toBeUndefined()
    expect(manualNoteError('x'.repeat(201))).toMatch(/200/)
    expect(manualNoteError('x'.repeat(200))).toBeUndefined()
  })
})
