// Expiry dates (UMK-2087): a store calendar day `YYYY-MM-DD`, shown without any timezone shift. pos-api decides what is
// expired or soon (`daysLeft`, `expired`); these only write it in Indonesian.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** "5 Des 2026" from "2026-12-05"; anything else comes back as it is. */
export function formatDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : day
}

/** How far a date is from today, from the server's whole-day count (negative = already past). */
export function expiryText(daysLeft: number): string {
  if (daysLeft < -1) return `Kedaluwarsa ${-daysLeft} hari lalu`
  if (daysLeft === -1) return 'Kedaluwarsa kemarin'
  if (daysLeft === 0) return 'Kedaluwarsa hari ini'
  if (daysLeft === 1) return 'Kedaluwarsa besok'
  return `Kedaluwarsa ${daysLeft} hari lagi`
}

export function expiringFooter(total: number, shown: number, days: number): string {
  return total > shown
    ? `Menampilkan ${shown} dari ${total} produk yang kedaluwarsa dalam ${days} hari.`
    : `${total} produk kedaluwarsa dalam ${days} hari.`
}
