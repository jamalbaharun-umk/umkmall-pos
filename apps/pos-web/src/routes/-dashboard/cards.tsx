import { Link } from '@tanstack/react-router'
import { Card } from '@umkmall/ui/compositions'
import {
  BarChart,
  Badge,
  Button,
  ChartFrame,
  HeatStrip,
  MeterList,
  SegmentedBar,
  Skeleton,
  StatTile,
  type ChartState,
} from '@umkmall/ui/primitives'
import type { ReactNode } from 'react'
import { ActionRow } from '@/components/action-row'
import { expiringFooter, expiryText, formatDay } from '@/lib/expiry'
import { loadProfitLoss } from '../laporan/-api'
import { alertDetail, alertsFooter, alertTitle } from '../resep/-recipe'
import {
  loadAging,
  loadCostAlerts,
  loadExpiring,
  loadHourly,
  loadLowStock,
  loadOverview,
  loadPaymentMix,
  loadTopProducts,
  type Overview,
} from './api'
import { useWidget, type WidgetContext, type WidgetState } from './use-widget'
import {
  CARD_ROWS,
  agingFooter,
  deltaOf,
  expensesFooter,
  lowStockFooter,
  mixParts,
  money,
  noComparison,
  peakText,
  periodInfo,
  topRows,
  trendIsEmpty,
  trendLabel,
  type Period,
} from './wording'

/**
 * In a narrow tile the value and its small line do not fit side by side (the package's tile keeps them in one row and the
 * line runs out of the tile), so the line may wrap under the value. Styled from here: `packages/ui` is not edited.
 */
const TILE = '[&_.ds-chart-tile-row]:flex-wrap [&_.ds-chart-tile-row]:items-end'

/** The overview is one request for the headline and the trend card. */
export type OverviewState = [WidgetState<Overview>, () => void]
export const useOverview = (ctx: WidgetContext, period: Period): OverviewState =>
  useWidget(ctx, 'memuat ringkasan penjualan', () => loadOverview({ data: period }), [period])

const FAILED = 'Kartu ini gagal dimuat. Kartu lain tetap tampil.'

/** A card of the dashboard: its chart, then one link to the full report (a real link, 44 px, not a clickable card). */
function WidgetCard({ children, link }: { children: ReactNode; link?: ReactNode }) {
  return (
    <Card variant="outlined" padding="medium" className="flex min-w-0 flex-col gap-3">
      {children}
      {link && <ActionRow align="start">{link}</ActionRow>}
    </Card>
  )
}

/** The card's one link to its full report: an outline button wrapping the router link it is given. */
function ReportButton({ children }: { children: ReactNode }) {
  return (
    <Button asChild type="outline" color="primary" size="small" width="auto">
      {children}
    </Button>
  )
}

const stateOf = (s: { status: string }, empty: boolean): ChartState =>
  s.status === 'loading' ? 'loading' : s.status === 'error' ? 'error' : empty ? 'empty' : 'ready'

const OpenCashier = (
  <Button asChild type="primary" color="primary" size="small" width="auto">
    <Link to="/kasir">Buka kasir</Link>
  </Button>
)

/** Hero (sales of the period with its trend and change) and the three tiles: one request, one error. */
export function Headline({ overview: [state, reload], period }: { overview: OverviewState; period: Period }) {
  if (state.status === 'hidden') return null
  const info = periodInfo(period)
  if (state.status === 'loading')
    return (
      <div className="grid gap-3" role="status" aria-label="Memuat ringkasan">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    )
  if (state.status === 'error')
    return (
      <ChartFrame
        title={info.heading}
        state="error"
        errorText="Ringkasan penjualan gagal dimuat."
        onRetry={reload}
        height={96}
        boxed
      />
    )
  const o = state.data
  const trend = (pick: (b: (typeof o.trend)[number]) => number) => o.trend.map(pick)
  const hint = (c: number | null) => (c === null ? noComparison(period) : undefined)
  return (
    <section aria-label="Ringkasan penjualan" className="grid gap-3">
      <StatTile
        label={info.heading}
        value={money(o.current.sales)}
        delta={deltaOf(period, o.delta.sales)}
        hint={hint(o.delta.sales) ?? (o.current.salesCount === 0 ? 'Belum ada penjualan' : undefined)}
        values={trend((b) => b.sales)}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          className={TILE}
          label="Transaksi"
          value={String(o.current.salesCount)}
          delta={deltaOf(period, o.delta.salesCount, 'count')}
          values={trend((b) => b.salesCount)}
        />
        <StatTile
          className={TILE}
          label="Rata-rata keranjang"
          value={money(o.current.averageBasket)}
          delta={deltaOf(period, o.delta.averageBasket)}
          hint={hint(o.delta.averageBasket)}
          values={trend((b) => b.averageBasket)}
        />
        <StatTile
          className={TILE}
          label="Laba kotor"
          value={money(o.current.grossProfit)}
          delta={deltaOf(period, o.delta.grossProfit)}
          hint={hint(o.delta.grossProfit)}
          values={trend((b) => b.grossProfit)}
        />
      </div>
    </section>
  )
}

