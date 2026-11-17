// Display-side money helpers for the cashier. pos-api computes the total that is charged.

/** Same rule as pos-api (half up, on the amount after discounts). Integer rupiah in, integer out. */
export const taxOf = (taxable: number, bps: number) => Math.floor((taxable * bps + 5000) / 10000)

/** Whole-number rupiah from a text field ("20.000" → 20000); NaN when it is not a whole number. */
export const parseRupiah = (s: string) => (/^\d[\d.]*$/.test(s.trim()) ? Number(s.trim().replace(/\./g, '')) : NaN)

/** Exact amount, then the next round notes above the total (Lakasir's quick-amount buttons). */
export function quickAmounts(total: number): number[] {
  const ups = [5_000, 10_000, 20_000, 50_000, 100_000].map((step) => Math.ceil(total / step) * step).filter((n) => n > total)
  return [...new Set([total, ...ups])].slice(0, 5)
}

/** One numpad key on the "uang diterima" text: digits and 000 append (no leading zeros), ⌫ deletes. */
export const numpadEdit = (text: string, key: string) =>
  key === 'hapus' ? text.slice(0, -1) : (text + key).replace(/^0+(?=\d)/, '').slice(0, 13)
