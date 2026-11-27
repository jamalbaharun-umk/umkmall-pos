/**
 * Whole rupiah, Indonesian grouping. A negative amount puts the sign in front: "−Rp32.000", never "Rp-32.000" or a
 * hyphen. An amount that rounds to zero (0, -0, -0.4) is "Rp0", never "−Rp0".
 */
export const rupiah = (n: number): string => {
  const v = Math.round(n)
  return `${v < 0 ? '−' : ''}Rp${Math.abs(v).toLocaleString('id-ID')}`
}