export function TrendCard({ overview: [state, reload], period }: { overview: OverviewState; period: Period }) {
  if (state.status === 'hidden') return null
  const trend = state.status === 'ready' ? state.data.trend : []
  const empty = state.status === 'ready' && trendIsEmpty(trend)
  return (
    <WidgetCard
      link={
        <ReportButton>
          <Link to="/laporan/$jenis" params={{ jenis: 'sales' }}>
            Buka laporan penjualan
          </Link>
        </ReportButton>
      }
    >
      <BarChart
        title={periodInfo(period).trend}
        description="Penjualan tanpa pajak."
        state={stateOf(state, empty)}
        onRetry={reload}
        errorText={FAILED}
        emptyText="Grafik muncul setelah ada penjualan."
        categories={trend.map((b) => trendLabel(period, b.from))}
        series={[{ label: 'Penjualan', values: trend.map((b) => b.sales) }]}
        unit="rupiah"
        categoryLabel="Waktu"
      />
      {empty && OpenCashier}
    </WidgetCard>
  )
}

export function HourlyCard({ ctx }: { ctx: WidgetContext }) {
  const [state, reload] = useWidget(ctx, 'memuat penjualan per jam', () => loadHourly())
  if (state.status === 'hidden') return null
  const h = state.status === 'ready' ? state.data : null
  const empty = h !== null && h.peak === null && h.total === 0
  return (
    <WidgetCard
      link={
        <ReportButton>
          <Link to="/laporan/$jenis" params={{ jenis: 'sales' }}>
            Buka laporan penjualan
          </Link>
        </ReportButton>
      }
    >
      <HeatStrip
        title="Penjualan per jam hari ini"
        description="Penjualan tanpa pajak."
        state={stateOf(state, empty)}
        onRetry={reload}
        errorText={FAILED}
        emptyText="Grafik muncul setelah ada penjualan hari ini."
        values={h?.hours.map((x) => x.sales) ?? []}
        labels={h?.hours.map((x) => String(x.hour)) ?? []}
        valueLabel="Penjualan"
        categoryLabel="Jam"
        unit="rupiah"
      />
      {h && !empty && <p className="text-sm text-default-secondary">{peakText(h.peak)}</p>}
    </WidgetCard>
  )
}

export function PaymentCard({ ctx }: { ctx: WidgetContext }) {
  const [state, reload] = useWidget(ctx, 'memuat cara bayar', () => loadPaymentMix())
  if (state.status === 'hidden') return null
  const parts = state.status === 'ready' ? mixParts(state.data.parts) : []
  const empty = state.status === 'ready' && parts.length === 0
  return (
    <WidgetCard
      link={
        <ReportButton>
          <Link to="/laporan/$jenis" params={{ jenis: 'sales' }}>
            Buka laporan penjualan
          </Link>
        </ReportButton>
      }
    >
      <SegmentedBar
        title="Cara bayar hari ini"
        description="Penjualan tanpa pajak menurut metode pembayaran."
        state={stateOf(state, empty)}
        onRetry={reload}
        errorText={FAILED}
        emptyText="Grafik muncul setelah ada penjualan hari ini."
        parts={parts.map((p) => ({ label: p.name, value: p.value }))}
        unit="rupiah"
        categoryLabel="Metode"
      />
    </WidgetCard>
  )
}

