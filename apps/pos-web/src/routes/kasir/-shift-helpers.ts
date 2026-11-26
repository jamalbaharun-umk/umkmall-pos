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
  /** Suppliers paid for a purchase from the drawer (part of cashOut, UMK-1970); absent on older answers. */
  purchasePayments?: number
  /** Those payments voided while the shift was open (part of cashIn). */
  purchasePaymentReversals?: number
}

export const NO_CASH: CashTotals = {
  cashIn: 0,
  cashOut: 0,
  receivablePayments: 0,
  voidRefunds: 0,
  expenses: 0,
  expenseReversals: 0,
  purchasePayments: 0,
  purchasePaymentReversals: 0,
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
  const supplierPaid = c.purchasePayments ?? 0
  const supplierBack = c.purchasePaymentReversals ?? 0
  const otherIn = c.cashIn - c.receivablePayments - c.expenseReversals - supplierBack
  const otherOut = c.cashOut - c.voidRefunds - c.expenses - supplierPaid
  const rows: DrawerRow[] = [
    { key: 'opening', label: 'Uang awal di laci', amount: s.openingCash, sign: '' },
    {
      key: 'sales',
      // The count is of every sale of the shift (any method), the amount is cash only (UMK-2057).
      label: s.salesCount == null ? 'Penjualan tunai' : `Penjualan tunai (dari ${s.salesCount} penjualan semua metode)`,
      amount: s.cashSales ?? 0,
      sign: '+',
    },
    { key: 'receivables', label: 'Kasbon dibayar tunai', amount: c.receivablePayments, sign: '+' },
    { key: 'reversals', label: 'Pengeluaran dibatalkan (uang kembali ke laci)', amount: c.expenseReversals, sign: '+' },
    { key: 'supplier-back', label: 'Bayar pemasok dibatalkan (uang kembali ke laci)', amount: supplierBack, sign: '+' },
    { key: 'in-other', label: 'Kas masuk lain', amount: otherIn, sign: '+' },
    { key: 'expenses', label: 'Pengeluaran dari laci', amount: c.expenses, sign: '-' },
    { key: 'supplier', label: 'Bayar pemasok dari laci', amount: supplierPaid, sign: '-' },
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
  purchase_payment: 'Bayar pemasok dari laci',
  purchase_payment_reversal: 'Bayar pemasok dibatalkan',
}

/** The reason of a cash in/out entry in words; an unknown kind (a newer server) is shown as what it is. */
export const entryKindLabel = (kind: string) => KIND_LABELS[kind] ?? 'Kas lain'

/** "Kas masuk" / "Kas keluar" for the badge next to an entry. */
export const directionLabel = (d: 'in' | 'out') => (d === 'in' ? 'Kas masuk' : 'Kas keluar')

/** An entry's amount with its sign: "+Rp2.500" or "-Rp120.000" (the caller formats the rupiah). */
export const signedAmount = (e: { direction: 'in' | 'out'; amount: number }, fmt: (n: number) => string) =>
  `${e.direction === 'in' ? '+' : '-'}${fmt(e.amount)}`

/** What to do about a close refused for pending payments: they are opened from the register's waiting list. */
export const CLOSE_BLOCKED_HINT =
  'Buka tiap penjualan di bawah untuk melanjutkan atau membatalkannya, lalu tutup shift lagi. Penjualan tunai atau EDC yang menunggu selesai lewat tombol bayar yang sama di kasir.'

/** The `code` of the 409 that refuses a close while sales of the shift await payment (UMK-2044). */
export const SALES_AWAITING_CODE = 'sales_awaiting_payment'

/** One sale that holds the shift open (the refusal's `sales`). */
export type WaitingSale = {
  id: string
  holdNumber: number | null
  /** Set by the server when it says which store day the hold number belongs to; absent on older answers. */
  holdDayLabel?: string
  /** True when `holdDayLabel` is a day other than today (a sale held over midnight). */
  holdToday?: boolean
  amountDue: number
  paymentMethod: string
  /** Waits for a payment gateway: its waiting screen opens it. Else cash or EDC between its two steps. */
  onlinePayment: boolean
  createdAt: string
}

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

/**
 * The sales a refused close names (UMK-2044): `[]` unless the answer is the 409 with `code: 'sales_awaiting_payment'`.
 * Only known fields are copied; a row without an id or an amount is left out, and the screen still has the message.
 */
export function parseWaitingSales(body: unknown): WaitingSale[] {
  if (!isRec(body) || body.code !== SALES_AWAITING_CODE || !Array.isArray(body.sales)) return []
  return body.sales.flatMap((x): WaitingSale[] => {
    if (!isRec(x) || typeof x.id !== 'string' || !Number.isInteger(x.amountDue)) return []
    return [
      {
        id: x.id,
        holdNumber: Number.isInteger(x.holdNumber) ? (x.holdNumber as number) : null,
        ...(typeof x.holdDayLabel === 'string' && x.holdDayLabel ? { holdDayLabel: x.holdDayLabel.slice(0, 40) } : {}),
        ...(typeof x.holdToday === 'boolean' ? { holdToday: x.holdToday } : {}),
        amountDue: x.amountDue as number,
        paymentMethod: typeof x.paymentMethod === 'string' ? x.paymentMethod : '',
        onlinePayment: x.onlinePayment === true,
        createdAt: typeof x.createdAt === 'string' ? x.createdAt : '',
      },
    ]
  })
}

/** Where a waiting sale is opened: the register, which reads `?menunggu=`; the list when no sale is named. */
export const waitingSearch = (id?: string) => ({ menunggu: id ?? 'daftar' })

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
  purchase_payment_void: 'Bayar pemasok dari laci dibatalkan setelah shift ditutup',
}
export const storeKindLabel = (kind: string) => STORE_KIND_LABELS[kind] ?? 'Kas toko lain'

/** A text as one sentence: a single full stop at its end, whether or not the server's own text ended with one. */
export const sentence = (text: string) => text.trim().replace(/[.!?]+$/, '') + '.'
