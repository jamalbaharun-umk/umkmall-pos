import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Alert, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Text } from '@umkmall/ui'
import { act, formatDate, LoadError, Page, Pending, useConfirm } from '@/components/pos-page'
import { useCan } from '@/components/shell'
import { loadOpname, opnameAction } from '../pembelian/-api'
import { StatusBadge } from '../pembelian/-ui'

// Lakasir's View stock opname: details, items with system / counted / difference, and approve.
export const Route = createFileRoute('/stok-opname/$id')({
  loader: ({ params }) => loadOpname({ data: params.id }),
  component: OpnamePage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

function OpnamePage() {
  const opname = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const { ask, dialog } = useConfirm()
  const canManage = useCan('purchasing.manage')

  const run = (action: 'approve' | 'delete') =>
    ask(
      action === 'approve' ? 'Setujui opname?' : 'Hapus draf?',
      async () => {
        const r = await act(
          () => opnameAction({ data: { id: opname.id, action } }),
          action === 'approve' ? 'Opname disetujui, stok disesuaikan' : 'Draf opname dihapus',
          action === 'approve' ? 'menyetujui opname' : 'menghapus draf opname',
        )
        if (!r.ok) return
        if (action === 'delete') await navigate({ to: '/stok-opname' })
        else await router.invalidate()
      },
      action === 'approve'
        ? {
            body: 'Stok disesuaikan ke jumlah yang dihitung, terhadap stok saat ini. Opname tidak bisa diubah lagi.',
            label: 'Setujui',
          }
        : { body: 'Draf opname ini dihapus permanen.', label: 'Hapus' },
    )

  return (
    <Page
      crumbs={[{ label: 'Stok opname', to: '/stok-opname' }, { label: 'Detail' }]}
      title={`Stok opname ${formatDate(opname.createdAt)}`}
      actions={
        <>
          <Button width="auto" asChild type="outline" color="light">
            <Link to="/stok-opname">Kembali</Link>
          </Button>
          {opname.status === 'draft' && canManage && (
            <>
              <Button width="auto" type="ghost" color="danger" onClick={() => run('delete')}>
                Hapus draf
              </Button>
              <Button width="auto" onClick={() => run('approve')}>
                Setujui dan sesuaikan stok
              </Button>
            </>
          )}
        </>
      }
    >
      {opname.status === 'draft' && (
        <Alert variant="info" treatment="accent">
          Stok sistem di bawah adalah stok saat ini; penjualan setelah opname disimpan sudah terhitung.
        </Alert>
      )}
      <Card variant="outlined" padding="large">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="font-medium">Status</dt>
          <dd>
            <StatusBadge status={opname.status} />
          </dd>
          <dt className="font-medium">Tanggal</dt>
          <dd>{formatDate(opname.createdAt)}</dd>
          {opname.approvedAt && (
            <>
              <dt className="font-medium">Disetujui</dt>
              <dd>{formatDate(opname.approvedAt)}</dd>
            </>
          )}
          {opname.note && (
            <>
              <dt className="font-medium">Catatan</dt>
              <dd>{opname.note}</dd>
            </>
          )}
        </dl>
      </Card>
      <Card variant="outlined" padding="none">
        <Text as="h2" variant="h6" weight="bold" className="p-4">
          Item
        </Text>
        <Table density="comfortable">
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead>Alasan</TableHead>
              <TableHead className="text-right">Stok sistem</TableHead>
              <TableHead className="text-right">Dihitung</TableHead>
              <TableHead className="text-right">Selisih</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {opname.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">
                  {l.productName} <span className="text-default-secondary">({l.sku})</span>
                </TableCell>
                <TableCell>{l.reason ?? '–'}</TableCell>
                <TableCell className="text-right">{l.systemQty}</TableCell>
                <TableCell className="text-right">{l.countedQty}</TableCell>
                <TableCell
                  className={`text-right font-medium ${l.difference < 0 ? 'text-default-error' : l.difference > 0 ? 'text-default-success' : 'text-default-secondary'}`}
                >
                  {signed(l.difference)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {dialog}
    </Page>
  )
}