export function TopProductsCard({ ctx }: { ctx: WidgetContext }) {
  const [state, reload] = useWidget(ctx, 'memuat produk terlaris', () => loadTopProducts())
  if (state.status === 'hidden') return null
  const rows = state.status === 'ready' ? topRows(state.data.rows) : []
  const empty = state.status === 'ready' && rows.length === 0
  return (
    <WidgetCard
      link={
        <ReportButton>
          <Link to="/laporan/$jenis" params={{ jenis: 'products' }}>
            Buka laporan produk
          </Link>
        </ReportButton>
      }
    >
      <BarChart
        title="Terlaris minggu ini"
        description="Jumlah terjual (pcs)."
        state={stateOf(state, empty)}
        onRetry={reload}
        errorText={FAILED}
        emptyText="Belum ada penjualan minggu ini. Mulai dari layar Kasir."
        orientation="horizontal"
        categories={rows.map((r) => r.name)}
        series={[{ label: 'Terjual', values: rows.map((r) => r.qty) }]}
        unit="count"
        categoryLabel="Produk"
      />
      {empty && OpenCashier}
    </WidgetCard>
  )
}

export function LowStockCard({ ctx }: { ctx: WidgetContext }) {
  const [state, reload] = useWidget(ctx, 'memuat stok menipis', () => loadLowStock())
  if (state.status === 'hidden') return null
  const d = state.status === 'ready' ? state.data : null
  const empty = d !== null && d.rows.length === 0
  return (
    <WidgetCard
      link={
        <ReportButton>
          <Link to="/catalog/products" search={{ stock: 'low' }}>
            Buka daftar produk
          </Link>
        </ReportButton>
      }
    >
      <MeterList
        title="Stok menipis"
        state={stateOf(state, empty)}
        onRetry={reload}
        errorText={FAILED}
        emptyText="Semua stok masih aman."
        items={(d?.rows ?? []).map((r) => ({
          label: r.name,
          value: r.onHand,
          max: r.fullLevel,
          limit: r.threshold,
          unit: r.unit.toLowerCase(),
        }))}
        footer={
          d && !empty ? <p className="text-sm text-default-secondary">{lowStockFooter(d.total, d.rows.length)}</p> : undefined
        }
      />
    </WidgetCard>
  )
}

/** Stock that expires within 30 days or already has (UMK-2087): the product, its earliest date and the units left. */
export function ExpiringCard({ ctx }: { ctx: WidgetContext }) {
  const [state, reload] = useWidget(ctx, 'memuat stok segera kedaluwarsa', () => loadExpiring())
  if (state.status === 'hidden') return null
  const d = state.status === 'ready' ? state.data : null
  const empty = d !== null && d.rows.length === 0
  return (
    <WidgetCard
      link={
        <ReportButton>
          <Link to="/catalog/products">Buka daftar produk</Link>
        </ReportButton>
      }
    >
      <ChartFrame
        title="Segera kedaluwarsa"
        description="Stok yang kedaluwarsa dalam 30 hari atau sudah lewat."
        state={stateOf(state, empty)}
        onRetry={reload}
        errorText={FAILED}
        emptyText="Tidak ada stok yang akan kedaluwarsa dalam 30 hari."
        footer={
          d && !empty ? (
            <p className="mt-2 text-sm text-default-secondary">{expiringFooter(d.total, d.rows.length, d.days)}</p>
          ) : undefined
        }
      >
        <ul className="flex flex-col divide-y divide-border-light">
          {(d?.rows ?? []).map((r) => (
            <li key={r.productId} className="flex min-w-0 items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-xs text-default-secondary">
                  {formatDay(r.expiresAt)} · {r.qty} {r.unit.toLowerCase()}
                </p>
              </div>
              <Badge color={r.expired ? 'danger' : 'warning'} size="small" className="shrink-0 whitespace-nowrap">
                {expiryText(r.daysLeft)}
              </Badge>
            </li>
          ))}
        </ul>
      </ChartFrame>
    </WidgetCard>
  )
}

