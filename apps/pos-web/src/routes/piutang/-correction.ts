// Pure helpers for "Koreksi pembayaran kasbon" (UMK-1971, design feature 31). pos-api decides every refusal and
// every figure (it writes a reversal line plus the new payment); these check obvious mistakes before sending, word
// the effect for the cashier, and label the history rows.

/** The reasons pos-api takes (`CORRECTION_REASONS`), in the design's words. `other` needs a note. */
export const CORRECTION_REASONS = [
  { code: 'wrong_amount', label: 'Salah jumlah' },
  { code: 'wrong_method', label: 'Salah cara bayar' },
  { code: 'wrong_customer', label: 'Salah pelanggan' },
  { code: 'duplicate', label: 'Tercatat dua kali' },
  { code: 'other', label: 'Lainnya' },
] as const
export type CorrectionReason = (typeof CORRECTION_REASONS)[number]['code']

export const correctionReasonLabel = (code: string | null) =>
  CORRECTION_REASONS.find((r) => r.code === code)?.label ?? 'Koreksi'

export const CORRECTION_NOTE_MAX = 200

/** A history row's state: `active` stands, `reversed` was cancelled by a correction, `reversal` is the minus line. */
export type RowStatus = 'active' | 'reversed' | 'reversal'

export function rowStatus(status: RowStatus): { label: string; color: 'success' | 'light' | 'warning' } {
  switch (status) {
    case 'active':
      return { label: 'Aktif', color: 'success' }
    case 'reversed':
      return { label: 'Dibatalkan', color: 'light' }
    case 'reversal':
      return { label: 'Pembalik', color: 'warning' }
  }
}

/** "Dibayar" from the book: payments minus reversals (a reversal row carries a negative amount). */
export const paidFromBook = (payments: { amount: number }[]) => payments.reduce((n, p) => n + p.amount, 0)

/** A history amount with its sign: a reversal reads "−Rp1.000". */
export const signedRupiah = (amount: number, fmt: (n: number) => string) =>
  amount < 0 ? `−${fmt(-amount)}` : fmt(amount)

/** The rest after the correction: the old payment comes back, the new one (if any) is taken. Never below 0. */
export const restAfterCorrection = (rest: number, oldAmount: number, newAmount: number | null) =>
  Math.max(0, rest + oldAmount - (newAmount ?? 0))

export type CorrectionForm = {
  /** `replace`: a new payment replaces the old one; `cancel`: "Batalkan saja tanpa pengganti". */
  mode: 'replace' | 'cancel'
  /** The amount as typed, already parsed to whole rupiah (NaN when not a number). */
  amount: number
  methodId: string
  reasonCode: string
  note: string
  approverId: string
  pin: string
}
export type CorrectionErrors = Partial<Record<'amount' | 'methodId' | 'reasonCode' | 'note' | 'approverId' | 'pin', string>>

/** Checks before sending, in pos-api's words. `rest` and `old` are the receivable's rest and the old payment. */
export function correctionErrors(
  f: CorrectionForm,
  rest: number,
  old: { amount: number; methodId: string | undefined },
): CorrectionErrors {
  const e: CorrectionErrors = {}
  if (f.mode === 'replace') {
    const max = rest + old.amount
    if (Number.isNaN(f.amount)) e.amount = 'Harus bilangan bulat rupiah'
    else if (f.amount <= 0) e.amount = 'Harus lebih dari 0'
    else if (f.amount > max) e.amount = `Pembayaran melebihi sisa piutang (Rp${max.toLocaleString('id-ID')})`
    else if (f.amount === old.amount && f.methodId === old.methodId)
      e.amount = 'Jumlah dan cara bayar sama dengan pembayaran lama'
    if (!f.methodId) e.methodId = 'Pilih cara bayar'
  }
  if (!f.reasonCode) e.reasonCode = 'Pilih alasan koreksi'
  if (f.reasonCode === 'other' && !f.note.trim()) e.note = 'Tulis alasan koreksi'
  if (!f.approverId) e.approverId = 'Pilih admin yang menyetujui'
  if (!/^\d{6}$/.test(f.pin)) e.pin = 'PIN harus 6 angka'
  return e
}

