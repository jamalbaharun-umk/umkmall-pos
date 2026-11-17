import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Text } from '@umkmall/ui'
import { act, formatDate, LoadError, Page, Pending, rupiah, useConfirm } from '@/components/pos-page'
import { useCan } from '@/components/shell'
import { loadOrder, orderAction } from './-api'
import { StatusBadge } from './-ui'

// Lakasir's View purchasing: details, stock lines, and the status actions (approve raises stock).
export const Route = createFileRoute('/pembelian/$id')({
  loader: ({ params }) => loadOrder({ data: params.id }),
  component: OrderPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

const ASK = {
  approve: [
    'Setujui pembelian?',
    'Stok barang langsung bertambah dan pembelian tidak bisa diubah lagi.',
    'Setujui',
    'Pembelian disetujui, stok bertambah',
  ],
  cancel: [
    'Batalkan pembelian?',
    'Pembelian dibatalkan tanpa mengubah stok.',
    'Batalkan pembelian',
    'Pembelian dibatalkan',
  ],
  delete: ['Hapus draf?', 'Draf pembelian ini dihapus permanen.', 'Hapus', 'Draf pembelian dihapus'],
} as const

function OrderPage() {
  const order = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const { ask, dialog } = useConfirm()
  const canManage = useCan('purchasing.manage')

  // Confirm first; the dialog keeps its button busy while the action runs and shows a refusal in place.
  const run = (action: keyof typeof ASK) => {
    const [title, body, label, done] = ASK[action]
    ask(
      title,
      async () => {
        const r = await act(() => orderAction({ data: { id: order.id, action } }), done)
        if (!r.ok) return r.error
        if (action === 'delete') await navigate({ to: '/pembelian' })
        else await router.invalidate()
      },
      { body, label },
    )
  }

  return (
    <Page
      crumbs={[{ label: 'Pembelian', to: '/pembelian' }, { label: 'Detail' }]}
      title={`Pembelian dari ${order.supplierName}`}
      actions={
        <>
          <Button width="auto" asChild type="outline" color="light">
            <Link to="/pembelian">Kembali</Link>
          </Button>
          {order.status === 'draft' && canManage && (
            <>
              <Button width="auto" color="danger" type="ghost" onClick={() => run('delete')}>
                Hapus draf
              </Button>
              <Button width="auto" type="outline" color="light" onClick={() => run('cancel')}>
                Batalkan
              </Button>
              <Button width="auto" onClick={() => run('approve')}>
                Setujui dan tambah stok
              </Button>
            </>
          )}
        </>
      }
    >
      <Card variant="outlined" padding="large">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="font-medium">Status</dt>
          <dd>
            <StatusBadge status={order.status} />
          </dd>
          <dt className="font-medium">Pemasok</dt>
          <dd>{order.supplierName}</dd>
          <dt className="font-medium">Tanggal</dt>
          <dd>{formatDate(order.createdAt)}</dd>
          <dt className="font-medium">Metode pembayaran</dt>
          <dd>{order.paymentMethod ?? '–'}</dd>
          {order.approvedAt && (
            <>
              <dt className="font-medium">Disetujui</dt>
              <dd>{formatDate(order.approvedAt)}</dd>
            </>
          )}
          {order.note && (
            <>
              <dt className="font-medium">Catatan</dt>
              <dd>{order.note}</dd>
            </>
          )}
        </dl>
      </Card>
      <Card variant="outlined" padding="none">
        <Text as="h2" variant="h6" weight="bold" className="p-4">
          Stok
        </Text>
        <Table density="comfortable">
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
              <TableHead className="text-right">Harga beli</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.productName}</TableCell>
                <TableCell>{l.sku}</TableCell>
                <TableCell className="text-right">{l.qty}</TableCell>
                <TableCell className="text-right">{l.unitCost === undefined ? '–' : rupiah(l.unitCost)}</TableCell>
                <TableCell className="text-right">
                  {l.unitCost === undefined ? '–' : rupiah(l.qty * l.unitCost)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="flex justify-end gap-6 p-4 text-lg font-bold">
          <span>Total</span>
          <span>{order.total === undefined ? '–' : rupiah(order.total)}</span>
        </p>
      </Card>
      {dialog}
    </Page>
  )
}
