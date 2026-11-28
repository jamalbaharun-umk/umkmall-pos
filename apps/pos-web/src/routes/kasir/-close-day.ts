import { rupiah } from '../../lib/rupiah'
import { cashDifference, parseRupiah } from './-money'

// UMK-2122 "Tutup hari" (design 41): the solo owner's closing screen. Pure logic; the screen is `-close-day.tsx`.

/** The store day the POS numbers its days by (hold numbers, UMK-2038): Asia/Jakarta. */
export const STORE_DAY_TIMEZONE = 'Asia/Jakarta'

const dayKey = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: STORE_DAY_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

/** "Kamis, 26 Nov 2026": the store day of a time. */
export const storeDayText = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', {
    timeZone: STORE_DAY_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))

/** "Tutup kemarin dulu": the open shift began on an earlier store day than `now`. */
export const openedBeforeToday = (openedAt: string, now = new Date()) => dayKey(new Date(openedAt)) < dayKey(now)

export type Keep = 'keep' | 'take'

/**
 * The amount the owner takes: '' or an invalid amount is an error message, else the number. Above the count is
 * refused here as pos-api refuses it (`OWNER_TAKES_TOO_MUCH`).
 */
export function takeOf(keep: Keep, text: string, counted: number): { amount: number; error?: string } {
  if (keep === 'keep') return { amount: 0 }
  if (!text.trim()) return { amount: 0, error: 'Isi jumlah yang diambil' }
  const n = parseRupiah(text)
  if (Number.isNaN(n)) return { amount: 0, error: 'Harus bilangan bulat rupiah, misalnya 500.000' }
  if (n <= 0) return { amount: 0, error: 'Jumlah diambil harus lebih dari 0' }
  if (n > counted) return { amount: 0, error: `Lebih besar dari uang di laci (${rupiah(counted)})` }
  return { amount: n }
}

/** "Selisih laci Rp0", "Laci kurang Rp1.000", "Laci lebih Rp500". */
export function drawerDifferenceText(difference: number): string {
  if (difference === 0) return 'Selisih laci Rp0'
  return `Laci ${difference < 0 ? 'kurang' : 'lebih'} ${rupiah(Math.abs(difference))}`
}

/** The success toast: "Hari ditutup. Selisih laci Rp0". */
export const closeDayToast = (difference: number) => `Hari ditutup. ${drawerDifferenceText(difference)}`

/** The difference while the owner counts, as the shift close shows it. */
export const liveDifference = (counted: number, expected: number) => cashDifference(counted, expected)

export type DaySummary = {
  openedAt: string
  revenue: number
  grossProfit: number
  counted: number
  taken: number
  difference: number
}

/**
 * The WhatsApp summary (design 41: on by default, can be turned off). Figures only: never a PIN, a token or a
 * customer's name. Sent by the owner through a wa.me link (the WhatsApp API is deferred, decision 2026-11-26).
 */
export function summaryText(d: DaySummary): string {
  return [
    `Tutup hari ${storeDayText(d.openedAt)}`,
    `Penjualan: ${rupiah(d.revenue)}`,
    `Untung (tanpa pajak): ${rupiah(d.grossProfit)}`,
    `Uang di laci: ${rupiah(d.counted)}`,
    ...(d.taken > 0 ? [`Diambil pemilik: ${rupiah(d.taken)}`] : []),
    `Uang awal besok: ${rupiah(d.counted - d.taken)}`,
    drawerDifferenceText(d.difference),
  ].join('\n')
}

export const summaryUrl = (d: DaySummary) => `https://wa.me/?text=${encodeURIComponent(summaryText(d))}`
