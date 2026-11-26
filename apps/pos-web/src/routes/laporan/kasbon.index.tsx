import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Card } from '@umkmall/ui/compositions'
import {
  Badge,
  Button,
  Dialog,
  Radio,
  SegmentedControl,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@umkmall/ui/primitives'
import { ChevronRight } from 'lucide-react'
import { ActionRow } from '@/components/action-row'
import { Empty, Panel } from '@/components/page'
import { useCan } from '@/components/shell'
import { SCROLL_ROW } from '@/lib/scroll-row'
import { loadKasbon, rupiah } from './-api'
import {
  customerLine,
  emptyState,
  FILTERS,
  parseFilter,
  shortDate,
  statusLabel,
  type KasbonCustomer,
  type KasbonFilter,
  type KasbonReport,
} from './-kasbon'
import { downloadKasbonCsv } from './-kasbon-download'
import { ReportError, ReportLayout } from './-ui'

// UMK-1964 "Laporan kasbon" (design feature 28): who still owes, how much, and who is overdue. Every number is
// pos-api's, from the kasbon and the append-only payment book.

export const Route = createFileRoute('/laporan/kasbon/')({
  validateSearch: (s: Record<string, unknown>): { filter?: KasbonFilter } => {
    const filter = parseFilter(s.filter)
    return filter === 'all' ? {} : { filter }
  },
  loaderDeps: ({ search }) => ({ filter: search.filter ?? 'all' }),
  loader: ({ deps }) => loadKasbon({ data: deps.filter }),
  component: KasbonPage,
  pendingComponent: KasbonPending,
  errorComponent: () => <ReportError />,
})

/** Loading: the summary tiles and five list rows, as skeletons. */
function KasbonPending() {
  return (
    <ReportLayout title="Laporan kasbon">
      <div role="status" aria-label="Memuat" className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-10 w-72" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </ReportLayout>
  )
}

function KasbonPage() {
  const result = Route.useLoaderData()
  const filter = Route.useSearch().filter ?? 'all'
  const navigate = useNavigate({ from: '/laporan/kasbon/' })
  const [exportOpen, setExportOpen] = useState(false)
  // A failed load shows the message and the retry, never old numbers.
  if (!result.ok) return <ReportError message={result.error} />
  const { summary, rows } = result.data
  const setFilter = (f: KasbonFilter) => void navigate({ search: f === 'all' ? {} : { filter: f } })
  return (
    <ReportLayout title="Laporan kasbon">
      <Summary report={result.data} />
      <Panel>
        <div className="flex flex-col gap-3 border-b border-default-primary p-4 md:flex-row md:items-center md:justify-between">
          <SegmentedControl aria-label="Filter jatuh tempo" className={SCROLL_ROW} options={FILTERS} value={filter} onChange={setFilter} />
          {summary.customers > 0 && (
            <ActionRow className="md:w-auto">
              <Button type="outline" color="primary" width="auto" onClick={() => setExportOpen(true)}>
                Ekspor CSV
              </Button>
            </ActionRow>
          )}
        </div>
        {result.data.truncated && (
          <p className="border-b border-default-primary px-4 py-2 text-sm text-default-secondary">
            Hanya 5.000 pelanggan pertama yang ditampilkan; ringkasan di atas tetap mencakup semuanya.
          </p>
        )}
        {rows.length === 0 ? <EmptyList filter={filter} customers={summary.customers} onShowAll={() => setFilter('all')} /> : <CustomerList rows={rows} />}
      </Panel>
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} initial={filter} />
    </ReportLayout>
  )
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'error' }) {
  return (
    <Card variant="outlined" padding="medium">
      <p className="text-sm text-default-secondary">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums md:text-2xl ${tone === 'error' ? 'text-default-error' : 'text-default-primary'}`}>
        {rupiah(value)}
      </p>
    </Card>
  )
}

function Summary({ report }: { report: KasbonReport }) {
  const s = report.summary
  return (
    <section aria-label="Ringkasan kasbon" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile label="Total piutang" value={s.totalRest} />
        <Tile label="Jatuh tempo" value={s.dueRest} tone={s.dueRest > 0 ? 'error' : undefined} />
        <Tile label="Dibayar bulan ini" value={s.paidThisMonth} />
        <Tile label="Dipegang penagih" value={s.collectorHeld} />
      </div>
      {s.collectorHeld > 0 && (
        <p className="text-sm text-default-secondary">
          Dibayar penagih, belum disetor: {rupiah(s.collectorHeld)}. Sudah mengurangi hutang pelanggan; uangnya masih di
          penagih sampai setoran diterima (
          <Link to="/kas-toko/setoran" className="font-medium text-default-brand underline">
            Setoran penagih
          </Link>
          ).
        </p>
      )}
    </section>
  )
}

function EmptyList({ filter, customers, onShowAll }: { filter: KasbonFilter; customers: number; onShowAll: () => void }) {
  const canSell = useCan('sales.create')
  const e = emptyState(filter, customers)
  return (
    <Empty
      title={e.title}
      action={
        e.showAll ? (
          <Button type="outline" color="primary" size="small" width="auto" onClick={onShowAll}>
            Tampilkan semua
          </Button>
        ) : canSell ? (
          <Button asChild type="primary" color="primary" size="small" width="auto">
            <a href="/kasir">Ke kasir</a>
          </Button>
        ) : undefined
      }
    >
      {e.body}
    </Empty>
  )
}

function StatusBadge({ r }: { r: KasbonCustomer }) {
  return <Badge color={r.status === 'due' ? 'danger' : 'light'}>{statusLabel(r)}</Badge>
}

/** A list of cards on a phone, a table from `md` (design: mobile list, desktop table). */
function CustomerList({ rows }: { rows: KasbonCustomer[] }) {
  return (
    <>
      <ul className="divide-y divide-default-primary md:hidden">
        {rows.map((r) => (
          <li key={r.memberId}>
            <Link
              to="/laporan/kasbon/$memberId"
              params={{ memberId: r.memberId }}
              className="flex items-center gap-3 px-4 py-3 hover:bg-weak-brand"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-default-primary">{r.name}</p>
                <p className="text-sm text-default-secondary">{customerLine(r)}</p>
                <p className={`text-sm ${r.status === 'due' ? 'text-default-error' : 'text-default-secondary'}`}>{statusLabel(r)}</p>
              </div>
              <p className="font-semibold tabular-nums text-default-primary">{rupiah(r.rest)}</p>
              <ChevronRight className="size-4 shrink-0 text-default-secondary" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pelanggan</TableHead>
              <TableHead className="text-right">Kasbon</TableHead>
              <TableHead className="text-right">Dibayar</TableHead>
              <TableHead className="text-right">Sisa</TableHead>
              <TableHead>Jatuh tempo</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.memberId}>
                <TableCell>
                  <Link
                    to="/laporan/kasbon/$memberId"
                    params={{ memberId: r.memberId }}
                    className="font-medium text-default-brand hover:underline"
                  >
                    {r.name}
                  </Link>
                  <div className="text-xs text-default-secondary">{r.kasbonCount} kasbon</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{rupiah(r.total)}</TableCell>
                <TableCell className="text-right tabular-nums">{rupiah(r.paid)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{rupiah(r.rest)}</TableCell>
                <TableCell className="whitespace-nowrap">{shortDate(r.oldestDueDate)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <StatusBadge r={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

const EXPORT_CHOICES: { value: KasbonFilter; label: string }[] = [
  { value: 'all', label: 'Semua yang belum lunas' },
  { value: 'due', label: 'Yang sudah jatuh tempo' },
  { value: 'not_due', label: 'Yang belum jatuh tempo' },
]

function ExportDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial: KasbonFilter }) {
  const [choice, setChoice] = useState<KasbonFilter>(initial)
  const [busy, setBusy] = useState(false)
  // Two taps in one tick still start one download.
  const running = useRef(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Ekspor CSV" size="medium">
      <div className="flex flex-col gap-4 px-6 pt-2 pb-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-default-primary">Periode</legend>
          {EXPORT_CHOICES.map((c) => (
            <Radio
              key={c.value}
              name="kasbon-export"
              label={c.label}
              value={c.value}
              checked={choice === c.value}
              onChange={() => setChoice(c.value)}
            />
          ))}
        </fieldset>
        <p className="text-sm text-default-secondary">
          Kolom: pelanggan, kasbon, dibayar, sisa, jatuh tempo, terlambat (hari). Nomor telepon tidak ikut.
        </p>
        <ActionRow>
          <Button type="outline" color="primary" width="auto" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            type="primary"
            color="primary"
            width="auto"
            isLoading={busy}
            onClick={async () => {
              if (running.current) return
              running.current = true
              setBusy(true)
              const ok = await downloadKasbonCsv({ filter: choice }).finally(() => {
                running.current = false
                setBusy(false)
              })
              if (ok) onOpenChange(false)
            }}
          >
            Unduh CSV
          </Button>
        </ActionRow>
      </div>
    </Dialog>
  )
}
