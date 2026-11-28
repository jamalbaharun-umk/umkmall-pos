import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import type { Quote, SaleUnit } from './-helpers'
import type { SalePayment } from './-online'
import { parseWaitingSales, type WaitingSale } from './-shift-helpers'
import { parseOnlineMethods, type Bank, type OnlineMethodsResult } from './-pay-step'
import type { CashTotals } from './-shift-helpers'
import type { QuickProductBody } from './-quick-product'

// Server functions for the U3 cashier. pos-api computes every price and total; these only relay.

export type Shift = CashTotals & {
  id: string
  openingCash: number
  openedAt: string
  closedAt: string | null
  countedCash: number | null
  expectedCash: number | null
  cashSales: number | null
  salesCount: number | null
  difference: number | null
}
export type Product = {
  id: string
  name: string
  sku: string
  /** Base unit name (pcs). */
  unit: string
  sellingPrice: number
  /** UMK-1985: other units, smallest pack first. */
  units: SaleUnit[]
  type: string
  isActive: boolean
  /** On-hand for a tracked product (0 included); null for service and non-stock products. */
  stock: number | null
  lowStockThreshold: number
  category: { id: string; name: string }
}
export type SaleRow = {
  id: string
  number: number
  cashier: string
  subtotal: number
  discount: number
  voucherDiscount: number
  tax: number
  total: number
  // UMK-1993: cash rounding and what the customer owed (total + rounding)
  rounding: number
  amountDue: number
  paid: number
  change: number
  costTotal?: number
  createdAt: string
  /** UMK-1991: when the sale counts (paid), which is what every day figure and the list use. Absent in old answers. */
  paidAt?: string
}
export type SalesSummary = { count: number; revenue: number; discount: number; voucherDiscount: number; rounding: number }
/** UMK-1985: `qty` is in the line's `unit`; `appliedTier` is set when the wholesale price was charged. */
export type ReceiptLine = {
  name: string
  qty: number
  unit: string
  unitQty: number
  baseQty: number
  unitPrice: number
  lineTotal: number
  normalUnitPrice: number
  appliedTier: { minQty: number; price: number } | null
  savings: number
  /** The price was typed with `sales.price_override`: no tier, no savings. */
  manualPrice?: boolean
  /** UMK-1990: the line discount (off `lineTotal`), its percent when given as one, and what the line was charged. */
  discount?: number
  discountPercent?: number | null
  netTotal?: number
  /** PR 72 review: who approved this line's discount or manual price above 30% by PIN, by name. */
  approvedBy?: string | null
}
export type Receipt = {
  number: number
  createdAt: string
  cashier: string
  paymentMethod: string
  lines: ReceiptLine[]
  subtotal: number
  /** Every manual discount; `lineDiscount` (UMK-1990) is the lines' part, the rest an order discount. */
  discount: number
  lineDiscount?: number
  /** Who approved a total reduction above 30% by PIN (the order approval), by name. */
  discountApprovedBy?: string | null
  taxBps: number
  tax: number
  total: number
  rounding: number
  amountDue: number
  paid: number
  change: number
  note: string | null
  // U7
  voucherDiscount: number
  memberName: string | null
  /** UMK-1987: the member record's number, for the WhatsApp receipt; null without a member or a number. Never logged. */
  memberPhone?: string | null
  receivableRest: number | null
  // UMK-1962: a voided receipt says so
  status: 'completed' | 'void' | 'awaiting_payment' | 'cancelled'
  voidedAt: string | null
  /** Why it was voided (pos-api's reason code); null unless voided. */
  voidReasonCode?: string | null
  /** The gateway says the money went back (refund succeeded); false for a plain void or a refund not done yet. */
  refunded?: boolean
  /** UMK-1991: where the gateway refund of a reversed PG sale stands; null for a plain void or a valid receipt. */
  refundStatus?: 'pending' | 'succeeded' | 'failed' | null
}
export type Result<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false
      error: string
      errors?: Record<string, string>
      total?: number
      status?: number
      /** UMK-1991: pos-api's stable lower-case code of a 409/503 (merchant_not_active, payment_unavailable, ...). */
      code?: string
      /** UMK-1991: the sale a refused PG sale left behind (cancelled, or still waiting for its payment). */
      saleId?: string
      /** UMK-2044: the sales that hold a shift open (a 409 `sales_awaiting_payment`). */
      waiting?: WaitingSale[]
    }

const ERRORS: Record<number, string> = {
  403: 'Anda tidak punya izin untuk berjualan.',
  404: 'Data tidak ditemukan.',
}

