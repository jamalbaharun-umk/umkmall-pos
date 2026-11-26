import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Text } from '@umkmall/ui'
import { useState } from 'react'
import { act, formatDate, LoadError, Page, Pending, rupiah, useConfirm } from '@/components/pos-page'
import { useCan } from '@/components/shell'
import { loadOrderPage, orderAction } from './-api'
import { dueText, historyRows, orderCode, type Payment, signedRupiah, statusBadge } from './-debt'
import { DueDateDialog, PayDialog, ReturnDialog, VoidPaymentDialog } from './-money-dialogs'
import { StatusBadge } from './-ui'

// Lakasir's View purchasing: details, stock lines and the status actions (approve raises stock), plus the debt to the
// supplier (UMK-1970, design feature 29): total, paid, remaining, the history, "Bayar pemasok" and "Retur barang".
export const Route = createFileRoute('/pembelian/$id')({
  loader: ({ params }) => loadOrderPage({ data: params.id }),
  component: OrderPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

const ASK = {
  approve: [
    'Setujui pembelian?',
    'Stok barang langsung bertambah dan pembelian tidak bisa diubah lagi, kecuali jatuh temponya.',
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

function Figure({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 md:flex-col md:items-start md:gap-1">
      <dt className="text-sm text-default-secondary">{label}</dt>
      <dd className={`${strong ? 'text-xl font-bold md:text-2xl' : 'text-base font-semibold md:text-xl'} text-default-primary`}>
        {rupiah(value)}
      </dd>
    </div>
  )
}

function OrderPage() {
  const { order, drawerCash } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const { ask, dialog } = useConfirm()
  const canManage = useCan('purchasing.manage')
  const [paying, setPaying] = useState(false)
  const [returning, setReturning] = useState(false)
  const [editingDue, setEditingDue] = useState(false)
  const [voiding, setVoiding] = useState<Payment | null>(null)
  const reload = () => router.invalidate()

  // Confirm first; the dialog keeps its button busy while the action runs and shows a refusal in place.
  const run = (action: keyof typeof ASK) => {
    const [title, body, label, done] = ASK[action]
    ask(
      title,
      async () => {
        const r = await act(() => orderAction({ data: { id: order.id, action } }), done, 'memproses pembelian')
        if (!r.ok) return
        if (action === 'delete') await navigate({ to: '/pembelian' })
        else await reload()
      },
      { body, label },
    )
  }

  const approved = order.status === 'approved'
  const seesMoney = order.total !== undefined && order.payments !== undefined
  const remaining = order.remaining ?? 0
  const payments = order.payments ?? []
  const returns = order.returns ?? []
  const history = seesMoney ? historyRows({ ...order, total: order.total ?? 0 }, payments, returns, rupiah) : []
  const due = dueText(order)
  const badge = statusBadge(order)
  const byId = new Map(payments.map((p) => [p.id, p]))

  return (
    <Page
      crumbs={[{ label: 'Pembelian', to: '/pembelian' }, { label: orderCode(order) }]}
      title={`${orderCode(order)} · ${order.supplierName}`}
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
              <Button width="auto" asChild type="outline" color="light">
                <Link to="/pembelian/$id/ubah" params={{ id: order.id }}>
                  Ubah
                </Link>
              </Button>
              <Button width="auto" type="outline" color="light" onClick={() => run('cancel')}>
                Batalkan
              </Button>
              <Button width="auto" onClick={() => run('approve')}>
                Setujui dan tambah stok
              </Button>
            </>
          )}
          {approved && canManage && seesMoney && (
            <>
              <Button width="auto" type="outline" color="light" onClick={() => setReturning(true)}>
                Retur barang
              </Button>
              {remaining > 0 && (
                <Button width="auto" onClick={() => setPaying(true)}>
                  Bayar pemasok
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="-mt-3 flex flex-wrap items-center gap-2 text-sm text-default-secondary">
        <Badge color={badge.tone} size="small">
          {badge.label}
        </Badge>
        <span>{order.supplierName}</span>
        <span aria-hidden>·</span>
        <span>{due ?? 'tanpa jatuh tempo'}</span>
        {(order.status === 'draft' || approved) && canManage && (
          <Button type="text" size="compact" width="auto" onClick={() => setEditingDue(true)}>
            Ubah jatuh tempo
          </Button>
        )}
      </div>

      {approved && seesMoney && (
        <Card variant="outlined" padding="large">
          <dl className="grid gap-3 md:grid-cols-3">
            <Figure label="Total" value={order.total ?? 0} />
            <Figure label="Dibayar" value={order.paid ?? 0} />
            <Figure label="Sisa hutang" value={remaining} strong />
          </dl>
          {((order.returned ?? 0) > 0 || (order.credit ?? 0) > 0) && (
            <p className="mt-3 text-sm text-default-secondary">
              {(order.returned ?? 0) > 0 && `Retur mengurangi hutang ${rupiah(order.returned ?? 0)}.`}
              {(order.credit ?? 0) > 0 &&
                ` ${rupiah(order.credit ?? 0)} kembali dari pemasok di luar sistem (dicatat sebagai catatan).`}
            </p>
          )}
          {remaining === 0 && (
            <p className="mt-3 text-sm text-default-secondary">
              Pembelian lunas tidak bisa dibayar lagi; retur tetap bisa dicatat.
            </p>
          )}
        </Card>
      )}

      {approved && seesMoney && (
        <Card variant="outlined" padding="none">
          <Text as="h2" variant="h6" weight="bold" className="p-4">
            Riwayat
          </Text>
          {/* Phone: one row per entry (design screen 2). */}
          <ul className="divide-y divide-default-primary border-t border-default-primary md:hidden">
            {history.map((h) => (
              <li key={h.key} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${h.voided ? 'line-through text-default-secondary' : 'text-default-primary'}`}>
                    {formatDate(h.at)} · {h.kind}
                  </p>
                  {h.detail && <p className="text-xs text-default-secondary">{h.detail}</p>}
                  {h.paymentId && !h.voided && canManage && (
                    <Button type="text" size="compact" width="auto" color="danger" onClick={() => setVoiding(byId.get(h.paymentId!) ?? null)}>
                      Batalkan
                    </Button>
                  )}
                </div>
                <p className={`shrink-0 text-sm font-semibold ${h.voided ? 'line-through text-default-secondary' : 'text-default-primary'}`}>
                  {signedRupiah(h.amount, rupiah, h.kind === 'Pembayaran dibatalkan')}
                </p>
              </li>
            ))}
          </ul>
          <div className="max-md:hidden">
            <Table density="comfortable">
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Keterangan</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.key} className={h.voided ? 'text-default-secondary line-through' : ''}>
                    <TableCell className="whitespace-nowrap">{formatDate(h.at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{h.kind}</TableCell>
                    <TableCell>{h.detail || '–'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {signedRupiah(h.amount, rupiah, h.kind === 'Pembayaran dibatalkan')}
                    </TableCell>
                    <TableCell className="text-right">
                      {h.paymentId && !h.voided && canManage && (
                        <Button type="text" size="compact" width="auto" color="danger" onClick={() => setVoiding(byId.get(h.paymentId!) ?? null)}>
                          Batalkan
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="border-t border-default-primary px-4 py-3 text-sm text-default-secondary">
            {payments.length === 0 && 'Pembayaran belum ada. '}
            {returns.length === 0 && 'Retur belum ada. '}
            Pembayaran dan retur tidak bisa diubah; pembayaran yang salah dibatalkan dengan catatan pembalik.
          </p>
        </Card>
      )}

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
              <TableHead className="max-sm:hidden">SKU</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
              {approved && <TableHead className="text-right">Diretur</TableHead>}
              <TableHead className="text-right max-sm:hidden">Harga beli</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.productName}</TableCell>
                <TableCell className="max-sm:hidden">{l.sku}</TableCell>
                <TableCell className="text-right">{l.qty}</TableCell>
                {approved && <TableCell className="text-right">{l.returnedQty}</TableCell>}
                <TableCell className="text-right max-sm:hidden">
                  {l.unitCost === undefined ? '–' : rupiah(l.unitCost)}
                </TableCell>
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
      {approved && seesMoney && (
        <>
          <PayDialog order={order} drawerCash={drawerCash} open={paying} onClose={() => setPaying(false)} onDone={reload} />
          <ReturnDialog order={order} open={returning} onClose={() => setReturning(false)} onDone={reload} />
          <VoidPaymentDialog orderId={order.id} payment={voiding} onClose={() => setVoiding(null)} onDone={reload} />
        </>
      )}
      <DueDateDialog order={order} open={editingDue} onClose={() => setEditingDue(false)} onDone={reload} />
    </Page>
  )
}
