import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Text } from '@umkmall/ui'
import { useState } from 'react'
import { ErrorText, formatDate, LoadError, Page, Pending, rupiah, useConfirm } from '@/components/pos-page'
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
  approve: ['Setujui pembelian?', 'Stok barang langsung bertambah dan pembelian tidak bisa diubah lagi.', 'Setujui'],
  cancel: ['Batalkan pembelian?', 'Pembelian dibatalkan tanpa mengubah stok.', 'Batalkan pembelian'],
  delete: ['Hapus draf?', 'Draf pembelian ini dihapus permanen.', 'Hapus'],
} as const

function OrderPage() {
  const order = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const { confirm, dialog } = useConfirm()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function act(action: keyof typeof ASK) {
    const [title, body, label] = ASK[action]
    if (
      !(await confirm(title, body, {
        confirm: label,
        danger: action !== 'approve',
      }))
    )
      return
    setBusy(true)
    const r = await orderAction({ data: { id: order.id, action } }).catch(() => ({
      ok: false as const,
      error: 'Gagal, coba lagi.',
    }))
    setBusy(false)
    if (!r.ok) return setError(r.error)
    if (action === 'delete') return navigate({ to: '/pembelian' })
    setError(undefined)
    await router.invalidate()
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
          {order.status === 'draft' && (
            <>
              <Button width="auto" color="danger" type="ghost" disabled={busy} onClick={() => void act('delete')}>
                Hapus draf
              </Button>
              <Button width="auto" type="outline" color="light" disabled={busy} onClick={() => void act('cancel')}>
                Batalkan
              </Button>
              <Button width="auto" isLoading={busy} onClick={() => void act('approve')}>
                Setujui dan tambah stok
              </Button>
            </>
          )}
        </>
      }
    >
      <ErrorText>{error}</ErrorText>
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
                <TableCell className="text-right">{rupiah(l.unitCost)}</TableCell>
                <TableCell className="text-right">{rupiah(l.qty * l.unitCost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="flex justify-end gap-6 p-4 text-lg font-bold">
          <span>Total</span>
          <span>{rupiah(order.total)}</span>
        </p>
      </Card>
      {dialog}
    </Page>
  )
}
