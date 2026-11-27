// Pure helpers for the collector deposit screens (UMK-1924 U3, UMK-1963, design feature 21). pos-api decides every
// refusal and every figure; these check obvious mistakes before sending and word the results.
import { rupiah } from '../pengeluaran/-helpers'

/** One row of GET /store-cash `collectors`: what a collector took outside a shift and still holds. */
export type CollectorCash = {
  collectorId: string
  collectorKind: 'owner' | 'cashier'
  collectorName: string
  collected: number
  handedOver: number
  outstanding: number
}

export type DepositRow = {
  id: string
  collectorId: string
  collectorName: string
  amount: number
  note: string | null
  outstandingBefore: number
  outstandingAfter: number
  receivedById: string
  receivedByKind: 'owner' | 'cashier'
  receivedByName: string
  createdAt: string
}

export const FIELD_CODES = { amount: 'DEPOSIT_EXCEEDS_OUTSTANDING', collectorId: 'DEPOSIT_COLLECTOR_INVALID' }
/** After "Gagal": the failed action. */
export const FAILURE_ACTION = 'mencatat setoran'

/**
 * Who the receiver can pick: a staff collector who still holds cash, never the receiver themselves (nobody clears
 * their own outstanding; pos-api refuses it too). An owner's own collections stay with the owner, so no deposit.
 */
export function depositableCollectors(collectors: CollectorCash[], receiverId: string | undefined): CollectorCash[] {
  return collectors.filter((c) => c.collectorKind === 'cashier' && c.outstanding > 0 && c.collectorId !== receiverId)
}

export type DepositForm = { collectorId: string; amount: number }

/** Checks before sending, in pos-api's words. Above the outstanding is refused, not warned. */
export function depositErrors(f: DepositForm, collectors: CollectorCash[]): Partial<Record<'collectorId' | 'amount', string>> {
  const errors: Partial<Record<'collectorId' | 'amount', string>> = {}
  const who = collectors.find((c) => c.collectorId === f.collectorId)
  if (!who) errors.collectorId = 'Pilih siapa yang menyerahkan uang'
  if (!(f.amount > 0)) errors.amount = 'Harus lebih dari Rp0'
  else if (who && f.amount > who.outstanding)
    errors.amount = `Jumlah melebihi uang yang belum disetor (${rupiah(who.outstanding)})`
  return errors
}

/** The line under the amount: what is still held after this deposit; undefined until a usable amount is typed. */
export function outstandingAfterText(amount: number, who: CollectorCash | undefined): string | undefined {
  if (!who || !(amount > 0) || amount > who.outstanding) return undefined
  const rest = who.outstanding - amount
  return rest === 0
    ? `Semua uang ${who.collectorName} sudah disetor.`
    : `Setelah ini ${who.collectorName} masih memegang ${rupiah(rest)}.`
}

/** What the per-collector row says the cash is: held by the collector until a deposit is received. */
export const heldLabel = (c: CollectorCash) =>
  c.collectorKind === 'owner'
    ? `Dipegang pemilik ${rupiah(c.outstanding)}`
    : c.outstanding > 0
      ? `Dipegang penagih ${rupiah(c.outstanding)}`
      : 'Sudah disetor semua'

/** The success toast: what happened plus the figure that matters (what the collector still holds, from the server). */
export const depositToast = (d: { amount: number; collectorName: string; outstandingAfter: number }) =>
  `Setoran ${rupiah(d.amount)} dari ${d.collectorName} diterima. Masih dipegang ${rupiah(d.outstandingAfter)}`

export type StoreDirection = 'in' | 'out' | 'transfer'

/**
 * How a store cash line is badged and signed. A collector's deposit is a `transfer`: the cash changes holder
 * (collector to safe) and the store's balance does not move, so it carries no plus or minus.
 */
export function storeLine(e: { direction: StoreDirection; kind: string; amount: number }) {
  if (e.direction === 'transfer')
    return { label: 'Dipindahkan', color: 'primary' as const, amount: rupiah(e.amount), kind: 'Setoran penagih ke kas toko' }
  return {
    label: e.direction === 'in' ? 'Kas masuk' : 'Kas keluar',
    color: e.direction === 'in' ? ('success' as const) : ('warning' as const),
    amount: e.direction === 'in' ? `+${rupiah(e.amount)}` : rupiah(-e.amount),
    kind: undefined,
  }
}

/** Total still held by staff collectors (the figure on the store cash summary). */
export const totalHeld = (collectors: CollectorCash[]) =>
  collectors.filter((c) => c.collectorKind === 'cashier').reduce((n, c) => n + c.outstanding, 0)