type Refusal = {
  error: string
  errors?: Record<string, string>
  total?: number
  status?: number
  code?: string
  saleId?: string
  waiting?: WaitingSale[]
}

/** pos-api's 409/422 bodies are Indonesian and internals-free (`{ message, errors, total? }`): pass them on. */
async function refusalOf(res: Response): Promise<Refusal> {
  if (res.status === 409 || res.status === 422 || res.status === 503) {
    const body = (await res.json().catch(() => null)) as {
      message?: unknown
      errors?: unknown
      total?: unknown
      code?: unknown
      saleId?: unknown
    } | null
    return {
      status: res.status,
      error:
        typeof body?.message === 'string' && res.status !== 503
          ? body.message
          : res.status === 503
            ? 'Layanan pembayaran belum menjawab. Coba lagi.'
            : 'Data belum benar. Periksa isian Anda.',
      errors: body?.errors && typeof body.errors === 'object' ? (body.errors as Record<string, string>) : undefined,
      total: typeof body?.total === 'number' ? body.total : undefined,
      code: typeof body?.code === 'string' && /^[a-z][a-z_]{1,39}$/.test(body.code) ? body.code : undefined,
      saleId: typeof body?.saleId === 'string' ? body.saleId : undefined,
      waiting: res.status === 409 ? parseWaitingSales(body) : undefined,
    }
  }
  return { status: res.status, error: ERRORS[res.status] ?? 'Gagal terhubung ke server, coba lagi.' }
}
const errorOf = async (res: Response) => (await refusalOf(res)).error

async function load<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error(await errorOf(res))
  return (await res.json()) as T
}

async function send<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  const res = await api(path, { method: 'POST', body: JSON.stringify(body), headers }).catch((e: unknown) => {
    if (isRedirect(e)) throw e // the session ended: the screen follows the sign-in redirect
    return null
  })
  if (!res) return { ok: false, status: 0, error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }
  if (!res.ok) return { ok: false, ...(await refusalOf(res)) }
  return { ok: true, data: (await res.json()) as T }
}

export const loadCashier = createServerFn().handler(async () => {
  const { shift } = await load<{ shift: (Shift & { expectedCash: number }) | null }>('/shifts/current')
  const noQris = { configured: false, version: '' }
  if (!shift)
    return { shift: null, products: [], taxBps: 0, methods: [] as PaymentMethod[], qris: noQris, chargeable: [] as string[], onlineUnavailable: false, banks: {} as Record<string, Bank[]> }
  // shortcut: first 100 active products, searched in the browser; add server search when catalogs grow.
  const [page, settings, methods, profile, chargeable] = await Promise.all([
    load<{ data: Product[] }>('/catalog/products?perPage=100'),
    load<{ taxBps: number }>('/sales/settings'),
    load<{ data: PaymentMethod[] }>('/payment-methods'),
    // UMK-1992: any session reads the profile; only the QRIS flag and a cache-busting stamp are used here.
    load<{ qrisConfigured: boolean; updatedAt: string | null }>('/store/profile'),
    // UMK-1991: the gateway methods the store may charge now. A failure hides the online methods, never the till.
    chargeableMethods(),
  ])
  return {
    shift,
    products: page.data.filter((p) => p.isActive),
    taxBps: settings.taxBps,
    methods: methods.data,
    qris: { configured: profile.qrisConfigured, version: profile.updatedAt ?? '' },
    chargeable: chargeable.methods,
    onlineUnavailable: chargeable.unavailable,
    banks: chargeable.banks,
  }
})

async function chargeableMethods(): Promise<OnlineMethodsResult> {
  const res = await api('/online-payments/methods').catch(() => null)
  // no answer at all or a 5xx (payment-api down): say so, not "not active"
  if (!res || res.status >= 500) return { methods: [], banks: {}, unavailable: true }
  if (!res.ok) return { methods: [], banks: {}, unavailable: false }
  return { ...parseOnlineMethods(await res.json().catch(() => null)), unavailable: false }
}

export const openShift = createServerFn({ method: 'POST' })
  .validator((openingCash: number) => openingCash)
  .handler(({ data }) => send<Shift>('/shifts/open', { openingCash: data }))

export const closeShift = createServerFn({ method: 'POST' })
  .validator((countedCash: number) => countedCash)
  .handler(({ data }) => send<Shift>('/shifts/current/close', { countedCash: data }))

