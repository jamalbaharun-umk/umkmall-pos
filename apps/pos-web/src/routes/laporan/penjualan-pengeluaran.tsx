import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Card } from '@umkmall/ui/compositions'
import {
  Button,
  CheckBox,
  Dialog,
  formatRupiah,
  SegmentedControl,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@umkmall/ui/primitives'
import { ActionRow } from '@/components/action-row'
import { Empty, Panel } from '@/components/page'
import { ReportVisual } from '@/components/report-visual'
import { SCROLL_ROW } from '@/lib/scroll-row'
import { downloadPdf } from './-pdf-download'
import {
  asDate,
  asMetric,
  asScale,
  comparison,
  hasNext,
  isEmptyReport,
  METRICS,
  SCALES,
  pageAnchor,
  TABLE_HEADINGS,
  visibleVisual,
  type Metric,
  type Scale,
  type TrendReport,
} from './-trend'
import { loadTrend } from './-visuals-api'
import { ReportError, ReportLayout } from './-ui'

// Design feature 37 "Laporan dengan diagram batang dan ekspor PDF": sales and expenses per day, month or year with the
// change from the period before, a chart and the table twin. Every figure is pos-api's (the profit and loss figures);
// nothing is computed here. The PDF is made by pos-api.

type Search = { scale: Scale; metric: Metric; to?: string }

export const Route = createFileRoute('/laporan/penjualan-pengeluaran')({
  validateSearch: (s: Record<string, unknown>): Search => ({ scale: asScale(s.scale), metric: asMetric(s.metric), to: asDate(s.to) }),
  loaderDeps: ({ search }) => ({ scale: search.scale, to: search.to }),
  loader: ({ deps }) => loadTrend({ data: deps }),
  component: TrendPage,
  pendingComponent: TrendPending,
  errorComponent: () => <ReportError />,
})

const TITLE = 'Penjualan dan pengeluaran'
const money = (n: number) => formatRupiah(n)

/** Loading: the controls' place, summary cards and the chart as skeletons; the table follows. */
function TrendPending() {
  return (
    <ReportLayout title={TITLE}>
      <div role="status" aria-label="Memuat" className="flex flex-col gap-4">
        <Skeleton className="h-11 w-72" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-56 w-full" />
      </div>
    </ReportLayout>
  )
}

function TrendPage() {
  const result = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/laporan/penjualan-pengeluaran' })
  const [exportOpen, setExportOpen] = useState(false)
  // A failed load shows the message and the retry, never old numbers.
  if (!result.ok) return <ReportError message={result.error} />
  const r = result.data
  const go = (next: Partial<Search>) => void navigate({ search: (prev) => ({ ...prev, ...next }) })
  const empty = isEmptyReport(r)
  return (
    <ReportLayout title={TITLE}>
      <Panel>
        <div className="flex flex-col gap-3 p-4">
          <SegmentedControl
            aria-label="Skala"
            className={`max-w-md ${SCROLL_ROW}`}
            options={SCALES}
            value={r.scale}
            onChange={(scale) => go({ scale, to: undefined })}
          />
          <div className="flex items-center justify-between gap-2">
            <Button
              type="outline"
              color="primary"
              width="auto"
              iconOnly
              aria-label="Periode sebelumnya"
              className="h-11! w-11! shrink-0"
              onClick={() => go({ to: pageAnchor(r, -1) })}
            >
              <ChevronLeft className="size-5" aria-hidden />
            </Button>
            <p className="text-center font-semibold text-default-primary" aria-live="polite">
              {r.periodLabel}
            </p>
            <Button
              type="outline"
              color="primary"
              width="auto"
              iconOnly
              aria-label="Periode berikutnya"
              disabled={!hasNext(r)}
              className="h-11! w-11! shrink-0"
              onClick={() => go({ to: pageAnchor(r, 1) })}
            >
              <ChevronRight className="size-5" aria-hidden />
            </Button>
          </div>
          <SegmentedControl
            aria-label="Yang ditampilkan"
            className={`max-w-md ${SCROLL_ROW}`}
            options={METRICS}
            value={search.metric}
            onChange={(metric) => go({ metric })}
          />
        </div>
      </Panel>
      {empty ? (
        <Panel>
          <Empty title="Belum ada penjualan di periode ini">Pilih periode lain.</Empty>
        </Panel>
      ) : (
        <>
          <Summary r={r} metric={search.metric} />
          <ReportVisual visual={visibleVisual(r.visual, search.metric)} />
          <Detail r={r} />
        </>
      )}
      <ActionRow align="start">
        <Button type="outline" color="primary" width="auto" disabled={empty} onClick={() => setExportOpen(true)}>
          Ekspor PDF
        </Button>
      </ActionRow>
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} r={r} />
    </ReportLayout>
  )
}

