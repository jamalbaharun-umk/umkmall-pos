import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@umkmall/ui'
import { Empty, formatDate, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { ListFooter } from '../pelanggan/-ui'
import { loadDeposits } from './-deposit-api'

// The audit of collector deposits (design feature 21): who handed cash over, who received it, how much and when.
// Read only: a deposit is recorded from the store cash page and is never edited.
export const Route = createFileRoute('/kas-toko/setoran')({
  validateSearch: (s: Record<string, unknown>): { page?: number } => ({
    page: Number(s.page) > 1 ? Math.floor(Number(s.page)) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadDeposits({ data: deps.page ?? 1 }),
  component: DepositsPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function DepositsPage() {
  const list = Route.useLoaderData()
  const navigate = useNavigate({ from: '/kas-toko/setoran' })
  return (
    <Page
      title="Riwayat setoran penagih"
      crumbs={[{ label: 'Laporan' }, { label: 'Kas toko', to: '/kas-toko' }, { label: 'Riwayat setoran' }]}
    >
      <Card variant="outlined" padding="none" className="overflow-hidden">
        {list.data.length === 0 ? (
          <Empty
            title="Belum ada setoran penagih"
            hint="Setoran yang diterima dari penagih akan muncul di sini, lengkap dengan siapa yang menyerahkan dan menerima."
          />
        ) : (
          <>
            <ul className="divide-y divide-default-primary md:hidden">
              {list.data.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-default-primary">
                      {d.collectorName} menyerahkan ke {d.receivedByName}
                    </p>
                    <p className="text-xs text-default-secondary">{formatDate(d.createdAt)}</p>
                    {d.note && <p className="text-sm text-default-secondary">{d.note}</p>}
                  </div>
                  <span className="font-semibold whitespace-nowrap text-default-success tabular-nums">
                    {rupiah(d.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Diserahkan oleh</TableHead>
                    <TableHead>Diterima oleh</TableHead>
                    <TableHead>Catatan</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                    <TableHead className="text-right">Masih dipegang</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{formatDate(d.createdAt)}</TableCell>
                      <TableCell>{d.collectorName}</TableCell>
                      <TableCell>{d.receivedByName}</TableCell>
                      <TableCell>{d.note ?? '–'}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(d.amount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(d.outstandingAfter)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        {list.total > 0 && (
          <ListFooter
            page={list.page}
            perPage={list.perPage}
            total={list.total}
            shown={list.data.length}
            noun="setoran"
            onPage={(n) => void navigate({ search: { page: n > 1 ? n : undefined } })}
          />
        )}
      </Card>
    </Page>
  )
}