/** UMK-1990: a line's discount (percent or rupiah, sales.price_override) and, above 30%, its PIN approval. */
type LineDiscountFields = { discountPercent?: number; discountAmount?: number }
/** A manual unit price (sales.price_override, ruling 2026-11-26); more than 30% below the server's needs an approval. */
type ManualPrice = { price?: number }
type SaleInput = {
  key: string
  lines: ({ productId: string; qty: number; unit?: string; discountApprovalId?: string } & LineDiscountFields &
    ManualPrice)[]
  paid: number
  note?: string
  // U7: member (required for a kasbon method), voucher code, payment method (default Tunai).
  memberId?: string
  voucherCode?: string
  paymentMethodId?: string
  /** UMK-2037: the bank of a virtual account sale (a code of `GET /online-payments/methods`); none for any other. */
  bank?: string
}
export const createSale = createServerFn({ method: 'POST' })
  .validator((d: SaleInput) => d)
  .handler(({ data: { key, ...body } }) =>
    send<{
      id: string
      number?: number
      change: number
      receivableRest?: number | null
      /** UMK-1991: `awaiting_payment` with `payment` for a QRIS or VA sale; read it again with `parsePayment`. */
      status?: string
      payment?: SalePayment
    }>('/sales', body, { 'idempotency-key': key }),
  )

/** The server's price of the cart (unit and wholesale tier), nothing written. Only pos-api prices a sale. */
export const quoteCart = createServerFn({ method: 'POST' })
  .validator((lines: ({ productId: string; qty: number; unit?: string } & LineDiscountFields)[]) => lines)
  .handler(({ data }) => send<Quote>('/sales/quote', { lines: data }))

/** The receipt, dated by when the sale was paid (`paidAt`, UMK-1991) when `GET /sales/:id` says so; else by creation. */
export const loadReceipt = createServerFn()
  .validator((id: string) => id)
  .handler(async ({ data }): Promise<Receipt & { paidAt: string | null }> => {
    const id = encodeURIComponent(data)
    const [receipt, meta] = await Promise.all([
      load<Receipt>(`/sales/${id}/receipt`),
      api(`/sales/${id}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ paidAt?: unknown }>) : null))
        .catch(() => null),
    ])
    return { ...receipt, paidAt: typeof meta?.paidAt === 'string' ? meta.paidAt : null }
  })

export type HistoryQuery = { page: number; from?: string; to?: string }
export const loadHistory = createServerFn()
  .validator((q: HistoryQuery) => q)
  .handler(({ data: { page, from, to } }) => {
    const qs = new URLSearchParams({ page: String(page), perPage: '20' })
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    return load<{ data: SaleRow[]; total: number; summary: SalesSummary }>(`/sales?${qs}`)
  })

export const loadCurrentShift = createServerFn().handler(() =>
  load<{ shift: (Shift & { expectedCash: number; cashSales: number; salesCount: number }) | null }>('/shifts/current'),
)

export { rupiah } from '@/components/pos-page'

// ---- U7: member picker, voucher check, payment methods ----

export type PaymentMethod = {
  id: string
  name: string
  kind: 'cash' | 'debit' | 'credit' | 'wallet' | 'online'
  /** UMK-1991: payment-api's method of an `online` method (fake_qris, fake_va); null for every other kind. */
  gatewayMethod?: string | null
}
export type MemberOption = { id: string; name: string; code: string }

/** Name and code only (GET /members/picker, sales.create): the till never loads phone or address. */
export const pickMembers = createServerFn()
  .validator((q: string) => q)
  .handler(
    async ({ data }) => (await load<{ data: MemberOption[] }>(`/members/picker?q=${encodeURIComponent(data)}`)).data,
  )

/** The discount `code` gives on `amount`, without taking quota; the sale re-validates and takes it. */
export const checkVoucher = createServerFn({ method: 'POST' })
  .validator((d: { code: string; amount: number }) => d)
  .handler(({ data }) => send<{ discount: number }>('/vouchers/check', data))

/** UMK-2130 "Produk cepat": made from the till (catalog.manage); pos-api answers the product it made. */
export const createQuickProduct = createServerFn({ method: 'POST' })
  .validator((d: QuickProductBody) => d)
  .handler(async ({ data }): Promise<Result<Product>> => {
    const r = await send<Omit<Product, 'stock'>>('/catalog/products/quick', data)
    // A non-stock product tracks no stock: the till's grid shows no count for it.
    return r.ok ? { ok: true, data: { ...r.data, stock: null } } : r
  })