export function AgingCard({ ctx }: { ctx: WidgetContext }) {
  const [state, reload] = useWidget(ctx, 'memuat umur piutang', () => loadAging())
  if (state.status === 'hidden') return null
  const d = state.status === 'ready' ? state.data : null
  const empty = d !== null && d.total === 0
  return (
    <WidgetCard
      link={
        <ReportButton>
          <Link to="/laporan/kasbon">Buka laporan kasbon</Link>
        </ReportButton>
      }
    >
      <SegmentedBar
        title="Piutang menurut umur"
        state={stateOf(state, empty)}
        onRetry={reload}
        errorText={FAILED}
        emptyText="Tidak ada piutang yang belum dibayar."
        palette="sequential"
        parts={(d?.buckets ?? []).map((b) => ({
          label: b.label,
          value: b.amount,
        }))}
        unit="rupiah"
        categoryLabel="Umur"
      />
      {d && !empty && <p className="text-sm text-default-secondary">{agingFooter(d.total, d.customers)}</p>}
    </WidgetCard>
  )
}

export function ExpensesCard({ ctx }: { ctx: WidgetContext }) {
  const [state, reload] = useWidget(ctx, 'memuat pengeluaran', () => loadProfitLoss({ data: 'month' }))
  if (state.status === 'hidden') return null
  const d = state.status === 'ready' ? state.data : null
  const rows = d ? topRows(d.topExpenses) : []
  const empty = d !== null && rows.length === 0
  return (
    <WidgetCard
      link={
        <ReportButton>
          <Link to="/laporan/untung-rugi" search={{ period: 'month' }}>
            Buka laporan untung rugi
          </Link>
        </ReportButton>
      }
    >
      <BarChart
        title="Pengeluaran bulan ini"
        state={stateOf(state, empty)}
        onRetry={reload}
        errorText={FAILED}
        emptyText="Belum ada pengeluaran bulan ini."
        orientation="horizontal"
        categories={rows.map((r) => r.label)}
        series={[{ label: 'Pengeluaran', values: rows.map((r) => r.total) }]}
        unit="rupiah"
        categoryLabel="Kategori"
      />
      {d && !empty && (
        <p className="text-sm text-default-secondary">
          {expensesFooter(d.current.expenses)}
          {d.topExpenses.length > CARD_ROWS ? ` Lima kategori terbesar dari ${d.topExpenses.length}.` : ''}
        </p>
      )}
    </WidgetCard>
  )
}

/**
 * UMK-2126, design 43 screen 5: recipes whose cost per portion rose 5% or more since the cost price was last set. A bar chart
 * compares the stored cost with today's, each row opens the recipe. Hidden when nothing rose (and for an actor without
 * `catalog.manage`, whom pos-api answers 403). Nothing here changes a price.
 */
export function CostRiseCard({ ctx }: { ctx: WidgetContext }) {
  const [state, reload] = useWidget(ctx, 'memuat biaya resep yang naik', () => loadCostAlerts())
  if (state.status === 'hidden') return null
  const d = state.status === 'ready' ? state.data : null
  if (d !== null && d.rows.length === 0) return null
  return (
    <WidgetCard>
      <BarChart
        title="Biaya resep naik"
        state={stateOf(state, false)}
        onRetry={reload}
        errorText={FAILED}
        emptyText="Belum ada resep yang biayanya naik."
        orientation="horizontal"
        categories={(d?.rows ?? []).map((r) => r.product.name)}
        series={[
          { label: 'Harga modal tersimpan', values: (d?.rows ?? []).map((r) => r.previousCost) },
          { label: 'Biaya sekarang', values: (d?.rows ?? []).map((r) => r.costPerPortion) },
        ]}
        unit="rupiah"
        categoryLabel="Resep"
      />
      {d && (
        <>
          <ul className="flex flex-col divide-y divide-default-secondary">
            {d.rows.map((r) => (
              <li key={r.recipeId}>
                <Link to="/resep/$id" params={{ id: r.recipeId }} className="flex min-h-11 flex-col justify-center py-2 hover:underline">
                  <span className="font-medium text-default-primary">{alertTitle(r)}</span>
                  <span className="text-sm text-default-secondary">{alertDetail(r)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-sm text-default-secondary">{alertsFooter(d.total, d.rows.length)}</p>
        </>
      )}
    </WidgetCard>
  )
}
