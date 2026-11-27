import { describe, expect, it } from 'vitest'
import {
  drawerNotice,
  dueText,
  formatAmountInput,
  historyRows,
  matchesPayFilter,
  noMatchText,
  parseAmount,
  payAmountError,
  refundAmountError,
  refundNotice,
  refusalTodo,
  returnPreview,
  returnSummary,
  shortDay,
  signedRupiah,
  returnDebtText,
  statusBadge,
} from './-debt'

const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`

describe('purchase debt helpers (UMK-1970)', () => {
  it('filters by payment status; late is its own filter; drafts show under Semua only', () => {
    const late = { status: 'approved', paymentStatus: 'sebagian' as const, overdueDays: 2 }
    const draft = { status: 'draft', paymentStatus: null, overdueDays: null }
    expect(matchesPayFilter(late, 'sebagian')).toBe(true)
    expect(matchesPayFilter(late, 'terlambat')).toBe(true)
    expect(matchesPayFilter(late, 'lunas')).toBe(false)
    expect(matchesPayFilter(draft, 'semua')).toBe(true)
    expect(matchesPayFilter(draft, 'belum_bayar')).toBe(false)
    expect(noMatchText('terlambat')).toBe('Tidak ada pembelian terlambat.')
  })

  it('badges: late wins over the payment status; drafts keep the document status', () => {
    expect(statusBadge({ status: 'approved', paymentStatus: 'sebagian', overdueDays: 2 })).toEqual({
      label: 'Terlambat 2 hari',
      tone: 'danger',
    })
    expect(statusBadge({ status: 'approved', paymentStatus: 'lunas', overdueDays: null }).label).toBe('Lunas')
    expect(statusBadge({ status: 'approved', paymentStatus: 'belum_bayar' }).label).toBe('Belum bayar')
    expect(statusBadge({ status: 'draft' }).label).toBe('Draf')
  })

  it("due text in the design's words", () => {
    expect(shortDay('2026-11-30')).toBe('30 Nov')
    expect(dueText({ dueDate: '2026-11-30', dueInDays: 4, paymentStatus: 'sebagian' })).toBe(
      'jatuh tempo 30 Nov (4 hari lagi)',
    )
    expect(dueText({ dueDate: '2026-11-24', dueInDays: -2, paymentStatus: 'belum_bayar' })).toBe(
      'jatuh tempo 24 Nov (terlambat 2 hari)',
    )
    expect(dueText({ dueDate: '2026-11-26', dueInDays: 0 })).toBe('jatuh tempo 26 Nov (hari ini)')
    expect(dueText({ dueDate: '2026-11-24', dueInDays: -2, paymentStatus: 'lunas' })).toBe('jatuh tempo 24 Nov')
    expect(dueText({ dueDate: null, dueInDays: null })).toBeNull()
  })

  it('caps the amount at the debt and explains the drawer (Rp1.390.000 − Rp500.000 = Rp890.000)', () => {
    expect(payAmountError(0, 1_400_000)).toBe('Harus lebih dari 0')
    expect(payAmountError(1_600_000, 1_400_000)).toBe('Jumlah melebihi sisa hutang.')
    expect(payAmountError(1_400_000, 1_400_000)).toBeUndefined()
    expect(drawerNotice('drawer', 500_000, 1_390_000, rp)).toEqual({
      text: 'Laci berkurang Rp500.000 (tersisa Rp890.000). Butuh shift terbuka.',
      tone: 'info',
    })
    expect(drawerNotice('drawer', 0, 890_000, rp).text).toBe('Uang di laci sekarang Rp890.000. Butuh shift terbuka.')
    expect(drawerNotice('drawer', 500_000, null, rp).tone).toBe('warning')
    expect(drawerNotice('drawer', 500_001, 500_000, rp).text).toContain('kurang dari jumlah')
    expect(drawerNotice('outside', 500_000, null, rp).text).toBe('Tidak mengubah uang di laci.')
  })

  it("previews the design's return: 10 pcs at Rp2.800 lowers Rp1.400.000 to Rp1.372.000", () => {
    const lines = [
      { id: 'a', unitCost: 2_800, returnable: 40 },
      { id: 'b', unitCost: 45_760, returnable: 50 },
    ]
    const p = returnPreview(lines, { a: 10 }, 1_400_000)
    expect(p).toEqual({ units: 10, total: 28_000, overBatch: false, remainingAfter: 1_372_000, refundDue: 0 })
    expect(returnSummary(p, { unitCost: 2_800, qty: 10 }, rp)).toBe(
      'Stok berkurang 10 pcs. Hutang berkurang Rp28.000 (Rp2.800 × 10). Sisa hutang jadi Rp1.372.000.',
    )
    expect(returnPreview(lines, { a: 41 }, 1_400_000).overBatch).toBe(true)
    // After it was paid in full: the debt stays 0, the supplier owes the money back.
    const paid = returnPreview(lines, { a: 2 }, 0)
    expect(paid).toMatchObject({ total: 5_600, remainingAfter: 0, refundDue: 5_600 })
    expect(returnSummary(paid, null, rp)).toBe(
      'Stok berkurang 2 pcs. Hutang berkurang Rp0. Sisa hutang jadi Rp0. Rp5.600 harus dikembalikan pemasok; catat lewat Terima uang retur.',
    )
  })

  it('says what to do per refusal code', () => {
    expect(refusalTodo('PURCHASE_OVERPAY', { remaining: 1_400_000 }, rp)).toBe('Isi paling banyak Rp1.400.000.')
    expect(refusalTodo('PURCHASE_OVERPAY', { remaining: 0 }, rp)).toContain('sudah lunas')
    expect(refusalTodo('DRAWER_INSUFFICIENT', { drawerCash: 300_000 }, rp)).toBe(
      'Isi paling banyak Rp300.000, atau pilih Di luar laci.',
    )
    expect(refusalTodo('RETURN_EXCEEDS_BATCH', { available: 2 }, rp)).toBe('Kurangi jumlahnya menjadi paling banyak 2.')
    expect(refusalTodo('REFUND_EXCEEDS_DUE', { refundDue: 20_000 }, rp)).toBe('Isi paling banyak Rp20.000.')
    expect(refusalTodo('REFUND_EXCEEDS_DUE', { refundDue: 0 }, rp)).toContain('Tidak ada lagi')
    expect(refusalTodo('RETURN_REFUNDED', { refunded: 10_000 }, rp)).toBe(
      'Batalkan dulu uang retur yang diterima (Rp10.000) di riwayat, lalu coba lagi.',
    )
    expect(refusalTodo('REFUND_RECEIVED', { refunded: 10_000 }, rp)).toContain('Rp10.000')
    expect(refusalTodo('OTHER', {}, rp)).toBeUndefined()
  })

  it('history: the purchase, payments (a voided one keeps its row plus a reversal line) and returns, oldest first', () => {
    const rows = historyRows(
      {
        approvedAt: '2026-11-24T03:00:00Z',
        total: 112_000,
        lines: [{ id: 'l1', productName: 'Indomie Goreng', qty: 40 }],
      },
      [
        {
          id: 'p1',
          amount: 50_000,
          source: 'drawer',
          note: null,
          actorName: 'Pemilik',
          createdAt: '2026-11-26T03:00:00Z',
          voidedAt: '2026-11-26T04:00:00Z',
          voidReason: 'Salah jumlah',
          drawerReversed: true,
        },
      ],
      [
        {
          id: 'r1',
          reason: 'rusak',
          reasonLabel: 'Barang rusak',
          note: null,
          total: 28_000,
          refundDue: 0,
          actorName: 'Pemilik',
          createdAt: '2026-11-26T05:00:00Z',
          lines: [{ orderLineId: 'l1', qty: 10, unitCost: 2_800 }],
        },
      ],
      rp,
    )
    expect(rows.map((r) => [r.kind, r.detail, r.amount])).toEqual([
      ['Pembelian', '40 Indomie Goreng', 112_000],
      ['Pembayaran (laci)', 'Dari laci kasir', -50_000],
      ['Pembayaran dibatalkan', 'Salah jumlah · uang kembali ke laci', 50_000],
      ['Retur', '10 Indomie Goreng · Barang rusak', -28_000],
    ])
    expect(rows[1].voided).toBe(true)
    expect(rows[1].undo).toEqual({ type: 'payment', id: 'p1' })
    expect(rows[2].plus).toBe(true)
    expect(rows[3].undo).toEqual({ type: 'return', id: 'r1' })
    expect(signedRupiah(-1_000_000, rp)).toBe('−Rp1.000.000')
    expect(signedRupiah(50_000, rp, true)).toBe('+Rp50.000')
  })

  it('history: an undone return keeps its row plus a reversal; refunds and their voids say where the money went', () => {
    const rows = historyRows(
      { approvedAt: null, total: 150_000, lines: [{ id: 'l1', productName: 'Mentega', qty: 10 }] },
      [],
      [
        {
          id: 'r1',
          reason: 'rusak',
          reasonLabel: 'Barang rusak',
          note: null,
          total: 30_000,
          refundDue: 30_000,
          actorName: 'Pemilik',
          createdAt: '2026-11-26T01:00:00Z',
          reversedAt: '2026-11-26T05:00:00Z',
          reverseReason: 'Salah catat',
          reversedByName: 'Pemilik',
          lines: [{ orderLineId: 'l1', qty: 2, unitCost: 15_000 }],
        },
      ],
      rp,
      [
        {
          id: 'f1',
          amount: 10_000,
          destination: 'drawer',
          note: null,
          actorName: 'Pemilik',
          createdAt: '2026-11-26T02:00:00Z',
          voidedAt: '2026-11-26T03:00:00Z',
          voidReason: 'Salah jumlah',
          drawerReversed: false,
        },
      ],
    )
    expect(rows.map((r) => [r.kind, r.detail, r.amount, !!r.voided])).toEqual([
      ['Retur', '2 Mentega · Barang rusak · Rp30.000 harus dikembalikan pemasok', -30_000, true],
      ['Uang retur diterima', 'masuk laci kasir', 10_000, true],
      ['Uang retur dibatalkan', 'Salah jumlah · uang keluar dari kas toko', -10_000, false],
      ['Retur dibatalkan', 'Salah catat · barang kembali ke stok', 30_000, false],
    ])
    expect(rows[1].undo).toEqual({ type: 'refund', id: 'f1' })
    expect(rows[3].plus).toBe(true)
    // UMK-2089: money back reads +Rp when it came in and −Rp when it was cancelled.
    expect(signedRupiah(rows[1].amount, rp, rows[1].plus)).toBe('+Rp10.000')
    expect(signedRupiah(rows[2].amount, rp, rows[2].plus)).toBe('−Rp10.000')
  })

  it('caps money back at what is due and explains where it goes', () => {
    expect(refundAmountError(0, 30_000)).toBe('Harus lebih dari 0')
    expect(refundAmountError(30_001, 30_000)).toContain('melebihi')
    expect(refundAmountError(30_000, 30_000)).toBeUndefined()
    expect(refundNotice('store_cash', 10_000, null, rp).tone).toBe('info')
    expect(refundNotice('drawer', 10_000, null, rp)).toMatchObject({ tone: 'warning' })
    expect(refundNotice('drawer', 10_000, 100_000, rp).text).toBe(
      'Laci bertambah Rp10.000 (jadi Rp110.000). Butuh shift terbuka.',
    )
  })

  it('says what to do in the words of the dialog the refusal came from', () => {
    // Pay dialog: the other source is "Di luar laci".
    expect(refusalTodo('SHIFT_REQUIRED', {}, rp, 'pay')).toBe('Buka shift dulu, atau pilih Di luar laci.')
    expect(refusalTodo('DRAWER_PERMISSION', {}, rp, 'pay')).toContain('Di luar laci')
    expect(refusalTodo('DRAWER_INSUFFICIENT', { drawerCash: 300_000 }, rp, 'pay')).toBe(
      'Isi paling banyak Rp300.000, atau pilih Di luar laci.',
    )
    // Refund dialog: the other destination is "Kas toko", never "Di luar laci".
    expect(refusalTodo('SHIFT_REQUIRED', {}, rp, 'refund')).toBe('Buka shift dulu, atau pilih Kas toko.')
    expect(refusalTodo('DRAWER_PERMISSION', {}, rp, 'refund')).toBe('Pilih Kas toko, atau minta pemilik memberi izin kasir.')
    expect(refusalTodo('AGENT_FORBIDDEN', {}, rp, 'refund')).toContain('Kas toko')
    for (const code of ['SHIFT_REQUIRED', 'DRAWER_PERMISSION', 'AGENT_FORBIDDEN'])
      expect(refusalTodo(code, {}, rp, 'refund')).not.toContain('Di luar laci')
    // Refund void dialog: no amount field to change.
    const voidTodo = refusalTodo('DRAWER_INSUFFICIENT', { drawerCash: 4_000 }, rp, 'refund_void')!
    expect(voidTodo).toContain('Rp4.000')
    expect(voidTodo).not.toMatch(/Isi paling banyak|Di luar laci/)
    // ...the store cash it would leave holds too little (never below zero), or the drawer was another cashier's.
    const storeTodo = refusalTodo('STORE_CASH_INSUFFICIENT', { available: 2_500 }, rp, 'refund_void')!
    expect(storeTodo).toContain('Kas toko sekarang berisi Rp2.500')
    expect(storeTodo).not.toMatch(/Isi paling banyak|Di luar laci/)
    expect(refusalTodo('STORE_CASH_INSUFFICIENT', {}, rp, 'refund_void')).toContain('Rp0')
    expect(refusalTodo('DRAWER_REFUND_NOT_YOURS', {}, rp, 'refund_void')).toBe(
      'Uang ini masuk laci kasir lain. Minta kasir shift itu, admin, atau pemilik untuk membatalkannya.',
    )
    // Undo and payment void: the refunds to void first.
    expect(refusalTodo('RETURN_REFUNDED', { refunded: 10_000 }, rp, 'return_undo')).toContain('Rp10.000')
    expect(refusalTodo('REFUND_RECEIVED', { refunded: 10_000 }, rp, 'payment_void')).toContain('Rp10.000')
  })

  it("a return's row says what the supplier handed back of it, oldest return first", () => {
    const ret = (id: string, at: string, refundDue: number) => ({
      id,
      reason: 'rusak',
      reasonLabel: 'Barang rusak',
      note: null,
      total: refundDue,
      refundDue,
      actorName: 'Pemilik',
      createdAt: at,
      lines: [{ orderLineId: 'l1', qty: 1, unitCost: refundDue }],
    })
    const refund = (id: string, amount: number, voidedAt: string | null = null) => ({
      id,
      amount,
      destination: 'store_cash' as const,
      note: null,
      actorName: 'Pemilik',
      createdAt: '2026-11-26T09:00:00Z',
      voidedAt,
      voidReason: voidedAt ? 'x' : null,
      drawerReversed: null,
    })
    const rows = historyRows(
      { approvedAt: null, total: 100, lines: [{ id: 'l1', productName: 'Mentega', qty: 10 }] },
      [],
      [ret('r1', '2026-11-26T01:00:00Z', 30_000), ret('r2', '2026-11-26T02:00:00Z', 15_000)],
      rp,
      [refund('f1', 40_000), refund('f2', 5_000, '2026-11-26T10:00:00Z')],
    )
    expect(rows.filter((r) => r.kind === 'Retur').map((r) => r.detail)).toEqual([
      '1 Mentega · Barang rusak · Rp30.000 sudah dikembalikan pemasok',
      '1 Mentega · Barang rusak · Rp10.000 sudah kembali, Rp5.000 masih harus dikembalikan pemasok',
    ])
  })

  it('reads typed amounts as integer rupiah', () => {
    expect(parseAmount('Rp 500.000')).toBe(500_000)
    expect(formatAmountInput('1400000')).toBe('1.400.000')
    expect(formatAmountInput('')).toBe('')
  })
})

describe('returnDebtText (UMK-2089)', () => {
  const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`

  it('a return on a purchase that still owed money lowers the debt', () => {
    expect(returnDebtText({ returned: 31_000, credit: 0, refundDue: 0, refunded: 0 }, rp)).toBe(
      'Retur mengurangi hutang Rp31.000.',
    )
  })

  it('a return on a purchase paid in full lowers nothing: all of it is owed back', () => {
    const text = returnDebtText({ returned: 31_000, credit: 31_000, refundDue: 31_000, refunded: 0 }, rp)
    expect(text).not.toContain('mengurangi hutang')
    expect(text).toBe('Retur Rp31.000: hutang sudah lunas, jadi tidak ada hutang yang berkurang. Pemasok masih harus mengembalikan Rp31.000.')
  })

  it('splits a return that is partly debt and partly credit, and says what came back', () => {
    expect(returnDebtText({ returned: 31_000, credit: 11_000, refundDue: 1_000, refunded: 10_000 }, rp)).toBe(
      'Retur mengurangi hutang Rp20.000. Pemasok masih harus mengembalikan Rp1.000. Sudah diterima kembali Rp10.000.',
    )
  })

  it('says nothing without a return', () => {
    expect(returnDebtText({ returned: 0, credit: 0 }, rp)).toBe('')
  })
})
