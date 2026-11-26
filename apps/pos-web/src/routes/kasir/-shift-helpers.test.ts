import { describe, expect, it } from 'vitest'
import {
  cashRoute,
  cashRouteNotice,
  CLOSE_BLOCKED_HINT,
  directionLabel,
  drawerAddsUp,
  drawerRows,
  entryKindLabel,
  isPendingPaymentRefusal,
  paymentPlace,
  restAfter,
  signedAmount,
  storeKindLabel,
} from './-shift-helpers'

const rupiah = (n: number) => `Rp${n}`

describe('drawerRows', () => {
  const shift = {
    openingCash: 200_000,
    cashSales: 1_340_000,
    salesCount: 12,
    cashIn: 2_500,
    cashOut: 150_000,
    receivablePayments: 2_500,
    voidRefunds: 30_000,
    expenses: 120_000,
    expenseReversals: 0,
    expectedCash: 1_392_500,
  }

  it('lists opening, sales, each ledger line and the expected cash, and adds up', () => {
    const rows = drawerRows(shift)
    expect(rows.map((r) => r.key)).toEqual(['opening', 'sales', 'receivables', 'expenses', 'voids', 'expected'])
    expect(rows.find((r) => r.key === 'sales')?.label).toBe('Penjualan tunai (12)')
    expect(drawerAddsUp(rows)).toBe(true)
  })

  it('drops zero ledger lines but keeps opening cash and sales', () => {
    const rows = drawerRows({ openingCash: 0, cashSales: 0, expectedCash: 0 })
    expect(rows.map((r) => r.key)).toEqual(['opening', 'sales', 'expected'])
  })

  it('shows cash the named kinds do not explain as "lain" so the rows still add up', () => {
    const rows = drawerRows({ ...shift, cashIn: 12_500, cashOut: 160_000, expectedCash: 1_382_500 + 10_000 })
    expect(rows.find((r) => r.key === 'in-other')?.amount).toBe(10_000)
    expect(rows.find((r) => r.key === 'out-other')?.amount).toBe(10_000)
    expect(drawerAddsUp(rows)).toBe(true)
  })

  it('detects rows that do not add up to the server figure', () => {
    expect(drawerAddsUp(drawerRows({ ...shift, expectedCash: 1 }))).toBe(false)
  })

  it('treats a response without the new fields (older server) as no cash movement', () => {
    const rows = drawerRows({ openingCash: 100, cashSales: 50, expectedCash: 150 })
    expect(drawerAddsUp(rows)).toBe(true)
  })

  it('counts a drawer expense put back as cash in', () => {
    const rows = drawerRows({ openingCash: 100, cashSales: 0, cashIn: 40, expenseReversals: 40, expectedCash: 140 })
    expect(rows.find((r) => r.key === 'reversals')?.amount).toBe(40)
    expect(drawerAddsUp(rows)).toBe(true)
  })
})

describe('ledger entry wording', () => {
  it('names every kind pos-api writes and falls back for an unknown one', () => {
    expect(entryKindLabel('receivable_payment')).toBe('Kasbon dibayar tunai')
    expect(entryKindLabel('void_refund')).toContain('batalkan struk')
    expect(entryKindLabel('expense')).toBe('Pengeluaran dari laci')
    expect(entryKindLabel('expense_reversal')).toBe('Pengeluaran dibatalkan')
    expect(entryKindLabel('something_new')).toBe('Kas lain')
  })

  it('signs the amount by direction', () => {
    expect(signedAmount({ direction: 'in', amount: 2500 }, rupiah)).toBe('+Rp2500')
    expect(signedAmount({ direction: 'out', amount: 30000 }, rupiah)).toBe('-Rp30000')
    expect(directionLabel('in')).toBe('Kas masuk')
    expect(directionLabel('out')).toBe('Kas keluar')
  })
})

describe('close refusal', () => {
  it('recognises the pending-payment refusal', () => {
    expect(isPendingPaymentRefusal('Masih ada penjualan yang menunggu pembayaran: #12, #13')).toBe(true)
    expect(isPendingPaymentRefusal('Tidak ada shift yang terbuka')).toBe(false)
    expect(CLOSE_BLOCKED_HINT).toContain('Riwayat penjualan')
  })
})

describe('cashRoute (where a cash kasbon instalment lands)', () => {
  it('open shift takes it, whoever the actor is', () => {
    expect(cashRoute({ isCash: true, hasOpenShift: true, canOpenShift: true }).kind).toBe('shift')
    expect(cashRoute({ isCash: true, hasOpenShift: true, canOpenShift: false }).kind).toBe('shift')
  })
  it('a sales.create holder without a shift must open one', () => {
    expect(cashRoute({ isCash: true, hasOpenShift: false, canOpenShift: true }).kind).toBe('needs-shift')
  })
  it('receivables-only staff collect outside a shift', () => {
    expect(cashRoute({ isCash: true, hasOpenShift: false, canOpenShift: false }).kind).toBe('outside-shift')
  })
  it('debit and wallet need no shift', () => {
    expect(cashRoute({ isCash: false, hasOpenShift: false, canOpenShift: true }).kind).toBe('none')
  })
  it('words each route', () => {
    expect(cashRouteNotice({ kind: 'none' })).toBeUndefined()
    expect(cashRouteNotice({ kind: 'shift' }, '2026-11-24T00:00:00Z', () => '07.00')).toBe(
      'Tunai masuk kas shift ini (dibuka 07.00).',
    )
    expect(cashRouteNotice({ kind: 'needs-shift' })).toContain('Buka shift dulu')
    expect(cashRouteNotice({ kind: 'outside-shift' })).toContain('di luar shift')
  })
})

describe('instalments are never rounded', () => {
  it('subtracts exactly', () => {
    expect(restAfter(6000, 2500)).toBe(3500)
    expect(restAfter(130_536, 130_536)).toBe(0)
    expect(restAfter(3501, 1)).toBe(3500)
  })
})

describe('paymentPlace', () => {
  it('says outside shift, in shift, or no drawer', () => {
    expect(paymentPlace({ collectedOutsideShift: true, shiftId: null }).label).toBe('Dikumpulkan di luar shift')
    expect(paymentPlace({ collectedOutsideShift: false, shiftId: 's1' }).label).toBe('Masuk laci shift')
    expect(paymentPlace({ collectedOutsideShift: false, shiftId: null }).label).toBe('Tidak lewat laci')
  })
})

describe('store cash', () => {
  it('labels the kinds', () => {
    expect(storeKindLabel('receivable_payment')).toContain('di luar shift')
    expect(storeKindLabel('expense_void')).toBe('Pengeluaran laci dibatalkan setelah shift ditutup')
    expect(storeKindLabel('collector_deposit')).toMatch(/laci shift/)
    expect(entryKindLabel('collector_deposit')).toBe('Setoran penagih diterima')
    expect(storeKindLabel('x')).toBe('Kas toko lain')
  })
})
