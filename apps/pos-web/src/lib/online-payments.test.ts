import { describe, expect, it } from 'vitest'
import { dismissError, errorDialogState, showError } from './feedback'
import {
  canEditDraft,
  canSwitchMethods,
  describeOnlineError,
  draftBody,
  draftErrors,
  emptyDraft,
  methodHint,
  methodLabel,
  modeLabel,
  normalizePhone,
  providerLabel,
  safeHostedUrl,
  statusView,
  submitErrors,
} from './online-payments'

const filled = { businessType: 'individual', businessName: 'Warung Bu Sari', email: 'sari@contoh.id', phone: '0812 3456 7890', terms: true }

describe('statusView', () => {
  it('names all seven statuses in Indonesian with the next step', () => {
    expect(statusView('not_submitted')).toMatchObject({ label: 'Belum diajukan', step: 'fill' })
    expect(statusView('submitted')).toMatchObject({ label: 'Diajukan', step: 'verify' })
    expect(statusView('needs_fix')).toMatchObject({ label: 'Perlu perbaikan', step: 'fix' })
    expect(statusView('rejected')).toMatchObject({ label: 'Ditolak', tone: 'danger', step: 'help' })
    expect(statusView('verified')).toMatchObject({ label: 'Terverifikasi', tone: 'success', step: 'methods' })
    expect(statusView('active')).toMatchObject({ label: 'Aktif', step: 'methods' })
    expect(statusView('suspended')).toMatchObject({ label: 'Ditangguhkan', step: 'locked' })
  })
  it('shows an unknown status read-only instead of throwing', () => {
    expect(statusView('wat')).toMatchObject({ label: 'Status tidak dikenal', step: 'locked' })
  })
  it('methods switch only when verified or active; the draft is editable only before submitting', () => {
    expect(['verified', 'active'].every(canSwitchMethods)).toBe(true)
    for (const s of ['not_submitted', 'submitted', 'needs_fix', 'rejected', 'suspended']) expect(canSwitchMethods(s)).toBe(false)
    expect(canEditDraft('not_submitted')).toBe(true)
    expect(canEditDraft('needs_fix')).toBe(false)
  })
})

describe('labels', () => {
  it('modes, providers and methods', () => {
    expect(modeLabel('fake')).toBe('Mode: Tiruan')
    expect(modeLabel('sandbox')).toBe('Mode: Sandbox')
    expect(modeLabel('live')).toBe('Mode: Live')
    expect(providerLabel('xendit')).toBe('Xendit')
    expect(providerLabel('midtrans')).toBe('Midtrans')
    expect(methodLabel('fake_qris')).toBe('QRIS dinamis')
    expect(methodLabel('fake_va')).toBe('Virtual Account (VA)')
    expect(methodLabel('fake_checkout')).toBe('Checkout tiruan')
    expect(methodLabel('some_new_one')).toBe('some new one')
  })
  it('method hints follow the lock', () => {
    const m = { method: 'fake_qris', enabled: true, chargeable: true }
    expect(methodHint(m, 'active')).toBe('Menyala di kasir')
    expect(methodHint({ ...m, enabled: false }, 'verified')).toBe('Mati')
    expect(methodHint(m, 'suspended')).toBe('Belum bisa dinyalakan')
  })
})

