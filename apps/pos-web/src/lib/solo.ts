/** pos-api's name for the owner as a sale's or shift's cashier. */
export const OWNER_CASHIER = 'Pemilik'

/**
 * UMK-2121 solo-owner mode (design 40): with no staff, every receipt is the owner's, so "Kasir" says nothing and is
 * hidden. It stays when a name other than the owner's is there (a former cashier, the agent, a helper), so the
 * history never loses who rang a sale up.
 */
export function showCashier(solo: boolean, names: readonly string[]): boolean {
  return !solo || names.some((n) => n !== OWNER_CASHIER)
}
