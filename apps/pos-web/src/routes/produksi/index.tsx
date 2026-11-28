import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Badge, BarChart, Button, Pagination, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TextField } from '@umkmall/ui'
import { useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { Panel } from '@/components/page'
import { Empty, LoadError, Page, Pending } from '@/components/pos-page'
import { loadRuns } from './-api'
import { dayText, differenceText, parseListSearch, PER_PAGE, quantityText, rangeError, signedText, yieldBars, type RunSummary } from './-run'

// UMK-2132, design 45 (screen 3): the production runs, newest first, with a date filter and the way to a new one.
export const Route = createFileRoute('/produksi/')({
  validateSearch: parseListSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadRuns({ data: deps }),
  component: RunsPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function Difference({ r }: { r: RunSummary }) {
  if (r.yieldDifference === 0) return <span className="text-default-secondary">0</span>
  return (
    <Badge color={r.yieldDifference < 0 ? 'warning' : 'success'} size="small">
      {signedText(r.yieldDifference)}
    </Badge>
  )
}

function RunsPage() {
  const { data, total } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/produksi/' })
  const [from, setFrom] = useState(search.from ?? '')
  const [to, setTo] = useState(search.to ?? '')
  const [rangeText, setRangeText] = useState<string>()
  const filtered = !!(search.from || search.to)
  const open = (id: string) => void navigate({ to: '/produksi/$id', params: { id } })
  const newButton = (
    <Button width="auto" asChild>
      <Link to="/produksi/baru">Produksi baru</Link>
    </Button>
  )
  const bars = yieldBars(data)

  return (
    <Page crumbs={[{ label: 'Produksi', to: '/produksi' }, { label: 'Riwayat' }]} title="Produksi" actions={newButton}>
      {data.length > 0 && (
        <BarChart
          boxed
          title="Rencana dan hasil nyata"
          description="Hasil rencana dan hasil sebenarnya dari produksi di halaman ini, yang terbaru di atas."
          unit="count"
          orientation="horizontal"
          categories={bars.categories}
          series={bars.series}
        />
      )}
      <Panel>
        <form
          className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end"
          noValidate
          data-guide="produksi-filter"
          onSubmit={(e) => {
            e.preventDefault()
            const err = rangeError(from, to)
            setRangeText(err)
            if (err) return
            void navigate({ search: { from: from || undefined, to: to || undefined } })
          }}
        >
          <div className="w-full sm:w-44">
            <TextField label="Dari tanggal" type="date" size="small" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="w-full sm:w-44">
            <TextField label="Sampai tanggal" type="date" size="small" value={to} onChange={(e) => setTo(e.target.value)} error={rangeText} />
          </div>
          <ActionRow align="start" className="sm:w-auto">
            <Button width="auto" htmlType="submit" size="small">
              Terapkan
            </Button>
            {filtered && (
              <Button
                width="auto"
                size="small"
                type="text"
                onClick={() => {
                  setFrom('')
                  setTo('')
                  setRangeText(undefined)
                  void navigate({ search: {} })
                }}
              >
                Atur ulang
              </Button>
            )}
          </ActionRow>
        </form>
        {data.length === 0 ? (
          <Empty
            title={filtered ? 'Tidak ada produksi di periode ini' : 'Belum ada produksi'}
            hint={filtered ? 'Ubah tanggal filter.' : 'Catat produksi pertama: bahan keluar dari stok dan barang jadi masuk stok.'}
            action={filtered ? undefined : newButton}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table density="comfortable">
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-right">Batch</TableHead>
                    <TableHead className="text-right">Rencana</TableHead>
                    <TableHead className="text-right">Nyata</TableHead>
                    <TableHead className="text-right">Selisih</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => open(r.id)}>
                      <TableCell className="whitespace-nowrap">{dayText(r.date)}</TableCell>
                      <TableCell className="font-medium">
                        <Link to="/produksi/$id" params={{ id: r.id }} className="hover:underline">
                          {r.productName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">{r.batches.toLocaleString('id-ID')}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{quantityText(r.plannedYield, r.yieldUnit)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{quantityText(r.actualYield, r.yieldUnit)}</TableCell>
                      <TableCell className="text-right">
                        <Difference r={r} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-default-secondary md:hidden">
              {data.map((r) => (
                <li key={r.id}>
                  <Link to="/produksi/$id" params={{ id: r.id }} className="flex flex-col gap-1 px-4 py-3">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-default-primary">{r.productName}</span>
                      <span className="font-semibold whitespace-nowrap">{quantityText(r.actualYield, r.yieldUnit)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-default-secondary">
                      {dayText(r.date)} · rencana {r.plannedYield.toLocaleString('id-ID')} · {differenceText(r.yieldDifference, r.yieldUnit)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination
              className="p-4"
              page={search.page ?? 1}
              pageCount={Math.max(1, Math.ceil(total / PER_PAGE))}
              onPageChange={(page) => void navigate({ search: (s) => ({ ...s, page: page > 1 ? page : undefined }) })}
              summary={`Menampilkan ${data.length} dari ${total} produksi`}
            />
          </>
        )}
      </Panel>
    </Page>
  )
}
