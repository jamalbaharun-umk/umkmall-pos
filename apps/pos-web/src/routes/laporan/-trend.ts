import { formatRupiah } from '@umkmall/ui/primitives'
import type { BarsVisual } from './-visuals'

// "Penjualan dan pengeluaran" (design feature 37). pos-api sends the buckets, the totals and the change; these helpers
// only move the window, filter the series and word the summary.

export type Scale = 'day' | 'month' | 'year'
export type Metric = 'sales' | 'expenses' | 'both'

export const SCALES: { value: Scale; label: string }[] = [
  { value: 'day', label: 'Harian' },
  { value: 'month', label: 'Bulanan' },
  { value: 'year', label: 'Tahunan' },
]
export const METRICS: { value: Metric; label: string }[] = [
  { value: 'sales', label: 'Penjualan' },
  { value: 'expenses', label: 'Pengeluaran' },
  { value: 'both', label: 'Keduanya' },
]

export const asScale = (v: unknown): Scale => (v === 'month' || v === 'year' ? v : 'day')
export const asMetric = (v: unknown): Metric => (v === 'sales' || v === 'expenses' ? v : 'both')
export const asDate = (v: unknown): string | undefined => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)

export type TrendReport = {
  scale: Scale
  timezone: string
  today: string
  from: string
  to: string
  count: number
  periodLabel: string
  partialLast: boolean
  buckets: { key: string; label: string; sales: number; expenses: number }[]
  totals: { sales: number; cost: number; grossProfit: number; expenses: number; netProfit: number; tax: number }
  previous: { from: string; to: string; periodLabel: string; sales: number; expenses: number }
  change: { sales: number | null; expenses: number | null }
  visual: BarsVisual
}

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`)
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10)

/** One bucket step forwards (`dir` 1) or backwards (-1) from the bucket that holds `d`; returns that bucket's first day. */
function stepBucket(scale: Scale, d: string, dir: 1 | -1): string {
  if (scale === 'day') return ymd(ms(d) + dir * 86_400_000)
  const y = Number(d.slice(0, 4))
  const m = Number(d.slice(5, 7))
  if (scale === 'year') return `${y + dir}-01-01`
  const t = y * 12 + (m - 1) + dir
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
}

/** The anchor date of the window before (`dir` -1) or after (1): one whole window of `count` buckets away. */
export function shiftAnchor(scale: Scale, anchor: string, count: number, dir: 1 | -1): string {
  let d = anchor
  for (let i = 0; i < count; i++) d = stepBucket(scale, d, dir)
  return d
}

/** The next window is shown only when this one does not already reach today. */
export const hasNext = (r: Pick<TrendReport, 'to' | 'today'>): boolean => r.to < r.today

/** Series of the chosen metric; the chart keeps each series' own colour so "Penjualan" is always blue. */
export function visibleVisual(v: BarsVisual, metric: Metric): BarsVisual {
  if (metric === 'both') return v
  const label = metric === 'sales' ? 'Penjualan' : 'Pengeluaran'
  const series = v.series.filter((s) => s.label === label)
  return { ...v, title: `${label} ${v.title.replace(/^Penjualan dan pengeluaran /, '')}`, series: series.length ? series : v.series }
}

const money = (n: number) => formatRupiah(n)
/** "naik 8%", "turun 12%", "tetap"; null when the period before had nothing to compare with. */
export function changeWord(pct: number | null): string | null {
  if (pct === null) return null
  return pct === 0 ? 'tetap' : pct > 0 ? `naik ${pct}%` : `turun ${Math.abs(pct)}%`
}

/** "Penjualan naik 8% dari 13 sampai 19 Nov. Pengeluaran turun 12%." */
export function comparison(r: Pick<TrendReport, 'change' | 'previous'>): string {
  const s = changeWord(r.change.sales)
  const e = changeWord(r.change.expenses)
  if (s === null && e === null) return `Belum ada data pada ${r.previous.periodLabel} untuk dibandingkan.`
  const parts = [s === null ? null : `Penjualan ${s} dari ${r.previous.periodLabel}.`, e === null ? null : `Pengeluaran ${e}.`]
  return parts.filter(Boolean).join(' ')
}

export const isEmptyReport = (r: Pick<TrendReport, 'totals' | 'buckets'>): boolean =>
  r.totals.sales === 0 && r.totals.expenses === 0 && r.buckets.every((b) => b.sales === 0 && b.expenses === 0)

/** The sentence of the success toast: "PDF laporan 20 sampai 26 Nov 2026 siap diunduh". */
export const pdfToast = (periodLabel: string) => `PDF laporan ${periodLabel} siap diunduh`

/** A negative profit reads "−Rp1.000", never "Rp-1.000". */
export const signed = money

export const TABLE_HEADINGS: Record<Scale, string> = { day: 'Hari', month: 'Bulan', year: 'Tahun' }
