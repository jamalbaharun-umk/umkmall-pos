import { describe, expect, it } from 'vitest'
import {
  OPEN_PAST_CODE_TIME,
  cancelBody,
  paidFigures,
  resumeDecision,
  saleFailure,
  cashPaidToSend,
  cashDue,
  cashSwitchError,
  clockText,
  closedText,
  countdown,
  agoText,
  cashSwitchWarning,
  isLink,
  isQris,
  keepPolling,
  vaGroups,
  waitingFor,
  lateReceiptText,
  outcomeOf,
  paidLater,
  parsePayment,
  paymentFailure,
  type SalePayment,
} from './-online'
import { describeError } from '../../lib/describe-error'

const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`
const ID = '0f6c2f0e-6d5c-4c58-9d0e-0c3c6b1a2b3c'

const raw = (over: Record<string, unknown> = {}) => ({
  saleId: ID,
  saleNumber: 12,
  saleStatus: 'awaiting_payment',
  status: 'awaiting_payment',
  online: true,
  method: 'fake_qris',
  paymentMethodId: 'm1',
  paymentMethodName: 'QRIS',
  amount: 5123,
  attempt: 1,
  checkout: { qrString: '000201' },
  expiresAt: '2026-11-25T10:15:00.000Z',
  checkoutExpired: false,
  lastCheckedAt: null,
  canCloseAtGateway: true,
  switchingToCash: false,
  refund: null,
  lateReceipts: [],
  ...over,
})
const pay = (over: Record<string, unknown> = {}) => parsePayment(raw(over)) as SalePayment

describe('parsePayment', () => {
  it('reads a QR payment and a VA payment', () => {
    const q = pay()
    expect(q.checkout && isQris(q.checkout) && q.checkout.qrString).toBe('000201')
    expect(q.amount).toBe(5123)
    const v = pay({ method: 'fake_va', checkout: { bank: 'BCA', vaNumber: '8800123' } })
    expect(v.checkout).toEqual({ bank: 'BCA', vaNumber: '8800123' })
    expect(isQris(v.checkout)).toBe(false)
  })

  it('refuses what is not a payment instead of guessing', () => {
    expect(parsePayment(null)).toBeNull()
    expect(parsePayment('x')).toBeNull()
    expect(parsePayment(raw({ saleId: undefined }))).toBeNull()
    expect(parsePayment(raw({ status: 'mystery' }))).toBeNull()
    expect(parsePayment(raw({ saleStatus: 'mystery' }))).toBeNull()
    expect(parsePayment(raw({ amount: 12.5 }))).toBeNull()
  })

  it('keeps no unknown field and treats a missing checkout as none', () => {
    const p = parsePayment(raw({ secret: 'x', checkout: { token: 'abc' } })) as unknown as Record<string, unknown>
    expect(p.secret).toBeUndefined()
    expect(p.checkout).toBeNull()
  })

  it('reads the late receipts and the refund, dropping a malformed receipt', () => {
    const p = pay({
      lateReceipts: [
        { id: 'r1', attempt: 1, amount: 5123, kind: 'late_payment', refundStatus: 'refunded', needsReview: false },
        { id: 'r2' },
        'x',
      ],
      refund: { status: 'failed', sent: true, reasonCode: 'other', note: null, requestedAt: '2026-11-25T10:00:00Z' },
    })
    expect(p.lateReceipts).toHaveLength(1)
    expect(p.refund?.status).toBe('failed')
  })

  it('canCloseAtGateway is true unless the server says false', () => {
    expect(pay({ canCloseAtGateway: undefined }).canCloseAtGateway).toBe(true)
    expect(pay({ canCloseAtGateway: false }).canCloseAtGateway).toBe(false)
  })
})

describe('outcomeOf and keepPolling', () => {
  it('an open payment waits, also when the QR time is over (only the server expires it)', () => {
    expect(outcomeOf(pay()).kind).toBe('waiting')
    expect(outcomeOf(pay({ checkoutExpired: true })).kind).toBe('waiting')
    expect(keepPolling(pay({ checkoutExpired: true }))).toBe(true)
  })

  it('a completed sale is paid, as cash when the method is cash', () => {
    expect(outcomeOf(pay({ saleStatus: 'completed', status: 'paid' }))).toEqual({ kind: 'paid', cash: false, completed: true })
    expect(outcomeOf(pay({ saleStatus: 'completed', status: 'paid', method: 'cash' }))).toEqual({
      kind: 'paid',
      cash: true,
      completed: true,
    })
  })

  it('a paid bill whose sale is not completed yet is paid but keeps asking', () => {
    const p = pay({ status: 'paid' })
    expect(outcomeOf(p)).toEqual({ kind: 'paid', cash: false, completed: false })
    expect(keepPolling(p)).toBe(true)
    expect(keepPolling(pay({ saleStatus: 'completed', status: 'paid' }))).toBe(false)
  })

  it('expired, failed and cancelled close the sale; a cancelled sale never reads as paid', () => {
    expect(outcomeOf(pay({ status: 'expired' }))).toEqual({ kind: 'closed', why: 'expired' })
    expect(outcomeOf(pay({ status: 'failed' }))).toEqual({ kind: 'closed', why: 'failed' })
    expect(outcomeOf(pay({ status: 'cancelled' }))).toEqual({ kind: 'closed', why: 'cancelled' })
    expect(outcomeOf(pay({ saleStatus: 'cancelled', status: 'expired' }))).toEqual({ kind: 'closed', why: 'expired' })
    expect(outcomeOf(pay({ saleStatus: 'cancelled', status: 'paid' }))).toEqual({ kind: 'closed', why: 'cancelled' })
    expect(keepPolling(pay({ status: 'expired' }))).toBe(false)
  })

  it('every closed reason has its own words', () => {
    const titles = (['expired', 'failed', 'cancelled'] as const).map((w) => closedText(w).title)
    expect(new Set(titles).size).toBe(3)
    expect(closedText('expired').body).toMatch(/stok kembali/)
  })
})

describe('countdown', () => {
  const end = '2026-11-25T10:15:00.000Z'
  const at = (s: string) => new Date(s).getTime()
  it('counts down to the QR time as mm:ss', () => {
    expect(countdown(end, at('2026-11-25T10:00:00.000Z'))).toEqual({ text: '15:00', remainingMs: 900_000, over: false })
    expect(countdown(end, at('2026-11-25T10:14:57.500Z'))?.text).toBe('00:03')
    expect(countdown(end, at('2026-11-25T10:00:00.000Z'))?.text).toBe('15:00')
  })
  it('is over at and after the time, never negative', () => {
    expect(countdown(end, at(end))).toEqual({ text: '00:00', remainingMs: 0, over: true })
    expect(countdown(end, at('2026-11-25T11:00:00.000Z'))?.over).toBe(true)
  })
  it('has nothing to count without a usable time', () => {
    expect(countdown(null, 0)).toBeNull()
    expect(countdown('not a time', 0)).toBeNull()
  })
  it('clockText is null for no time', () => {
    expect(clockText(null)).toBeNull()
    expect(clockText('bad')).toBeNull()
    expect(clockText('2026-11-25T05:20:00.000Z')).toMatch(/12.20/)
  })
})

describe('switch to cash', () => {
  it('the cash due is the total rounded up to Rp100', () => {
    expect(cashDue(5123)).toBe(5200)
    expect(cashDue(5200)).toBe(5200)
  })
  it('checks the cash typed like the server does', () => {
    expect(cashSwitchError('', 5123)).toMatch(/Wajib/)
    expect(cashSwitchError('abc', 5123)).toMatch(/bilangan bulat/)
    expect(cashSwitchError('1,5', 5123)).toMatch(/bilangan bulat/)
    expect(cashSwitchError('5.100', 5123)).toMatch(/kurang/)
    expect(cashSwitchError('5.200', 5123)).toBeUndefined()
    expect(cashSwitchError('10000', 5123)).toBeUndefined()
  })
})

describe('late money and cancel text', () => {
  const late = (refundStatus: 'none' | 'pending' | 'refunded' | 'failed', needsReview = false, kind: 'late_payment' | 'duplicate' | 'amount_mismatch' = 'late_payment') => ({
    id: 'r', attempt: 1, amount: 5123, kind, refundStatus, needsReview,
  })
  it('says where the customer money is', () => {
    expect(lateReceiptText(late('refunded'), rp)).toMatch(/sudah dikembalikan otomatis/)
    expect(lateReceiptText(late('pending'), rp)).toMatch(/sedang dikembalikan/)
    expect(lateReceiptText(late('failed'), rp)).toMatch(/beri tahu pemilik/)
    expect(lateReceiptText(late('none', true), rp)).toMatch(/ditinjau/)
    expect(lateReceiptText(late('none'), rp)).toMatch(/Belum dikembalikan/)
    expect(lateReceiptText(late('refunded', false, 'duplicate'), rp)).toMatch(/ganda/)
    expect(lateReceiptText(late('refunded', false, 'amount_mismatch'), rp)).toMatch(/tidak cocok/)
  })
  it('warns when the code cannot be closed at the gateway', () => {
    expect(cancelBody(pay(), rp)).not.toMatch(/tidak bisa ditutup/)
    expect(cancelBody(pay({ canCloseAtGateway: false }), rp)).toMatch(/masih bisa dibayar sampai habis waktu/)
    expect(cancelBody(pay({ canCloseAtGateway: false }), rp)).toContain('Rp5.123')
  })
  it('says that cash already taken is recorded nowhere when a sale turned into cash is cancelled', () => {
    expect(cancelBody(pay(), rp)).not.toMatch(/tunai/)
    expect(cancelBody(pay({ method: 'cash' }), rp)).toMatch(/Uang tunai yang sudah Anda terima.*kembalikan ke pelanggan/)
    expect(cancelBody(pay({ switchingToCash: true, canCloseAtGateway: false }), rp)).toMatch(/kembalikan ke pelanggan.*masih bisa dibayar/)
  })
  it('paidLater shows the paid time only when it is another moment', () => {
    expect(paidLater('2026-11-25T10:00:00Z', null)).toBe(false)
    expect(paidLater('2026-11-25T10:00:00Z', '2026-11-25T10:00:30Z')).toBe(false)
    expect(paidLater('2026-11-25T10:00:00Z', '2026-11-25T10:09:00Z')).toBe(true)
    expect(paidLater('x', 'y')).toBe(false)
  })
})

describe('paymentFailure and the error dialog', () => {
  const dialog = (route: Parameters<typeof paymentFailure>[0], status: number, body: unknown) =>
    describeError(paymentFailure(route, status, body), 'Aksi ini belum berhasil.')

  it('503 on the switch to cash without a code: nothing happened, check the status first', () => {
    const d = dialog('cash', 503, { message: 'x', code: 'payment_unavailable' })
    expect(d.what).toMatch(/belum menjadi tunai/)
    expect(d.todo).toMatch(/Cek status dulu/)
    expect(d.code).toBe('CASH_SWITCH_UNANSWERED')
  })

  it('503 cash_payment_pending: the sale IS cash, repeat', () => {
    const d = dialog('cash', 503, { message: 'x', code: 'cash_payment_pending' })
    expect(d.what).toMatch(/sudah menjadi tunai/)
    expect(d.todo).toMatch(/Simpan tunai lagi/)
    expect(d.primary).toBe('retry')
  })

  it('503 on another call is a plain "nothing changed, try again"', () => {
    const d = dialog('check', 503, { code: 'payment_unavailable' })
    expect(d.what).toMatch(/tidak ada yang berubah/)
    expect(d.primary).toBe('retry')
    expect(dialog('poll', 503, null).code).toBe('PAYMENT_UNAVAILABLE')
  })

  it('503 on a cancel, refund retry or manual mark never says "nothing changed": the request may have arrived', () => {
    for (const route of ['cancel', 'retry', 'manual', 'refund'] as const) {
      const d = dialog(route, 503, { code: 'payment_unavailable' })
      expect(d.code).toBe('PAYMENT_UNCLEAR')
      expect(d.what).not.toMatch(/tidak ada yang berubah/)
      expect(d.todo).toMatch(/Periksa statusnya dulu/)
    }
  })

  it('503 on the sale itself says the sale waits and the same key repeats it', () => {
    const d = dialog('sale', 503, { saleId: ID, status: 'awaiting_payment' })
    expect(d.what).toMatch(/Stok ditahan/)
    expect(d.todo).toMatch(/tagihan tidak akan ganda/)
    expect(d.code).toBe('PAYMENT_UNAVAILABLE')
  })

  it('409 codes get their own sentence, never the server text', () => {
    expect(dialog('cash', 409, { code: 'already_paid', message: 'x' }).what).toMatch(/sudah membayar/)
    expect(dialog('cancel', 409, { code: 'cancel_refused' }).what).toMatch(/belum bisa ditutup/)
    expect(dialog('refund', 409, { code: 'use_void' }).todo).toMatch(/Batalkan transaksi/)
    expect(dialog('sale', 409, { code: 'use_refund' }).todo).toMatch(/Refund/)
    expect(dialog('sale', 409, { code: 'merchant_not_active', saleId: ID }).what).toMatch(/belum aktif/)
    expect(dialog('sale', 409, { code: 'method_disabled' }).what).toMatch(/dimatikan/)
    expect(dialog('manual', 409, { code: 'not_refund_failed' }).what).toMatch(/ditolak gateway/)
    expect(dialog('cash', 409, { code: 'not_own_sale' }).what).toMatch(/kasir yang membuat/)
  })

  it('a 409 without a known code shows pos-api text when safe', () => {
    expect(dialog('sale', 409, { message: 'Stok Minyak tinggal 3 pcs.' }).what).toBe('Stok Minyak tinggal 3 pcs.')
  })

  it('422 shows the message, 403 and 404 keep their strict wording even with a code', () => {
    expect(dialog('sale', 422, { message: 'Pembayaran online belum tersedia' }).what).toBe('Pembayaran online belum tersedia')
    expect(dialog('retry', 403, { code: 'payment_refused' }).what).toBe('Akun Anda tidak boleh melakukan ini.')
    expect(dialog('poll', 404, { code: 'not_awaiting' }).what).toMatch(/tidak ditemukan/)
  })

  it('no answer at all is offline; an unknown code is not trusted', () => {
    expect(dialog('check', 0, null).code).toBe('OFFLINE')
    expect(paymentFailure('check', 409, { code: 'Robert;DROP' }).code).toBeUndefined()
  })
})

describe('design 26 details', () => {
  it('reads a payment-page link only when it is https', () => {
    const l = pay({ method: 'fake_checkout', checkout: { paymentUrl: 'https://pay.example/abc' } })
    expect(isLink(l.checkout)).toBe(true)
    expect(pay({ checkout: { paymentUrl: 'javascript:alert(1)' } }).checkout).toBeNull()
    expect(pay({ checkout: { paymentUrl: 'http://pay.example/abc' } }).checkout).toBeNull()
  })
  it('writes a VA number in groups of four', () => {
    expect(vaGroups('8077123456789012')).toBe('8077 1234 5678 9012')
    expect(vaGroups('80771')).toBe('8077 1')
  })
  it('says how long ago the last check was', () => {
    const now = new Date('2026-11-25T10:00:10Z').getTime()
    expect(agoText('2026-11-25T10:00:07Z', now)).toBe('3 detik lalu')
    expect(agoText('2026-11-25T09:57:00Z', now)).toBe('3 menit lalu')
    expect(agoText(null, now)).toBeNull()
  })
  it('warns on the switch to cash only when the gateway cannot close the code, with the time it stays valid', () => {
    expect(cashSwitchWarning(pay())).toBeNull()
    expect(cashSwitchWarning(pay({ canCloseAtGateway: false }))).toMatch(/masih berlaku sampai \d\d.\d\d/)
    expect(cashSwitchWarning(pay({ canCloseAtGateway: false, expiresAt: null }))).not.toMatch(/sampai/)
  })
  it('names how long a sale has waited', () => {
    const now = new Date('2026-11-25T10:30:00Z').getTime()
    expect(waitingFor('2026-11-25T10:29:50Z', now)).toBe('baru saja')
    expect(waitingFor('2026-11-25T10:26:00Z', now)).toBe('4 menit')
    expect(waitingFor('2026-11-25T08:00:00Z', now)).toBe('2 jam')
    expect(waitingFor('x', now)).toBe('')
  })
  it('never writes a validity time of its own: the countdown comes from expiresAt, so a longer VA just counts longer', () => {
    const now = new Date('2026-11-25T10:00:00Z').getTime()
    expect(countdown('2026-11-25T11:00:00Z', now)?.text).toBe('60:00')
    expect(countdown('2026-11-25T10:15:00Z', now)?.text).toBe('15:00')
  })
})

describe('cashPaidToSend', () => {
  it('checks what was typed before the intent exists', () => {
    expect(cashPaidToSend(false, '', 5123)).toEqual({ error: expect.stringMatching(/Wajib diisi/) })
    expect(cashPaidToSend(false, '5000', 5123)).toEqual({ error: expect.stringMatching(/kurang/) })
    expect(cashPaidToSend(false, '10.000', 5123)).toEqual({ paid: 10000 })
  })
  it('after the intent nothing is required: an empty field (after a reload) repeats the request with the amount due', () => {
    expect(cashPaidToSend(true, '', 5123)).toEqual({ paid: cashDue(5123) })
    expect(cashPaidToSend(true, 'x', 5123)).toEqual({ paid: cashDue(5123) })
    expect(cashPaidToSend(true, '10000', 5123)).toEqual({ paid: 10000 })
  })
})

describe('saleFailure', () => {
  it('only an online sale that was written but not charged is "sale_waiting"', () => {
    expect(saleFailure(503, undefined, ID, true).code).toBe('sale_waiting')
    // a cash sale that got 503 has no bill: plain wording, not "pembayaran online"
    expect(saleFailure(503, undefined, ID, false).code).toBeUndefined()
    expect(saleFailure(503, undefined, undefined, true).code).toBeUndefined()
    expect(saleFailure(409, 'method_disabled', ID, true)).toEqual({ status: 409, code: 'method_disabled' })
  })
})

describe('closedText: a picked sale', () => {
  it('a picked sale never says the order is still at the till', () => {
    expect(closedText('expired', false).body).not.toMatch(/masih ada di kasir/)
    expect(closedText('failed', false).body).not.toMatch(/keranjang/)
    expect(closedText('expired', true).body).toMatch(/masih ada di kasir/)
  })
})
describe('resumeDecision: what a reload does with the remembered sale', () => {
  const ok = (over: Record<string, unknown>) => ({ ok: true as const, data: pay(over) })
  it('an open sale shows the waiting screen again, also a paid payment whose sale is not complete yet', () => {
    expect(resumeDecision(ok({})).do).toBe('wait')
    expect(resumeDecision(ok({ status: 'paid' })).do).toBe('wait')
  })
  it('a sale completed while the till was away is reported completed (the cart that made it is cleared)', () => {
    expect(resumeDecision(ok({ saleStatus: 'completed', status: 'paid' }))).toEqual({
      do: 'completed',
      saleId: ID,
      saleNumber: 12,
    })
  })
  it('a cancelled sale is only "ended"', () => {
    expect(resumeDecision(ok({ saleStatus: 'cancelled', status: 'expired' }))).toEqual({ do: 'ended', saleNumber: 12, reversed: false })
  })
  it('a sale voided or refunded while the till was away is "ended" and says it was reversed', () => {
    expect(resumeDecision(ok({ saleStatus: 'void', status: 'refunded' }))).toEqual({ do: 'ended', saleNumber: 12, reversed: true })
  })
  it('404 (a deleted sale, or another cashier\'s: the payment route hides it the same way) forgets the sale', () => {
    expect(resumeDecision({ ok: false, failure: paymentFailure('poll', 404, { message: 'x' }) }).do).toBe('forget')
    expect(resumeDecision({ ok: false, failure: { status: 404 } }).do).toBe('forget')
  })
  it('403 keeps the sale and asks again: a permission may come back, and a sale is never dropped on it', () => {
    expect(resumeDecision({ ok: false, failure: paymentFailure('poll', 403, { code: 'not_own_sale' }) }).do).toBe('retry')
    expect(resumeDecision({ ok: false, failure: { status: 403 } }).do).toBe('retry')
  })
  it('a 4xx that can never be answered (400, 422) forgets the sale instead of asking forever; 401, 408 and 429 ask again', () => {
    expect(resumeDecision({ ok: false, failure: { status: 400 } }).do).toBe('forget')
    expect(resumeDecision({ ok: false, failure: { status: 422 } }).do).toBe('forget')
    for (const status of [401, 408, 429]) expect(resumeDecision({ ok: false, failure: { status } }).do).toBe('retry')
  })
  it('a 5xx, an unreadable answer and no answer ask again (never silently drop it)', () => {
    expect(resumeDecision({ ok: false, failure: paymentFailure('poll', 503, null) }).do).toBe('retry')
    expect(resumeDecision({ ok: false, failure: { status: 502 } }).do).toBe('retry')
    expect(resumeDecision({ ok: false, failure: { status: 0 } }).do).toBe('retry')
    expect(resumeDecision({ ok: false, failure: {} }).do).toBe('retry')
    expect(resumeDecision(null).do).toBe('retry')
  })
})

describe('an open payment past its code time', () => {
  it('is never called expired and never promises a refund: only the server may close it', () => {
    const text = `${OPEN_PAST_CODE_TIME.title} ${OPEN_PAST_CODE_TIME.body}`
    expect(text).not.toMatch(/kedaluwarsa/i)
    expect(text).not.toMatch(/dikembalikan/i)
    expect(OPEN_PAST_CODE_TIME.body).toMatch(/tetap selesai/)
  })
})

describe('paidFigures', () => {
  it('reads the cash and change the sale recorded, in whole rupiah only', () => {
    expect(paidFigures({ paid: 50000, change: 4900, number: 1 })).toEqual({ paid: 50000, change: 4900 })
    expect(paidFigures({ paid: 50000 })).toBeNull()
    expect(paidFigures({ paid: 1.5, change: 0 })).toBeNull()
    expect(paidFigures({ paid: -1, change: 0 })).toBeNull()
    expect(paidFigures(null)).toBeNull()
  })
})
