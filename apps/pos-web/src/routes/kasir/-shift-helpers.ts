// Pure helpers for the shift cash screens and the cash kasbon instalment (UMK-1963). pos-api computes every figure
// (expected cash, totals, which ledger a payment lands in); these only label, order and explain them.

export type CashTotals = {
  cashIn: number
  cashOut: number
  /** Cash kasbon payments taken in the shift (part of cashIn). */
  receivablePayments: number
  /** Cash given back for voided sales (part of cashOut). */
  voidRefunds: number
  /** Expenses and supplier payments paid from the drawer (part of cashOut). */
  expenses: number
  /** Voided drawer expenses put back (part of cashIn). */
  expenseReversals: number
}

export const NO_CASH: CashTotals = {
  cashIn: 0,
  cashOut: 0,
  receivablePayments: 0,
  voidRefunds: 0,
  expenses: 0,
  expenseReversals: 0,
}

export type DrawerRow = { key: string; label: string; amount: number; sign: '+' | '-' | ''; strong?: boolean }

/**
 * The drawer arithmetic as the closing screen shows it: opening cash + cash sales + cash in - cash out. Cash in and
 * out the named kinds do not explain are kept as "lain" rows, so the rows always add up to `expectedCash`.
 * Zero lines are dropped (a shift with no expenses shows no expense row), except the opening cash and the sales.
 */
export function drawerRows(
  s: {
    openingCash: number
    cashSales: number | null
    salesCount?: number | null
    expectedCash: number | null
  } & Partial<CashTotals>,
): DrawerRow[] {
  const c = { ...NO_CASH, ...s }
  const otherIn = c.cashIn - c.receivablePayments - c.expenseReversals
  const otherOut = c.cashOut - c.voidRefunds - c.expenses
  const rows: DrawerRow[] = [
    { key: 'opening', label: 'Uang awal di laci', amount: s.openingCash, sign: '' },
    {
      key: 'sales',
      label: s.salesCount == null ? 'Penjualan tunai' : `Penjualan tunai (${s.salesCount})`,
      amount: s.cashSales ?? 0,
      sign: '+',
    },
    { key: 'receivables', label: 'Kasbon dibayar tunai', amount: c.receivablePayments, sign: '+' },
    { key: 'reversals', label: 'Pengeluaran dibatalkan (uang kembali ke laci)', amount: c.expenseReversals, sign: '+' },
    { key: 'in-other', label: 'Kas masuk lain', amount: otherIn, sign: '+' },
    { key: 'expenses', label: 'Pengeluaran dari laci', amount: c.expenses, sign: '-' },
    { key: 'voids', label: 'Uang dikembalikan (batalkan struk)', amount: c.voidRefunds, sign: '-' },
    { key: 'out-other', label: 'Kas keluar lain', amount: otherOut, sign: '-' },
  ]
  const shown = rows.filter((r) => r.key === 'opening' || r.key === 'sales' || r.amount !== 0)
  return [...shown, { key: 'expected', label: 'Seharusnya di laci', amount: s.expectedCash ?? 0, sign: '', strong: true }]
}

/** Whether the rows above add up to the server's expected cash (a guard for the screen, not a calculation of it). */
export function drawerAddsUp(rows: DrawerRow[]): boolean {
  const expected = rows.find((r) => r.key === 'expected')?.amount ?? 0
  const sum = rows
    .filter((r) => r.key !== 'expected')
    .reduce((n, r) => n + (r.sign === '-' ? -r.amount : r.amount), 0)
  return sum === expected
}

export type LedgerEntry = {
  id: string
  direction: 'in' | 'out'
  kind: string
  amount: number
  refId: string | null
  note: string | null
  createdAt: string
}

const KIND_LABELS: Record<string, string> = {
  receivable_payment: 'Kasbon dibayar tunai',
  void_refund: 'Uang dikembalikan (batalkan struk)',
  expense: 'Pengeluaran dari laci',
  expense_reversal: 'Pengeluaran dibatalkan',
  collector_deposit: 'Setoran penagih diterima',
}

