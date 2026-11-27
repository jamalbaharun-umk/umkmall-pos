/** Whole rupiah, Indonesian grouping. A negative amount puts the sign in front: "−Rp32.000", never "Rp-32.000". */
export const rupiah = (n: number): string => `${n < 0 ? '−' : ''}Rp${Math.abs(n).toLocaleString('id-ID')}`
