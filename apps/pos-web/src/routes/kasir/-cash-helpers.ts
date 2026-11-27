// Pure helpers for the drawer cash in/out screen (UMK-1924 U3, UMK-1963, design feature 20). pos-api decides every
// refusal and returns the drawer figures; these check obvious mistakes before sending and word the results.
import { rupiah } from '../pengeluaran/-helpers'

export type CashDirection = 'in' | 'out'
export type CashReason = { reason: string; label: string; noteRequired: boolean }
export type CashReasons = { in: CashReason[]; out: CashReason[] }

/** The shift ledger kinds a manual entry is written as (pos-api `manual_in` / `manual_out`). */
const MANUAL_KINDS = ['manual_in', 'manual_out']

export type CashEntryRow = {
  id: string
  direction: CashDirection
  kind: string
  amount: number
  note: string | null
  reason: string | null
  reasonLabel: string | null
  createdAt: string
  /** The source row: for `purchase_refund`, the supplier refund's id. */
  refId?: string | null
}

/**
 * Cash that entered or left this drawer without a sale, so the list shows it too: the deposits a collector handed
 * over, suppliers paid from the drawer and money a supplier handed back into it, with their reversals (UMK-2083).
 */
const SHOWN_KINDS = [
  ...MANUAL_KINDS,
  'collector_deposit',
  'purchase_payment',
  'purchase_payment_reversal',
  'purchase_refund',
  'purchase_refund_reversal',
]

/** The shift's manual entries, collector deposits and supplier cash (sales, kasbon and expenses are in the closing screen), newest first. */
export function manualEntries<T extends { kind: string; createdAt: string }>(rows: T[]): T[] {
  return rows.filter((r) => SHOWN_KINDS.includes(r.kind)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * The supplier refunds of this drawer that can still be voided from Kas laci: a `purchase_refund` entry without the
 * `purchase_refund_reversal` its void writes into the same (open) shift.
 */
export function voidableRefunds(rows: { kind: string; refId?: string | null }[]): Set<string> {
  const reversed = new Set(rows.filter((r) => r.kind === 'purchase_refund_reversal').map((r) => r.refId))
  return new Set(
    rows.flatMap((r) => (r.kind === 'purchase_refund' && r.refId && !reversed.has(r.refId) ? [r.refId] : [])),
  )
}

/** What a server function reports on a refusal; `status` 0 means pos-api could not be reached. */
export type Failure = { status: number; error: string; errors?: Record<string, string> }

export const FIELD_CODES = { amount: 'DRAWER_INSUFFICIENT', note: 'NOTE_REQUIRED', reason: 'REASON_REQUIRED' }

/**
 * The failure with a small help code for the error dialog (never raw server text): no open shift, or the first
 * refused field's code. Other failures keep the dialog's own status-based code.
 */
export function withCode(
  f: Failure,
  fieldCodes: Record<string, string> = FIELD_CODES,
): Failure & { code?: string } {
  if (f.status !== 409 && f.status !== 422) return f
  if (/buka shift/i.test(f.error)) return { ...f, code: 'SHIFT_REQUIRED' }
  const field = Object.keys(f.errors ?? {}).find((k) => fieldCodes[k])
  return field ? { ...f, code: fieldCodes[field] } : f
}

export const directionTitle = (d: CashDirection) => (d === 'in' ? 'Tambah uang' : 'Ambil uang')
/** After "Gagal": the failed action. */
export const failureAction = (d: CashDirection) => (d === 'in' ? 'menambah uang ke laci' : 'mengambil uang dari laci')

/** The most a cash-out may take: exactly the drawer's cash is fine; never below 0. */
export const maxTakeOut = (drawerCash: number) => Math.max(0, drawerCash)

export type CashForm = { direction: CashDirection; amount: number; reason: string; note: string }

/**
 * Checks before sending, in pos-api's words (it checks again under the shift's lock). A cash-out above the drawer's
 * cash is refused, not warned: the owner ruled so.
 */
export function cashFormErrors(
  f: CashForm,
  reasons: CashReasons,
  drawerCash: number,
): Partial<Record<'amount' | 'reason' | 'note', string>> {
  const errors: Partial<Record<'amount' | 'reason' | 'note', string>> = {}
  if (!(f.amount > 0)) errors.amount = 'Harus lebih dari Rp0'
  else if (f.direction === 'out' && f.amount > drawerCash)
    errors.amount = `Jumlah lebih besar dari uang di laci (${rupiah(maxTakeOut(drawerCash))})`
  const chosen = reasons[f.direction].find((r) => r.reason === f.reason)
  if (!chosen) errors.reason = 'Pilih salah satu alasan'
  else if (chosen.noteRequired && !f.note.trim()) errors.note = 'Catatan wajib diisi untuk alasan Lainnya'
  return errors
}

/** What the drawer will hold after this entry (the live line under the amount); undefined until an amount is typed. */
export function drawerAfter(direction: CashDirection, amount: number, drawerCash: number): number | undefined {
  if (!(amount > 0)) return undefined
  return direction === 'in' ? drawerCash + amount : drawerCash - amount
}

/** The note under the amount field while typing. */
export function drawerPreview(direction: CashDirection, amount: number, drawerCash: number): string | undefined {
  const after = drawerAfter(direction, amount, drawerCash)
  if (after === undefined) return undefined
  return direction === 'in'
    ? `Uang di laci bertambah ${rupiah(amount)}, menjadi ${rupiah(after)}.`
    : `Uang di laci langsung berkurang ${rupiah(amount)}, tersisa ${rupiah(Math.max(after, 0))}.`
}

/** The success toast: what happened plus the figure that matters (the drawer after it, from the server). */
export function cashToast(e: { direction: CashDirection; amount: number; reasonLabel: string; drawerCashAfter: number }) {
  return e.direction === 'in'
    ? `Uang ${rupiah(e.amount)} ditambahkan ke laci (${e.reasonLabel}). Uang di laci ${rupiah(e.drawerCashAfter)}`
    : `Uang ${rupiah(e.amount)} diambil dari laci (${e.reasonLabel}). Sisa ${rupiah(e.drawerCashAfter)}`
}

/** "+Rp200.000" / "−Rp500.000" (a real minus sign, as `rupiah()` writes it) for the list. */
export const signedRupiah = (direction: CashDirection, amount: number) =>
  direction === 'in' ? `+${rupiah(amount)}` : rupiah(-amount)
