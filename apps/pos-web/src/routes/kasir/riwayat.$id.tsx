import { createFileRoute, Link } from '@tanstack/react-router'
import { Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Text } from '@umkmall/ui'
import { formatDate, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { loadReceipt } from './-api'

// Lakasir's "View selling": selling details, product table, totals, and the print-receipt action.
export const Route = createFileRoute('/kasir/riwayat/$id')({
  loader: ({ params }) => loadReceipt({ data: params.id }),
  component: SalePage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function SalePage() {
  const r = Route.useLoaderData()
  const { id } = Route.useParams()
  return (
    <Page
      crumbs={[{ label: 'Riwayat penjualan', to: '/kasir/riwayat' }, { label: 'Detail' }]}
      title={`Penjualan #${r.number}`}
      actions={
        <>
          <Button width="auto" asChild type="outline" color="light">
            <Link to="/kasir/riwayat">Kembali</Link>
          </Button>
          <Button width="auto" asChild>
            <Link to="/kasir/struk/$id" params={{ id }}>
              Cetak struk
            </Link>
          </Button>
        </>
      }
    >
      <Card variant="outlined" padding="large" className="space-y-6">
        <section>
          <Text as="h2" variant="h5" weight="bold">
            Rincian penjualan
          </Text>
          <dl className="mt-3 grid max-w-md grid-cols-2 gap-y-1 text-sm">
            <dt className="font-medium">Kode</dt>
            <dd className="text-right">#{r.number}</dd>
            <dt className="font-medium">Kasir</dt>
            <dd className="text-right">{r.cashier}</dd>
            <dt className="font-medium">Tanggal</dt>
            <dd className="text-right">{formatDate(r.createdAt)}</dd>
            <dt className="font-medium">Metode pembayaran</dt>
            <dd className="text-right">{r.paymentMethod}</dd>
            {r.note && (
              <>
                <dt className="font-medium">Catatan</dt>
                <dd className="text-right">{r.note}</dd>
              </>
            )}
          </dl>
        </section>
        <Table density="comfortable">
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead className="text-right">Harga satuan</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
              <TableHead className="text-right">Total harga</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell>{l.name}</TableCell>
                <TableCell className="text-right">{rupiah(l.unitPrice)}</TableCell>
                <TableCell className="text-right">{l.qty}</TableCell>
                <TableCell className="text-right">{rupiah(l.lineTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <dl className="ml-auto grid max-w-sm grid-cols-2 gap-y-2 text-sm">
          <dt className="font-medium">Subtotal</dt>
          <dd className="text-right">{rupiah(r.subtotal)}</dd>
          <dt className="font-medium">Diskon</dt>
          <dd className="text-right">{rupiah(r.discount)}</dd>
          <dt className="font-medium">Pajak</dt>
          <dd className="text-right">{r.taxBps / 100}%</dd>
          <dt className="font-medium">Nilai pajak</dt>
          <dd className="text-right">{rupiah(r.tax)}</dd>
          <dt className="font-bold">Total</dt>
          <dd className="text-right font-bold">{rupiah(r.total)}</dd>
          <dt className="font-medium">Uang dibayar</dt>
          <dd className="text-right">{rupiah(r.paid)}</dd>
          <dt className="font-medium">Kembalian</dt>
          <dd className="text-right">{rupiah(r.change)}</dd>
        </dl>
      </Card>
    </Page>
  )
}
