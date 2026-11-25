import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Badge, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@umkmall/ui'
import { Empty, formatDate, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { ListFooter } from '../../pelanggan/-ui'
import { loadShifts } from '../-shift-api'

const PER_PAGE = 20

// Shift history: opening cash, cash sales, cash in/out and the count difference per shift. A cashier sees their own
// shifts, `reports.view` the store's (pos-api scopes the list).
export const Route = createFileRoute('/kasir/shift/')({
  validateSearch: (s: Record<string, unknown>): { page?: number } => ({
    page: Number(s.page) > 1 ? Math.floor(Number(s.page)) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadShifts({ data: deps.page ?? 1 }),
  component: ShiftsPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function ShiftsPage() {
  const { data, total } = Route.useLoaderData()
  const { page = 1 } = Route.useSearch()
  const navigate = useNavigate({ from: '/kasir/shift/' })
  return (
    <Page title="Riwayat shift" crumbs={[{ label: 'Kasir', to: '/kasir' }, { label: 'Riwayat shift' }]}>
      <Card variant="outlined" padding="none" className="overflow-hidden">
        {data.length === 0 ? (
          <Empty title="Belum ada shift" hint="Shift muncul di sini setelah dibuka dari layar Kasir." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dibuka</TableHead>
                <TableHead>Kasir</TableHead>
                <TableHead className="text-right">Uang awal</TableHead>
                <TableHead className="text-right">Kas masuk</TableHead>
                <TableHead className="text-right">Kas keluar</TableHead>
                <TableHead className="text-right">Seharusnya</TableHead>
                <TableHead>Selisih</TableHead>
                <TableHead>
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{formatDate(s.openedAt)}</TableCell>
                  <TableCell>{s.actorKind === 'owner' ? 'Pemilik' : 'Staf'}</TableCell>
                  <TableCell className="text-right">{rupiah(s.openingCash)}</TableCell>
                  <TableCell className="text-right">{rupiah(s.cashIn)}</TableCell>
                  <TableCell className="text-right">{rupiah(s.cashOut)}</TableCell>
                  <TableCell className="text-right">{s.expectedCash === null ? '–' : rupiah(s.expectedCash)}</TableCell>
                  <TableCell>
                    {s.closedAt === null ? (
                      <Badge color="success">Masih buka</Badge>
                    ) : s.difference === 0 ? (
                      <Badge color="success">Pas</Badge>
                    ) : (
                      <Badge color="warning">
                        {(s.difference ?? 0) < 0 ? 'Kurang' : 'Lebih'} {rupiah(Math.abs(s.difference ?? 0))}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      to="/kasir/shift/$id"
                      params={{ id: s.id }}
                      className="font-medium text-brand-primary hover:underline"
                    >
                      Lihat
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {total > 0 && (
          <ListFooter
            page={page}
            perPage={PER_PAGE}
            total={total}
            shown={data.length}
            noun="shift"
            onPage={(n) => void navigate({ search: { page: n > 1 ? n : undefined } })}
          />
        )}
      </Card>
    </Page>
  )
}
