import { formatRupiah, type StatDelta } from '@umkmall/ui/primitives'

// Pure wording of the dashboard widgets (design feature 35). pos-api computes every figure (sums, averages, percent
// changes, order); these only choose words and labels, and cap a list for the card.

export type Period = 'today' | 'week' | 'month' | 'year'

export const PERIODS: {
  value: Period
  label: string
  /** "dari kemarin" */
  previous: string
  /** The hero's label: "Penjualan hari ini". */
  heading: string
  /** The trend card's title: what it draws. */
  trend: string
}[] = [
  {
    value: 'today',
    label: 'Hari ini',
    previous: 'kemarin',
    heading: 'Penjualan hari ini',
    trend: 'Penjualan 7 hari',
  },
  {
    value: 'week',
    label: 'Minggu ini',
    previous: 'minggu lalu',
    heading: 'Penjualan minggu ini',
    trend: 'Penjualan 8 minggu',
  },
  {
    value: 'month',
    label: 'Bulan ini',
    previous: 'bulan lalu',
    heading: 'Penjualan bulan ini',
    trend: 'Penjualan 6 bulan',
  },
  {
    value: 'year',
    label: 'Tahun ini',
    previous: 'tahun lalu',
    heading: 'Penjualan tahun ini',
    trend: 'Penjualan 3 tahun',
  },
]

export const periodInfo = (p: Period) => PERIODS.find((x) => x.value === p)!

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** The label under one trend bucket, from its first store date `YYYY-MM-DD` (no timezone shift): Rab, 10 Nov, Nov, 2026. */
export function trendLabel(period: Period, from: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from)
  if (!m) return from
  const [, y, mo, d] = m
  if (period === 'year') return y
  if (period === 'month') return MONTHS[Number(mo) - 1]
  if (period === 'week') return `${Number(d)} ${MONTHS[Number(mo) - 1]}`
  return DAYS[new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay()]
}

/**
 * The change a tile writes ("naik 23% dari kemarin"). `percent` and `count` are the server's; null = nothing in the
 * period before, which the tile words as a hint instead.
 */
export function deltaOf(period: Period, change: number | null, unit: 'percent' | 'count' = 'percent'): StatDelta | undefined {
  if (change === null) return undefined
  return { value: change, unit, label: `dari ${periodInfo(period).previous}` }
}

export const noComparison = (period: Period) => `Belum ada data ${periodInfo(period).previous}`

/** Money tile values; the dashboard writes full rupiah in a figure and short rupiah only on an axis or a title. */
export const money = formatRupiah

export function peakText(peak: { hour: number; sales: number } | null): string {
  return peak
    ? `Paling ramai jam ${peak.hour} (${formatRupiah(peak.sales)}). Makin gelap makin ramai.`
    : 'Belum ada penjualan hari ini.'
}

/** Only a positive part is a slice of the bar; the server's order (largest first) is kept. */
export function mixParts<T extends { value: number }>(parts: T[]): T[] {
  return parts.filter((p) => p.value > 0)
}

/** At most five bars in a card (design rule); the server already sent them largest first. */
export const CARD_ROWS = 5
export const topRows = <T>(rows: T[]): T[] => rows.slice(0, CARD_ROWS)

export function agingFooter(total: number, customers: number): string {
  return `Total ${formatRupiah(total)} · ${customers} pelanggan.`
}

export function lowStockFooter(total: number, shown: number): string {
  return total > shown ? `Menampilkan ${shown} dari ${total} produk yang perlu diisi.` : `${total} produk perlu diisi.`
}

export const expensesFooter = (total: number) => `Total ${formatRupiah(total)}.`

/** True when a trend has nothing to draw: every bucket is zero in sales. */
export const trendIsEmpty = (trend: { sales: number; salesCount: number }[]) =>
  trend.every((b) => b.sales === 0 && b.salesCount === 0)
