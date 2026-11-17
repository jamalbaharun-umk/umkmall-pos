import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Text } from '@umkmall/ui'
import { useState } from 'react'
import { ErrorText, formatDate, LoadError, Page, Pending, useConfirm } from '@/components/pos-page'
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
  const { confirm, dialog } = useConfirm()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function act(action: 'approve' | 'delete') {
    const ok =
      action === 'approve'
        ? await confirm('Setujui opname?', 'Stok disesuaikan sebesar selisihnya dan opname tidak bisa diubah lagi.', {
            confirm: 'Setujui',
          })
        : await confirm('Hapus draf?', 'Draf opname ini dihapus permanen.', {
            confirm: 'Hapus',
            danger: true,
          })
    if (!ok) return
    setBusy(true)
    const r = await opnameAction({ data: { id: opname.id, action } }).catch(() => ({
      ok: false as const,
      error: 'Gagal, coba lagi.',
    }))
    setBusy(false)
    if (!r.ok) return setError(r.error)
    if (action === 'delete') return navigate({ to: '/stok-opname' })
    setError(undefined)
    await router.invalidate()
  }

  return (
    <Page
      crumbs={[{ label: 'Stok opname', to: '/stok-opname' }, { label: 'Detail' }]}
      title={`Stok opname ${formatDate(opname.createdAt)}`}
      actions={
        <>
          <Button width="auto" asChild type="outline" color="light">
            <Link to="/stok-opname">Kembali</Link>
          </Button>
          {opname.status === 'draft' && (
            <>
              <Button width="auto" type="ghost" color="danger" disabled={busy} onClick={() => void act('delete')}>
                Hapus draf
              </Button>
              <Button width="auto" isLoading={busy} onClick={() => void act('approve')}>
                Setujui dan sesuaikan stok
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
