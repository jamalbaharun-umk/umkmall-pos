// UMK-1990 (design feature 30, "Diskon baris"): pure logic of a cart line's discount. pos-api computes the discount
// and every total it charges; this mirrors its rules so the cart and the pay step show the same figures before the
// sale, and refuses what pos-api would refuse without a round trip.
import type { ErrorDescription } from '@/lib/describe-error'
import { rupiah } from '../../lib/rupiah'
import { taxOf } from './-money'

export type DiscountKind = 'percent' | 'amount'

/** A line's discount as the cashier gave it. An approval is the PIN approval of a discount above 30%. */
export type LineDiscount = {
  kind: DiscountKind
  value: number
  approval?: { id: string; maxBps: number; approverName: string }
}

/** Above this share of the line (30%) pos-api asks for a PIN approval. */
export const APPROVAL_BPS = 3000

const rp = rupiah

/** The rupiah off a line of `lineTotal`: an amount as given, a percent rounded half up (pos-api's rule). */
export const discountOf = (lineTotal: number, d: Pick<LineDiscount, 'kind' | 'value'>) =>
  d.kind === 'percent' ? Math.floor((lineTotal * d.value + 50) / 100) : d.value

/** More than 30% of the line. */
export const needsApproval = (discount: number, lineTotal: number) => discount * 10000 > lineTotal * APPROVAL_BPS

/** The share of the line a discount takes, in basis points rounded up: what the approval must cover. */
export const approvalBps = (discount: number, lineTotal: number) =>
  lineTotal > 0 ? Math.min(9999, Math.ceil((discount * 10000) / lineTotal)) : 9999

/** "40%" or "Rp8.000": the share as the PIN screen says it. */
export const percentText = (discount: number, lineTotal: number) =>
  lineTotal > 0 ? `${Math.round((discount * 100) / lineTotal)}%` : '0%'

const digits = (t: string) => (/^\d+$/.test(t) ? Number(t) : NaN)
const rupiahText = (t: string) =>
  /^\d+$/.test(t) || /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, '')) : NaN

/** The typed value, or NaN when it is not a whole number (percent) or whole rupiah (amount). */
export const parseDiscount = (kind: DiscountKind, text: string) =>
  kind === 'percent' ? digits(text.trim()) : rupiahText(text.trim())

/** Why the typed discount cannot be applied to a line of `lineTotal`; undefined when it can. */
export function discountTextError(kind: DiscountKind, text: string, lineTotal: number): string | undefined {
  const t = text.trim()
  if (!t) return 'Wajib diisi'
  if (/^-/.test(t)) return 'Diskon tidak boleh negatif'
  const n = parseDiscount(kind, t)
  if (Number.isNaN(n)) return kind === 'percent' ? 'Isi persen bilangan bulat, misalnya 10' : 'Harus bilangan bulat rupiah, misalnya 2.000'
  if (n < 1) return kind === 'percent' ? 'Diskon minimal 1%' : 'Diskon harus lebih dari 0'
  if (kind === 'percent' && n >= 100) return 'Diskon 100% tidak diperbolehkan untuk satu baris'
  const off = discountOf(lineTotal, { kind, value: n })
  if (off > lineTotal) return 'Diskon melebihi harga baris'
  if (off === lineTotal) return 'Diskon 100% tidak diperbolehkan untuk satu baris'
  return undefined
}

export type LineDiscountState = {
  /** Rupiah off the line; 0 without a discount or with one that no longer fits the line. */
  discount: number
  netTotal: number
  /** Why the discount no longer fits the line (its quantity changed); the sale waits until it is changed. */
  problem?: string
}

/**
 * A cart line's discount against its current total: an amount that became the whole line, or a share that grew past
 * its PIN approval (fewer items), is a problem the cashier fixes before paying; it is not sent meanwhile.
 */
export function lineDiscountState(lineTotal: number, d: LineDiscount | undefined): LineDiscountState {
  if (!d) return { discount: 0, netTotal: lineTotal }
  const discount = discountOf(lineTotal, d)
  if (discount >= lineTotal) return { discount: 0, netTotal: lineTotal, problem: 'Diskon melebihi harga baris. Ubah diskonnya.' }
  if (needsApproval(discount, lineTotal) && (!d.approval || discount * 10000 > d.approval.maxBps * lineTotal))
    return { discount: 0, netTotal: lineTotal, problem: 'Diskon lebih dari 30% perlu PIN admin lagi. Ubah diskonnya.' }
  return { discount, netTotal: lineTotal - discount }
}

/** The fields of a line's discount in a request; the quote takes no approval. */
export function discountFields(d: LineDiscount | undefined, withApproval: boolean) {
  if (!d) return {}
  const value = d.kind === 'percent' ? { discountPercent: d.value } : { discountAmount: d.value }
  return withApproval && d.approval ? { ...value, discountApprovalId: d.approval.id } : value
}

/** "diskon 10%" or "diskon Rp2.000", next to the line's quantity. */
export const discountLabel = (d: Pick<LineDiscount, 'kind' | 'value'>) =>
  d.kind === 'percent' ? `diskon ${d.value}%` : `diskon ${rp(d.value)}`

/** The success toast: "Diskon 10% diterapkan pada Teh Botol". */
export const discountToast = (name: string, d: Pick<LineDiscount, 'kind' | 'value'>) =>
  `Diskon ${d.kind === 'percent' ? `${d.value}%` : rp(d.value)} diterapkan pada ${name}`

/** Only the discounts of lines still in the cart. */
export function pruneDiscounts(discounts: Record<string, LineDiscount>, keys: string[]) {
  const kept = Object.entries(discounts).filter(([k]) => keys.includes(k))
  return kept.length === Object.keys(discounts).length ? discounts : Object.fromEntries(kept)
}

/**
 * The breakdown in pos-api's order: line discounts, the voucher on what is left, tax after every discount, then
 * cash rounding (cash only, up to the next Rp100, never on a kasbon) outside `total`.
 */
export function breakdown(a: { subtotal: number; lineDiscount: number; voucherDiscount: number; taxBps: number }) {
  const afterDiscount = a.subtotal - a.lineDiscount - a.voucherDiscount
  const tax = taxOf(afterDiscount, a.taxBps)
  return { afterDiscount, tax, total: afterDiscount + tax }
}

/** The error dialog of a refused discount (pos-api's code, or the screen's own check). */
export const discountRefusal = (what: string, code = 'DISCOUNT_INVALID'): ErrorDescription => ({
  what,
  todo: code === 'DISCOUNT_INVALID' ? 'Isi diskon di bawah 100% dari harga baris.' : 'Periksa isian lalu coba lagi.',
  code,
  primary: 'none',
})

/** A sold line's discount as the receipt prints it ("Diskon 10%", "Diskon"); null without one (older answers too). */
export const soldDiscountLabel = (l: { discount?: number; discountPercent?: number | null }) =>
  (l.discount ?? 0) > 0 ? (l.discountPercent ? `Diskon ${l.discountPercent}%` : 'Diskon') : null

/** A receipt's discounts: the lines' ("Diskon baris") and an order discount, if any ("Diskon"). */
export const receiptDiscounts = (r: { discount: number; lineDiscount?: number }) => {
  const lines = r.lineDiscount ?? 0
  return { lines, order: r.discount - lines }
}
