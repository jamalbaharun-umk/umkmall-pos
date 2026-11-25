import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Alert, Badge, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@umkmall/ui'
import { Empty, formatDate, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { ListFooter } from '../pelanggan/-ui'
import { directionLabel, signedAmount, storeKindLabel } from '../kasir/-shift-helpers'
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
    <Page title="Kas toko" crumbs={[{ label: 'Laporan' }, { label: 'Kas toko' }]}>
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
      </Card>
      <Alert variant="info" size="small">
        Ini uang tunai yang dipegang di luar laci kasir, misalnya kasbon tunai dari staf tanpa shift. Saldo belum
        menunjukkan siapa yang memegang uangnya; penyerahan ke pemilik atau laci belum bisa dicatat di sini.
      </Alert>
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
              {list.data.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{formatDate(e.createdAt)}</TableCell>
                  <TableCell>{storeKindLabel(e.kind)}</TableCell>
                  <TableCell>
                    <Badge color={e.direction === 'in' ? 'success' : 'warning'}>{directionLabel(e.direction)}</Badge>
                  </TableCell>
                  <TableCell>{e.actorName}</TableCell>
                  <TableCell>{e.note ?? '–'}</TableCell>
                  <TableCell className="text-right">{signedAmount(e, rupiah)}</TableCell>
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
            shown={list.data.length}
            noun="catatan"
            onPage={(n) => void navigate({ search: { page: n > 1 ? n : undefined } })}
          />
        )}
      </Card>
    </Page>
  )
}