/** The reason of a cash in/out entry in words; an unknown kind (a newer server) is shown as what it is. */
export const entryKindLabel = (kind: string) => KIND_LABELS[kind] ?? 'Kas lain'

/** "Kas masuk" / "Kas keluar" for the badge next to an entry. */
export const directionLabel = (d: 'in' | 'out') => (d === 'in' ? 'Kas masuk' : 'Kas keluar')

/** An entry's amount with its sign: "+Rp2.500" or "-Rp120.000" (the caller formats the rupiah). */
export const signedAmount = (e: { direction: 'in' | 'out'; amount: number }, fmt: (n: number) => string) =>
  `${e.direction === 'in' ? '+' : '-'}${fmt(e.amount)}`

/** What to do about a close refused for pending payments. */
export const CLOSE_BLOCKED_HINT =
  'Selesaikan atau batalkan pembayaran itu dari Riwayat penjualan, lalu tutup shift lagi.'

/** pos-api answers 409 with this message prefix while a sale of the shift awaits payment. */
export const isPendingPaymentRefusal = (message: string) => message.startsWith('Masih ada penjualan yang menunggu')

// ---- cash kasbon instalment ----

export type CashRoute =
  /** Debit, wallet: no drawer, no shift needed. */
  | { kind: 'none' }
  /** The actor's open shift gets the cash. */
  | { kind: 'shift' }
  /** The actor can open a shift but has none: pos-api answers 422 until one is open. */
  | { kind: 'needs-shift' }
  /** The actor cannot open a shift (receivables only): collected outside a shift, into the store cash. */
  | { kind: 'outside-shift' }

/**
 * Where a kasbon instalment's cash lands, mirroring pos-api's decision so the form can say it before the click:
 * an open shift takes it; without one, a `sales.create` holder must open a shift; anyone else collects outside
 * a shift. pos-api decides again on the server, this only informs.
 */
export function cashRoute(input: { isCash: boolean; hasOpenShift: boolean; canOpenShift: boolean }): CashRoute {
  if (!input.isCash) return { kind: 'none' }
  if (input.hasOpenShift) return { kind: 'shift' }
  return { kind: input.canOpenShift ? 'needs-shift' : 'outside-shift' }
}

/** The line shown under the payment form for each route (Indonesian). */
export function cashRouteNotice(
  route: CashRoute,
  shiftOpenedAt?: string,
  fmtTime?: (iso: string) => string,
): string | undefined {
  switch (route.kind) {
    case 'none':
      return undefined
    case 'shift':
      return shiftOpenedAt && fmtTime
        ? `Tunai masuk kas shift ini (dibuka ${fmtTime(shiftOpenedAt)}).`
        : 'Tunai masuk kas shift ini.'
    case 'needs-shift':
      return 'Buka shift dulu untuk menerima kasbon tunai. Transfer dan QRIS tetap bisa dicatat.'
    case 'outside-shift':
      return 'Anda tidak memegang shift. Tunai dicatat sebagai dikumpulkan di luar shift dan masuk kas toko.'
  }
}

/** Instalments are never rounded: the rest after paying is plain subtraction, floored at 0. */
export const restAfter = (rest: number, amount: number) => Math.max(0, rest - amount)

export type PaymentPlace = { label: string; tone: 'success' | 'warning' | 'neutral' }

/** Where a recorded instalment's money went, from the receivable's payment row. */
export function paymentPlace(p: { collectedOutsideShift: boolean; shiftId: string | null }): PaymentPlace {
  if (p.collectedOutsideShift) return { label: 'Dikumpulkan di luar shift', tone: 'warning' }
  if (p.shiftId) return { label: 'Masuk laci shift', tone: 'success' }
  return { label: 'Tidak lewat laci', tone: 'neutral' }
}

// ---- store cash ("kas toko") ----

const STORE_KIND_LABELS: Record<string, string> = {
  receivable_payment: 'Kasbon dibayar tunai di luar shift',
  expense_void: 'Pengeluaran laci dibatalkan setelah shift ditutup',
  collector_deposit: 'Setoran penagih masuk ke laci shift',
}
export const storeKindLabel = (kind: string) => STORE_KIND_LABELS[kind] ?? 'Kas toko lain'