/** The request body (the PIN goes only to pos-api, never stored). */
export function correctionBody(f: CorrectionForm) {
  return {
    replacement: f.mode === 'replace' ? { amount: f.amount, paymentMethodId: f.methodId } : null,
    reasonCode: f.reasonCode,
    ...(f.note.trim() ? { note: f.note.trim() } : {}),
    approverId: f.approverId,
    pin: f.pin,
  }
}

export type CashOld = {
  amount: number
  isCash: boolean
  shiftId: string | null
  shiftClosed: boolean
  collectedOutsideShift: boolean
}

/**
 * What the correction does to cash, mirroring pos-api so the form can say it before the click (pos-api decides again):
 * - `closedShift`: the old cash came from a shift that is closed: that shift and today's drawer stay as they are and
 *   the store's cash gives it back (owner ruling 2026-11-26); no shift is needed for it;
 * - `collector`: the old cash is with a collector outside a shift: what they hold drops by the old amount;
 * - `sameShift`: the old cash leaves its own shift, still open;
 * - `none`: no drawer is touched by the reversal.
 * `newNeedsShift`: a new cash payment by someone who can open a shift but has none (pos-api refuses it).
 */
export type CashEffect = {
  reversal: 'none' | 'sameShift' | 'closedShift' | 'collector'
  newNeedsShift: boolean
}

export function cashEffect(
  old: CashOld,
  next: { amount: number; isCash: boolean } | null,
  ctx: { hasOpenShift: boolean; canOpenShift: boolean },
): CashEffect {
  const newNeedsShift = !!next?.isCash && !ctx.hasOpenShift && ctx.canOpenShift
  if (!old.isCash) return { reversal: 'none', newNeedsShift }
  if (old.collectedOutsideShift) return { reversal: 'collector', newNeedsShift }
  if (!old.shiftId) return { reversal: 'none', newNeedsShift }
  if (!old.shiftClosed) return { reversal: 'sameShift', newNeedsShift }
  return { reversal: 'closedShift', newNeedsShift }
}

/** The line under the form that says where the cash goes, in the design's words; undefined when no drawer moves. */
export function cashNotice(effect: CashEffect): string | undefined {
  switch (effect.reversal) {
    case 'closedShift':
      return 'Shift tertutup: uang dikembalikan lewat kas toko'
    case 'sameShift':
      return 'Uang tunai pembayaran lama dikeluarkan dari laci shift tempat ia diterima (shift itu masih buka).'
    case 'collector':
      return 'Pembayaran ini dikumpulkan penagih di luar shift. Uang yang dipegang penagih berkurang; uang yang sudah disetor tidak berubah.'
    case 'none':
      return undefined
  }
}

/** The success toast (design: "Pembayaran dikoreksi: Rp2.500 jadi Rp3.000"). */
export const correctionToast = (oldAmount: number, newAmount: number | null, fmt: (n: number) => string) =>
  newAmount === null
    ? `Pembayaran ${fmt(oldAmount)} dibatalkan`
    : `Pembayaran dikoreksi: ${fmt(oldAmount)} jadi ${fmt(newAmount)}`

/** What to do after a refusal that has a way forward, by its code; undefined for the rest. */
export function correctionTodo(code: string | undefined, available: number | undefined, fmt: (n: number) => string) {
  switch (code) {
    case 'ALREADY_REVERSED':
      return 'Muat ulang riwayat pembayaran.'
    case 'STORE_CASH_INSUFFICIENT':
      return `Uang pembayaran ini harus keluar dari kas toko, yang sekarang berisi ${fmt(available ?? 0)}. Kas toko tidak boleh minus: koreksi setelah kas toko cukup.`
    default:
      return undefined
  }
}

/** A refusal whose message is about the PIN field: shown there, and the PIN is cleared. */
export const isPinRefusal = (errors: Record<string, string> | undefined) => !!errors?.pin

/** Field errors from pos-api's answer, mapped to the form's fields (`replacement.amount` is the amount). */
export function fieldErrorsOf(errors: Record<string, string> | undefined): CorrectionErrors {
  if (!errors) return {}
  const out: CorrectionErrors = {}
  if (errors['replacement.amount']) out.amount = errors['replacement.amount']
  if (errors['replacement.paymentMethodId']) out.methodId = errors['replacement.paymentMethodId']
  for (const k of ['reasonCode', 'note', 'approverId', 'pin'] as const) if (errors[k]) out[k] = errors[k]
  return out
}
