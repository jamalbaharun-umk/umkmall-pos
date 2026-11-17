// Display-side money helpers for the cashier. pos-api computes the total that is charged.

/** Same rule as pos-api (half up, on the amount after discounts). Integer rupiah in, integer out. */
export const taxOf = (taxable: number, bps: number) => Math.floor((taxable * bps + 5000) / 10000)

/**
 * Whole-number rupiah from a text field: plain digits or correctly grouped thousands ("20.000" → 20000).
 * NaN otherwise, so "1.5" or "2.00" is refused rather than read as 15 or 200.
 */
export const parseRupiah = (s: string) => {
  const t = s.trim()
  return /^\d+$/.test(t) || /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, '')) : NaN
}

/** Exact amount, then the next round notes above the total (Lakasir's quick-amount buttons). */
export function quickAmounts(total: number): number[] {
  const ups = [5_000, 10_000, 20_000, 50_000, 100_000]
    .map((step) => Math.ceil(total / step) * step)
    .filter((n) => n > total)
  return [...new Set([total, ...ups])].slice(0, 5)
}

/** One numpad key on the "uang diterima" text: digits and 000 append (no leading zeros), ⌫ deletes. */
export const numpadEdit = (text: string, key: string) =>
  key === 'hapus' ? text.slice(0, -1) : (text + key).replace(/^0+(?=\d)/, '').slice(0, 13)

/** Why a typed cart quantity cannot be used (undefined when it can): whole number 1–100.000, like pos-api. */
export const qtyError = (text: string) => {
  const t = text.trim()
  if (!t) return 'Wajib diisi'
  if (!/^\d+$/.test(t)) return 'Harus bilangan bulat'
  const n = Number(t)
  if (n < 1) return 'Minimal 1'
  if (n > 100_000) return 'Maksimal 100.000'
  return undefined
}

/** Why the order discount text cannot be used (undefined when it can): whole rupiah, 0 ≤ discount ≤ subtotal. */
export const discountError = (text: string, subtotal: number) => {
  const t = text.trim()
  if (!t) return undefined // no discount
  if (/^-/.test(t)) return 'Diskon tidak boleh negatif'
  const n = parseRupiah(t)
  if (Number.isNaN(n)) return 'Harus bilangan bulat rupiah, misalnya 5.000'
  if (n > subtotal) return 'Diskon melebihi subtotal'
  return undefined
}
