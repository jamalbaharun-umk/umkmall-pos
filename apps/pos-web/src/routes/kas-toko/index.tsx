import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Alert, Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@umkmall/ui'
import { Empty, formatDate, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { ListFooter } from '../pelanggan/-ui'
import { storeKindLabel } from '../kasir/-shift-helpers'
import { CollectorsPanel, ReceiveDepositButton } from './-collectors'
import { storeLine, totalHeld } from './-deposit-helpers'
import { loadStoreCash } from './-api'

// The store's cash ("kas toko"): cash held outside every shift drawer, e.g. a kasbon instalment taken by staff
// without a shift. Read only; the balance is everything in minus everything out over the whole ledger.
export const Route = createFileRoute('/kas-toko/')({
  validateSearch: (s: Record<string, unknown>): { page?: number } => ({
    page: Number(s.page) > 1 ? Math.floor(Number(s.page)) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadStoreCash({ data: deps.page ?? 1 }),
  component: StoreCashPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function StoreCashPage() {
  const list = Route.useLoaderData()
  const navigate = useNavigate({ from: '/kas-toko/' })
  return (
    <Page
      title="Kas toko"
      crumbs={[{ label: 'Laporan' }, { label: 'Kas toko' }]}
      actions={
        <>
          <Button width="auto" type="outline" asChild>
            <Link to="/kas-toko/setoran">Riwayat setoran</Link>
          </Button>
          <ReceiveDepositButton collectors={list.collectors} />
        </>
      }
    >
      <Card variant="outlined" padding="large" className="flex flex-wrap gap-8">
        <div>
          <p className="text-sm text-default-secondary">Saldo kas toko</p>
          <p className="text-2xl font-bold text-default-primary">{rupiah(list.summary.balance)}</p>
        </div>
        <div>
          <p className="text-sm text-default-secondary">Total masuk</p>
          <p className="text-2xl font-bold text-default-primary">{rupiah(list.summary.cashIn)}</p>
        </div>
        <div>
          <p className="text-sm text-default-secondary">Total keluar</p>
          <p className="text-2xl font-bold text-default-primary">{rupiah(list.summary.cashOut)}</p>
        </div>
        <div>
          <p className="text-sm text-default-secondary">Dipegang penagih</p>
          <p className="text-2xl font-bold text-default-primary">{rupiah(totalHeld(list.collectors))}</p>
        </div>
      </Card>
      <Alert variant="info" size="small">
        Ini uang tunai yang dipegang di luar laci kasir, misalnya kasbon tunai dari staf tanpa shift. Uang itu dihitung
        dipegang penagih sampai setorannya diterima; saat setorannya diterima, uang itu keluar dari kas toko dan masuk ke laci shift penerima, jadi saldo kas toko berkurang sebesar setoran.
      </Alert>
      <CollectorsPanel collectors={list.collectors} />
      <Card variant="outlined" padding="none" className="overflow-hidden">
        {list.data.length === 0 ? (
          <Empty
            title="Belum ada kas toko"
            hint="Kasbon tunai yang dibayar di luar shift akan muncul di sini."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Dicatat oleh</TableHead>
                <TableHead>Catatan</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((e) => {
                const line = storeLine(e)
                return (
                <TableRow key={e.id}>
                  <TableCell>{formatDate(e.createdAt)}</TableCell>
                  <TableCell>{line.kind ?? storeKindLabel(e.kind)}</TableCell>
                  <TableCell>
                    <Badge color={line.color}>{line.label}</Badge>
                  </TableCell>
                  <TableCell>{e.actorName}</TableCell>
                  <TableCell>{e.note ?? '–'}</TableCell>
                  <TableCell className="text-right">{line.amount}</TableCell>
                </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {list.total > 0 && (
          <ListFooter
            page={list.page}
            perPage={list.perPage}
            total={list.total}
            shown={list.data.length}
            noun="catatan"
            onPage={(n) => void navigate({ search: { page: n > 1 ? n : undefined } })}
          />
        )}
      </Card>
    </Page>
  )
}
