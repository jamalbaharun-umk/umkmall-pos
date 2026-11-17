import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Button,
  Card,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  TextField,
} from '@umkmall/ui'
import { useState } from 'react'
import { Empty, formatDate, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { loadHistory } from './-api'

const PER_PAGE = 20
const DAY = /^\d{4}-\d{2}-\d{2}$/
type Search = { page?: number; from?: string; to?: string }

// shortcut: store days are WIB (+07:00) until stores keep a timezone setting (U5 reports adds one).
const startOf = (day: string) => `${day}T00:00:00+07:00`
const endOf = (day: string) => new Date(new Date(startOf(day)).getTime() + 86_400_000).toISOString()

// Lakasir's Selling Histories: overview cards, then the table (code, cashier, date, totals, cost) with a date filter.
export const Route = createFileRoute('/kasir/riwayat/')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    page: Number(s.page) > 1 ? Math.floor(Number(s.page)) : undefined,
    from: typeof s.from === 'string' && DAY.test(s.from) ? s.from : undefined,
    to: typeof s.to === 'string' && DAY.test(s.to) ? s.to : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    loadHistory({
      data: {
        page: deps.page ?? 1,
        from: deps.from && startOf(deps.from),
        to: deps.to && endOf(deps.to),
      },
    }),
  component: HistoryPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function HistoryPage() {
  const { data, total, summary } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/kasir/riwayat/' })
  const [from, setFrom] = useState(search.from ?? '')
  const [to, setTo] = useState(search.to ?? '')
  const [rangeError, setRangeError] = useState<string>()
  const showCost = data.some((s) => s.costTotal !== undefined)
  const filtered = !!(search.from || search.to)
  const period = filtered ? 'periode ini' : 'semua waktu'

  return (
    <Page
      crumbs={[{ label: 'Riwayat penjualan', to: '/kasir/riwayat' }, { label: 'Daftar' }]}
      title="Riwayat penjualan"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={`Pendapatan (${period})`} value={rupiah(summary.revenue)} />
        <Stat label={`Jumlah penjualan (${period})`} value={String(summary.count)} />
        <Stat label={`Diskon (${period})`} value={rupiah(summary.discount)} />
      </div>
      <Card padding="none" variant="outlined">
        <form
          className="flex flex-wrap items-end gap-3 p-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (from && to && to < from) return setRangeError('Harus sama atau setelah tanggal awal')
            setRangeError(undefined)
            void navigate({
              search: { from: from || undefined, to: to || undefined },
            })
          }}
        >
          <div className="w-44">
            <TextField
              label="Dari tanggal"
              type="date"
              size="small"
              value={from}

              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="w-44">
            <TextField
              label="Sampai tanggal"
              type="date"
              size="small"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              error={rangeError}
            />
          </div>
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
                void navigate({ search: {} })
              }}
            >
              Atur ulang
            </Button>
          )}
        </form>
        {data.length === 0 ? (
          <Empty
            title={filtered ? 'Tidak ada penjualan di periode ini' : 'Belum ada penjualan'}
            hint={filtered ? 'Ubah tanggal filter.' : 'Penjualan yang selesai di kasir akan muncul di sini.'}
          />
        ) : (
          <>
            <Table density="comfortable">
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Kasir</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead className="text-right">Total akhir</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="text-right">Diskon</TableHead>
                  <TableHead className="text-right">Pajak</TableHead>
                  {showCost && <TableHead className="text-right">Total modal</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((s) => (
                  <TableRow
                    key={s.id}
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() =>
                      void navigate({
                        to: '/kasir/riwayat/$id',
                        params: { id: s.id },
                      })
                    }
                    onKeyDown={(e) =>
                      e.key === 'Enter' &&
                      void navigate({
                        to: '/kasir/riwayat/$id',
                        params: { id: s.id },
                      })
                    }
                  >
                    <TableCell className="font-medium">#{s.number}</TableCell>
                    <TableCell>{s.cashier}</TableCell>
                    <TableCell>{formatDate(s.createdAt)}</TableCell>
                    <TableCell className="text-right">{rupiah(s.total)}</TableCell>
                    <TableCell className="text-right">{rupiah(s.subtotal)}</TableCell>
                    <TableCell className="text-right">{rupiah(s.discount)}</TableCell>
                    <TableCell className="text-right">{rupiah(s.tax)}</TableCell>
                    {showCost && <TableCell className="text-right">{rupiah(s.costTotal ?? 0)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              className="p-4"
              page={search.page ?? 1}
              pageCount={Math.max(1, Math.ceil(total / PER_PAGE))}
              onPageChange={(page) =>
                void navigate({
                  search: (s) => ({ ...s, page: page > 1 ? page : undefined }),
                })
              }
              summary={`Menampilkan ${data.length} dari ${total} penjualan`}
            />
          </>
        )}
      </Card>
    </Page>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="outlined" padding="medium">
      <p className="text-sm text-default-secondary">{label}</p>
      <Text variant="h4" weight="bold">
        {value}
      </Text>
    </Card>
  )
}
