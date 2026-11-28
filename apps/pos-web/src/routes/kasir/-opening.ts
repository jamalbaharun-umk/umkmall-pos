import { rupiah } from '../../lib/rupiah'

/**
 * Design 40 screen 7 (owner decision 2026-11-28, option A): a shift the owner's first sale opened starts with the
 * last count. The till asks once whether that is right, until the owner checks or corrects it.
 */
export function showOpeningCard(shift: { openedAutomatically?: boolean; openingCheckedAt?: string | null } | null) {
  return !!shift?.openedAutomatically && !shift.openingCheckedAt
}

/** The toast after "Sudah benar" (no amount) or "Betulkan modal". */
export function openingToast(before: number, after?: number) {
  return after === undefined || after === before ? 'Modal awal sudah dicek' : `Modal awal dibetulkan jadi ${rupiah(after)}`
}
