// The charts of the reports (design features 37 and 38) as pos-api sends them. pos-api picks what each chart shows and
// computes every number (integer rupiah or counts); the screen only draws it with the `@umkmall/ui` Charts, and the
// server PDF draws the same visuals with the same components. Mirror of `pos-api/src/reports/visuals/types.ts`.

export type VisualUnit = 'rupiah' | 'count'
export type VisualSlot = 1 | 2 | 3 | 4 | 'other' | 'neg'

type Base = { id: string; title: string; unit: VisualUnit; categoryLabel?: string }
export type BarsVisual = Base & {
  kind: 'bars'
  orientation: 'vertical' | 'horizontal'
  categories: string[]
  series: { label: string; values: number[]; color?: VisualSlot }[]
  stacked?: boolean
}
export type SegmentsVisual = Base & {
  kind: 'segments'
  palette?: 'categorical' | 'sequential'
  parts: { label: string; value: number }[]
}
export type Visual = BarsVisual | SegmentsVisual

/** Nothing to draw: every value is zero or there is no category. The screen says "Belum ada data" instead. */
export function visualIsEmpty(v: Visual): boolean {
  return v.kind === 'bars'
    ? v.categories.length === 0 || v.series.every((s) => s.values.every((x) => x === 0))
    : v.parts.every((p) => p.value <= 0)
}

/** Which reports have visuals, and the pos-api path of each (the query goes after it). */
export type VisualKind = 'sales' | 'products' | 'shifts' | 'purchasing' | 'profit-loss' | 'receivables'
export const VISUAL_PATHS: Record<VisualKind, string> = {
  sales: '/reports/visuals/sales',
  products: '/reports/visuals/products',
  shifts: '/reports/visuals/shifts',
  purchasing: '/reports/visuals/purchasing',
  'profit-loss': '/reports/visuals/profit-loss',
  receivables: '/reports/visuals/receivables',
}

/** The visuals of a report kind by its screen's `jenis` (the URL segment of /laporan/$jenis). */
export const KIND_BY_JENIS: Record<string, VisualKind> = {
  penjualan: 'sales',
  produk: 'products',
  shift: 'shifts',
  pembelian: 'purchasing',
}

const QUERY_KEYS = ['from', 'to', 'period', 'filter'] as const

/** Only the known query keys, as a query string: the relay never forwards anything else to pos-api. */
export function visualQuery(q: Record<string, string | undefined>): string {
  const out = new URLSearchParams()
  for (const k of QUERY_KEYS) if (q[k]) out.set(k, q[k] as string)
  return out.toString()
}

/** What the skeleton of a loading report says each chart will be. */
export const VISUAL_TITLES: Record<VisualKind, string[]> = {
  sales: ['Tren penjualan', 'Cara bayar', 'Produk terlaris'],
  products: ['Penjualan per produk', 'Laba kotor per produk'],
  shifts: ['Pendapatan per shift'],
  purchasing: ['Pembelian per pemasok'],
  'profit-loss': ['Dari hasil jualan ke untung bersih', 'Pengeluaran per kategori'],
  receivables: ['Piutang menurut umur', 'Pelanggan dengan sisa terbesar'],
}
