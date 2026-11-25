import { describe, expect, it } from 'vitest'
import {
  cancelBody,
  cashDue,
  cashSwitchError,
  clockText,
  closedText,
  countdown,
  forgetPending,
  isQris,
  keepPolling,
  lateReceiptText,
  outcomeOf,
  paidLater,
  parsePayment,
  paymentFailure,
  pendingSale,
  rememberPending,
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
  it('paidLater shows the paid time only when it is another moment', () => {
    expect(paidLater('2026-11-25T10:00:00Z', null)).toBe(false)
    expect(paidLater('2026-11-25T10:00:00Z', '2026-11-25T10:00:30Z')).toBe(false)
    expect(paidLater('2026-11-25T10:00:00Z', '2026-11-25T10:09:00Z')).toBe(true)
    expect(paidLater('x', 'y')).toBe(false)
  })
})

describe('resume memory', () => {
  const store = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
  }
  it('remembers a sale id and forgets it', () => {
    const s = store()
    expect(pendingSale(s)).toBeNull()
    rememberPending(ID, s)
    expect(pendingSale(s)).toBe(ID)
    forgetPending(s)
    expect(pendingSale(s)).toBeNull()
  })
  it('ignores a stored value that is no id, and never throws when storage does', () => {
    const s = store()
    s.setItem('pos.online-sale', '../../x')
    expect(pendingSale(s)).toBeNull()
    const broken = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(() => rememberPending(ID, broken)).not.toThrow()
    expect(pendingSale(broken)).toBeNull()
    expect(() => forgetPending(broken)).not.toThrow()
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
    expect(dialog('cancel', 503, null).code).toBe('PAYMENT_UNAVAILABLE')
  })

  it('503 on the sale itself says the sale waits and the same key repeats it', () => {
    const d = dialog('sale', 503, { saleId: ID, status: 'awaiting_payment' })
    expect(d.what).toMatch(/Penjualan sudah dibuat/)
    expect(d.todo).toMatch(/tidak akan tercatat dua kali/)
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