describe('the short draft', () => {
  it('asks for no identity, document or bank field: the body has four fields only', () => {
    expect(Object.keys(draftBody(filled)).sort()).toEqual(['businessName', 'businessType', 'email', 'phone'])
    expect(Object.keys(emptyDraft()).sort()).toEqual(['businessName', 'businessType', 'email', 'phone', 'terms'])
  })
  it('sends the phone as digits and an empty field as null', () => {
    expect(normalizePhone('0812-3456 (7890)')).toBe('081234567890')
    expect(draftBody({ ...filled, businessName: '  ', email: '' })).toEqual({
      businessType: 'individual',
      businessName: null,
      email: null,
      phone: '081234567890',
    })
    expect(draftBody({ ...filled, businessType: '' }).businessType).toBeNull()
  })
  it('saving a partial draft passes; a wrong value does not', () => {
    expect(draftErrors(emptyDraft())).toEqual({})
    expect(draftErrors({ ...filled, email: 'bukan-email' }).email).toMatch(/email/i)
    expect(draftErrors({ ...filled, phone: '123' }).phone).toMatch(/HP/)
    expect(draftErrors({ ...filled, businessName: 'x'.repeat(121) }).businessName).toMatch(/120/)
  })
  it('submitting needs all four fields and the terms', () => {
    expect(submitErrors(filled)).toEqual({})
    const e = submitErrors(emptyDraft())
    expect(Object.keys(e).sort()).toEqual(['businessName', 'businessType', 'email', 'phone', 'terms'])
    expect(submitErrors({ ...filled, terms: false }).terms).toMatch(/Syarat/)
  })
})

describe('safeHostedUrl', () => {
  it('opens only http(s) addresses', () => {
    expect(safeHostedUrl('https://gateway.test/verify?t=1')).toBe('https://gateway.test/verify?t=1')
    expect(safeHostedUrl('http://localhost:4000/v')).toBe('http://localhost:4000/v')
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.test', 'not a url', '', null, 5]) expect(safeHostedUrl(bad)).toBeNull()
  })
})

describe('describeOnlineError', () => {
  it('maps payment-api refusal codes to screen text, with the code shown upper case', () => {
    const d = describeOnlineError({ status: 409, code: 'merchant_locked', error: 'Data tidak bisa diubah pada status ini' }, 'x')
    expect(d).toMatchObject({ code: 'MERCHANT_LOCKED', primary: 'reload' })
    expect(d.what).toMatch(/tidak bisa diubah/)
    expect(describeOnlineError({ status: 409, code: 'merchant_not_verified' }, 'x').todo).toMatch(/Cek status/)
    expect(describeOnlineError({ status: 422, code: 'draft_incomplete' }, 'x').todo).toMatch(/nomor HP/)
  })
  it('403 says owner only and never echoes server text', () => {
    const d = describeOnlineError({ status: 403, error: 'Forbidden resource payments.manage' }, 'x')
    expect(d.what).toMatch(/pemilik toko/)
    expect(d.what).not.toMatch(/Forbidden/)
    expect(d.primary).toBe('none')
  })
  it('503 is the gateway not answering, with a retry and a help code', () => {
    const d = describeOnlineError({ status: 503, error: 'Layanan pembayaran sedang tidak bisa dihubungi, coba lagi' }, 'x')
    expect(d).toMatchObject({ code: 'GATEWAY_UNAVAILABLE', primary: 'retry' })
    expect(d.what).toMatch(/tidak menjawab/)
  })
  it('409 and 422 without a known code use the safe pos-api sentence, else a generic one', () => {
    expect(describeOnlineError({ status: 409, error: 'Metode bentrok.' }, 'x').what).toBe('Metode bentrok.')
    expect(describeOnlineError({ status: 409, error: 'duplicate key value violates (sql)' }, 'x').what).toMatch(/sudah berubah/)
    expect(describeOnlineError({ status: 422 }, 'x').what).toBe('Isian belum benar.')
  })
  it('an unknown code or a status without a mapping goes through the shared mapping', () => {
    expect(describeOnlineError({ status: 404, code: 'zzz' }, 'x').primary).toBe('reload')
    expect(describeOnlineError({ status: 0 }, 'x').code).toBe('OFFLINE')
    expect(describeOnlineError({ status: 401 }, 'x').primary).toBe('signin')
  })
  it('the error dialog takes a screen mapping and titles the failed action', () => {
    showError({ status: 503 }, { action: 'mengajukan Pembayaran Online' }, describeOnlineError)
    expect(errorDialogState()).toMatchObject({ title: 'Gagal mengajukan Pembayaran Online', code: 'GATEWAY_UNAVAILABLE' })
    dismissError()
    expect(errorDialogState()).toBeNull()
  })
})
