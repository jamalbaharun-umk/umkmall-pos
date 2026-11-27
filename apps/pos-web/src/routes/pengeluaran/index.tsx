import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Badge, Button, SegmentedControl } from '@umkmall/ui/primitives'
import { Card } from '@umkmall/ui/compositions'
import { Empty, Page, PageError, PageLoading, Panel } from '@/components/page'
import { useCan } from '@/components/shell'
import { CsvButton } from '../laporan/-csv-button'
import { loadExpenses } from './-api'
import { asPeriod, dayLabel, groupByDate, PERIODS, periodNoun, rupiah, sourceLabel, timeLabel } from './-helpers'

export const Route = createFileRoute('/pengeluaran/')({
  validateSearch: (s) => ({ period: asPeriod(s.period) }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadExpenses({ data: deps.period }),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: ExpenseList,
})

function ExpenseList() {
  const { list, timeZone } = Route.useLoaderData()
  const { period } = Route.useSearch()
  const navigate = useNavigate()
  const groups = groupByDate(list.data)
  // Without reports.view pos-api lists and totals only the expenses the actor recorded.
  const seesAll = useCan('reports.view')
  const add = (
    <>
      <CsvButton jenis="pengeluaran" period={period} />
      <Button type="primary" color="primary" width="auto" onClick={() => void navigate({ to: '/pengeluaran/baru' })}>
        + Catat pengeluaran
      </Button>
    </>
  )
  return (
    <Page title="Pengeluaran" crumbs={[{ label: 'Pengeluaran' }]} actions={add}>
      <SegmentedControl
        aria-label="Periode"
        className="max-w-md"
        options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
        value={period}
        onChange={(value) => void navigate({ to: '/pengeluaran', search: { period: value } })}
      />
      <Card variant="outlined" padding="medium">
        <p className="text-sm text-default-secondary">Total pengeluaran {periodNoun(period)}</p>
        <p className="text-3xl font-bold text-default-primary">{rupiah(list.summary.expenses)}</p>
        {!seesAll && <p className="mt-1 text-sm text-default-secondary">Hanya pengeluaran yang Anda catat sendiri.</p>}
        {list.summary.supplierPayments > 0 && (
          <p className="mt-1 text-sm text-default-secondary">
            Bayar pemasok {rupiah(list.summary.supplierPayments)} dicatat terpisah, tidak dihitung di total ini.
          </p>
        )}
      </Card>
      {groups.length === 0 ? (
        <Panel>
          <Empty
            title="Belum ada pengeluaran"
            action={
              <Button type="outline" color="primary" size="small" width="auto" onClick={() => void navigate({ to: '/pengeluaran/baru' })}>
                + Catat pengeluaran
              </Button>
            }
          >
            Catat biaya pertama supaya untung bersih akurat.
          </Empty>
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.date} aria-label={dayLabel(g.date)} className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-default-secondary">{dayLabel(g.date)}</h2>
              <Panel>
                <ul className="divide-y divide-default-primary">
                  {g.rows.map((r) => (
                    <li key={r.id}>
                      <Link
                        to="/pengeluaran/$id"
                        params={{ id: r.id }}
                        className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-weak-brand"
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold text-default-primary">{r.categoryLabel}</span>
                          <span className="block text-sm text-default-secondary">
                            {sourceLabel(r.source)} · {timeLabel(r.createdAt, timeZone)}
                            {r.note ? ` · ${r.note}` : ''}
                          </span>
                          {r.voidedAt && <Badge color="light">Dibatalkan</Badge>}
                        </span>
                        <span
                          className={`whitespace-nowrap font-semibold ${r.voidedAt ? 'text-default-secondary line-through' : 'text-default-error'}`}
                        >
                          {rupiah(-r.amount)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            </section>
          ))}
          {list.total > list.data.length && (
            <p className="text-center text-sm text-default-secondary">
              Menampilkan {list.data.length} catatan terbaru dari {list.total}. Total di atas mencakup semuanya.
            </p>
          )}
        </div>
      )}
    </Page>
  )
}
