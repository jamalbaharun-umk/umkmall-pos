import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  Badge,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  TextField,
} from '@umkmall/ui'
import { useState } from 'react'
import { loadReceivables } from '../pelanggan/-api'
import { Empty, formatDay, formatMomentDay, ListFooter, LoadError, Page, Pending, rupiah } from '../pelanggan/-ui'

type Status = 'open' | 'settled' | undefined

// Lakasir ReceivableResource list: member, sale, total, rest, due date, last payment, status.
export const Route = createFileRoute('/piutang/')({
  validateSearch: (s: Record<string, unknown>): { status?: 'open' | 'settled'; q?: string; page?: number } => ({
    status: s.status === 'open' || s.status === 'settled' ? s.status : undefined,
    // The router JSON-parses search values, so ?q=12 arrives as a number.
    q: s.q == null || s.q === '' ? undefined : String(s.q),
    page: Number(s.page) >= 1 ? Math.floor(Number(s.page)) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadReceivables({ data: deps }),
  pendingComponent: Pending,
  errorComponent: LoadError,
  component: ReceivablesPage,
})

function ReceivablesPage() {
  const list = Route.useLoaderData()
  const rows = list.data
  const { status, q } = Route.useSearch()
  const navigate = useNavigate({ from: '/piutang/' })
  const [query, setQuery] = useState(q ?? '')
  return (
    <Page title="Piutang" crumbs={[{ label: 'Piutang' }, { label: 'Daftar' }]}>
      {/* Lakasir's StatsReceivable: what members still owe, over the search (any page, any tab). */}
      <Card variant="outlined" padding="large" className="flex flex-wrap gap-8">
        <div>
          <p className="text-sm text-default-secondary">Sisa piutang belum lunas</p>
          <p className="text-2xl font-bold text-default-primary">{rupiah(list.summary.openRest)}</p>
        </div>
        <div>
          <p className="text-sm text-default-secondary">Belum lunas</p>
          <p className="text-2xl font-bold text-default-primary">{list.summary.openCount}</p>
        </div>
        {list.summary.outsideShiftCollected > 0 && (
          <div>
            <p className="text-sm text-default-secondary">Tunai dikumpulkan di luar shift</p>
            <p className="text-2xl font-bold text-default-primary">{rupiah(list.summary.outsideShiftCollected)}</p>
            <p className="text-xs text-default-secondary">Masuk kas toko, bukan laci shift mana pun.</p>
          </div>
        )}
      </Card>
      <Card variant="outlined" padding="none" className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-default-primary p-4 md:flex-row md:items-center md:justify-between">
          <div className="md:min-w-96">
            <Tabs
              value={status ?? 'all'}
              onValueChange={(v) =>
                void navigate({
                  search: (s) => ({ ...s, status: v === 'all' ? undefined : (v as Status), page: undefined }),
                })
              }
              size="xsmall"
            >
              <TabsList label="Status">
                <TabsTrigger value="all">Semua</TabsTrigger>
                <TabsTrigger value="open">Belum lunas</TabsTrigger>
                <TabsTrigger value="settled">Lunas</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <form
            className="md:w-72"
            onSubmit={(e) => {
              e.preventDefault()
              void navigate({ search: (s) => ({ ...s, q: query.trim() || undefined, page: undefined }) })
            }}
          >
            <TextField
              aria-label="Cari piutang"
              placeholder="Cari pelanggan atau no. penjualan"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              size="small"
            />
          </form>
        </div>
        {rows.length === 0 ? (
          <Empty title={q || status ? 'Tidak ada piutang yang cocok' : 'Belum ada piutang'}>
            {q || status ? 'Ubah pencarian atau filter status.' : 'Penjualan dengan metode kasbon akan muncul di sini.'}
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pelanggan</TableHead>
                <TableHead>Penjualan</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Sisa</TableHead>
                <TableHead>Jatuh tempo</TableHead>
                <TableHead>Bayar terakhir</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      to="/piutang/$id"
                      params={{ id: r.id }}
                      className="font-medium text-brand-primary hover:underline"
                    >
                      {r.memberName}
                    </Link>
                  </TableCell>
                  <TableCell>#{r.saleNumber}</TableCell>
                  <TableCell className="text-right">{rupiah(r.total)}</TableCell>
                  <TableCell className="text-right">{rupiah(r.rest)}</TableCell>
                  <TableCell>{formatDay(r.dueDate)}</TableCell>
                  <TableCell>
                    {r.lastPaymentAt ? formatMomentDay(r.lastPaymentAt) : '–'}
                    {r.outsideShiftCollected > 0 && (
                      <div className="text-xs text-default-secondary">
                        {rupiah(r.outsideShiftCollected)} dikumpulkan di luar shift
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.rest === 0 ? <Badge color="success">Lunas</Badge> : <Badge color="warning">Belum lunas</Badge>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Link
                      to="/piutang/$id"
                      params={{ id: r.id }}
                      className="font-medium text-brand-primary hover:underline"
                    >
                      {r.rest > 0 ? 'Bayar' : 'Lihat'}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {list.total > 0 && (
          <ListFooter
            page={list.page}
            perPage={list.perPage}
            total={list.total}
            shown={rows.length}
            noun="piutang"
            onPage={(n) => void navigate({ search: (s) => ({ ...s, page: n > 1 ? n : undefined }) })}
          />
        )}
      </Card>
    </Page>
  )
}