function Tile({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: 'error' }) {
  return (
    <Card variant="outlined" padding="medium">
      <p className="text-sm text-default-secondary">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums md:text-2xl ${tone === 'error' ? 'text-default-error' : 'text-default-primary'}`}>{money(value)}</p>
      {note && <p className="mt-1 text-xs text-default-secondary">{note}</p>}
    </Card>
  )
}

function Summary({ r, metric }: { r: TrendReport; metric: Metric }) {
  const t = r.totals
  return (
    <section aria-label="Ringkasan" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metric !== 'expenses' && <Tile label="Penjualan (tanpa pajak)" value={t.sales} />}
        {metric !== 'sales' && <Tile label="Pengeluaran" value={t.expenses} />}
        <Tile label="Laba kotor" value={t.grossProfit} />
        <Tile label="Laba bersih" value={t.netProfit} tone={t.netProfit < 0 ? 'error' : undefined} />
      </div>
      <p className="text-sm text-default-secondary">{comparison(r)}</p>
      <p className="text-xs text-default-secondary">
        Pajak yang dikumpulkan {money(t.tax)} tampil terpisah: bukan pendapatan dan tidak ada di angka di atas.
        {r.partialLast && ` Periode terakhir baru berjalan sampai hari ini.`}
      </p>
    </section>
  )
}

/** The table twin of the chart: the same figures, one row per bucket. */
function Detail({ r }: { r: TrendReport }) {
  return (
    <Panel>
      <h2 className="border-b border-default-primary p-4 font-semibold text-default-primary">Rincian per {TABLE_HEADINGS[r.scale].toLowerCase()}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{TABLE_HEADINGS[r.scale]}</TableHead>
            <TableHead className="text-right">Penjualan</TableHead>
            <TableHead className="text-right">Pengeluaran</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.buckets.map((b) => (
            <TableRow key={b.key}>
              <TableCell className="whitespace-nowrap">{b.label}</TableCell>
              <TableCell className="text-right tabular-nums">{money(b.sales)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(b.expenses)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-semibold">Total</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{money(r.totals.sales)}</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{money(r.totals.expenses)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Panel>
  )
}

/** "Ekspor PDF": pick what goes in (summary, chart, detail table), then "Buat PDF". The form keeps its ticks on failure. */
function ExportDialog({ open, onOpenChange, r }: { open: boolean; onOpenChange: (o: boolean) => void; r: TrendReport }) {
  const [parts, setParts] = useState({ summary: true, chart: true, table: true })
  const [busy, setBusy] = useState(false)
  // Two taps in one tick still start one file.
  const running = useRef(false)
  const include = (Object.keys(parts) as Array<keyof typeof parts>).filter((k) => parts[k]).join(',')
  const make = async () => {
    if (running.current || !include) return
    running.current = true
    setBusy(true)
    const ok = await downloadPdf({
      jenis: 'penjualan-pengeluaran',
      query: { scale: r.scale, to: r.to, count: String(r.count), include },
      label: r.periodLabel,
      retry: () => void make(),
    }).finally(() => {
      running.current = false
      setBusy(false)
    })
    if (ok) onOpenChange(false)
  }
  const tick = (k: keyof typeof parts, label: string) => (
    <CheckBox key={k} label={label} checked={parts[k]} onChange={(e) => setParts((p) => ({ ...p, [k]: e.target.checked }))} />
  )
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)} title="Ekspor PDF" size="medium">
      <div className="flex flex-col gap-4 px-6 pt-2 pb-6">
        <p className="text-sm text-default-secondary">
          Laporan {SCALES.find((s) => s.value === r.scale)?.label.toLowerCase()} {r.periodLabel}. Kertas A4 tegak. Penjualan tanpa pajak; pajak tampil terpisah.
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-default-primary">Isi laporan</legend>
          {tick('summary', 'Ringkasan')}
          {tick('chart', 'Diagram')}
          {tick('table', `Rincian per ${TABLE_HEADINGS[r.scale].toLowerCase()}`)}
        </fieldset>
        {busy && (
          <p role="status" className="text-sm text-default-secondary">
            Membuat PDF… jangan tutup layar ini.
          </p>
        )}
        <ActionRow>
          <Button type="outline" color="primary" width="auto" disabled={busy} onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button type="primary" color="primary" width="auto" isLoading={busy} disabled={!include} onClick={() => void make()}>
            Buat PDF
          </Button>
        </ActionRow>
      </div>
    </Dialog>
  )
}
