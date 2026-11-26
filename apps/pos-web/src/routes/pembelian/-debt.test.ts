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
  refusalTodo,
  returnPreview,
  returnSummary,
  shortDay,
  signedRupiah,
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
    // After it was paid in full: the debt stays 0, the money comes back outside the system.
    const paid = returnPreview(lines, { a: 2 }, 0)
    expect(paid).toMatchObject({ total: 5_600, remainingAfter: 0, refundDue: 5_600 })
    expect(returnSummary(paid, null, rp)).toBe(
      'Stok berkurang 2 pcs. Hutang berkurang Rp0. Sisa hutang jadi Rp0. Rp5.600 kembali dari pemasok di luar sistem (dicatat sebagai catatan).',
    )
  })

  it('says what to do per refusal code', () => {
    expect(refusalTodo('PURCHASE_OVERPAY', { remaining: 1_400_000 }, rp)).toBe('Isi paling banyak Rp1.400.000.')
    expect(refusalTodo('PURCHASE_OVERPAY', { remaining: 0 }, rp)).toContain('sudah lunas')
    expect(refusalTodo('DRAWER_INSUFFICIENT', { drawerCash: 300_000 }, rp)).toBe(
      'Isi paling banyak Rp300.000, atau pilih Di luar laci.',
    )
    expect(refusalTodo('RETURN_EXCEEDS_BATCH', { available: 2 }, rp)).toBe('Kurangi jumlahnya menjadi paling banyak 2.')
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
    expect(signedRupiah(-1_000_000, rp)).toBe('−Rp1.000.000')
    expect(signedRupiah(50_000, rp, true)).toBe('+Rp50.000')
  })

  it('reads typed amounts as integer rupiah', () => {
    expect(parseAmount('Rp 500.000')).toBe(500_000)
    expect(formatAmountInput('1400000')).toBe('1.400.000')
    expect(formatAmountInput('')).toBe('')
  })
})
