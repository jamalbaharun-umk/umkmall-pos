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
} from '@umkmall/ui'
import { loadReceivables } from '../pelanggan/-api'
import { Empty, formatDate, LoadError, Page, Pending, rupiah } from '../pelanggan/-ui'

type Status = 'open' | 'settled' | undefined

// Lakasir ReceivableResource list: member, sale, total, rest, due date, last payment, status.
export const Route = createFileRoute('/piutang/')({
  validateSearch: (s: Record<string, unknown>): { status?: 'open' | 'settled' } => ({
    status: s.status === 'open' || s.status === 'settled' ? s.status : undefined,
  }),
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: ({ deps }) => loadReceivables({ data: deps.status }),
  pendingComponent: Pending,
  errorComponent: LoadError,
  component: ReceivablesPage,
})

function ReceivablesPage() {
  const rows = Route.useLoaderData()
  const { status } = Route.useSearch()
  const navigate = useNavigate({ from: '/piutang/' })
  return (
    <Page title="Piutang" crumbs={[{ label: 'Piutang' }, { label: 'Daftar' }]}>
      {/* Lakasir's StatsReceivable: what members still owe, over the rows shown. */}
      <Card variant="outlined" padding="large" className="flex flex-wrap gap-8">
        <div>
          <p className="text-sm text-default-secondary">Sisa piutang belum lunas</p>
          <p className="text-2xl font-bold text-default-primary">
            {rupiah(rows.reduce((n, r) => n + r.rest, 0))}
          </p>
        </div>
        <div>
          <p className="text-sm text-default-secondary">Belum lunas</p>
          <p className="text-2xl font-bold text-default-primary">{rows.filter((r) => r.rest > 0).length}</p>
        </div>
      </Card>
      <Card variant="outlined" padding="none" className="overflow-hidden">
        <div className="border-b border-default-primary p-4">
          <Tabs
            value={status ?? 'all'}
            onValueChange={(v) => void navigate({ search: { status: v === 'all' ? undefined : (v as Status) } })}
            size="xsmall"
          >
            <TabsList label="Status">
              <TabsTrigger value="all">Semua</TabsTrigger>
              <TabsTrigger value="open">Belum lunas</TabsTrigger>
              <TabsTrigger value="settled">Lunas</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {rows.length >= 200 && (
          <p className="border-b border-default-primary px-4 py-2 text-sm text-default-secondary">
            Menampilkan 200 piutang terbaru. Pilih filter status untuk mempersempit.
          </p>
        )}
        {rows.length === 0 ? (
          <Empty title="Belum ada piutang">Penjualan dengan metode kasbon akan muncul di sini.</Empty>
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
                  <TableCell>{formatDate(r.dueDate)}</TableCell>
                  <TableCell>{r.lastPaymentAt ? formatDate(r.lastPaymentAt) : '–'}</TableCell>
                  <TableCell>
                    {r.rest === 0 ? <Badge color="success">Lunas</Badge> : <Badge color="warning">Belum lunas</Badge>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Link to="/piutang/$id" params={{ id: r.id }} className="font-medium text-brand-primary hover:underline">
                      {r.rest > 0 ? 'Bayar' : 'Lihat'}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </Page>
  )
}
