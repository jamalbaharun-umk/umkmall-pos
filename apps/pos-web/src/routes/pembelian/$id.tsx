import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { loadOrder, orderAction } from './-api'
import { Button, Card, ErrorText, formatDate, LoadError, Pending, rupiah, StatusBadge, StockLayout } from './-ui'

export const Route = createFileRoute('/pembelian/$id')({
  loader: ({ params }) => loadOrder({ data: params.id }),
  component: OrderPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

const CONFIRM = {
  approve: 'Setujui pembelian ini? Stok barang langsung bertambah dan pembelian tidak bisa diubah lagi.',
  cancel: 'Batalkan pembelian ini?',
  delete: 'Hapus draf pembelian ini?',
} as const

function OrderPage() {
  const order = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function act(action: keyof typeof CONFIRM) {
    if (!confirm(CONFIRM[action])) return
    setBusy(true)
    const r = await orderAction({ data: { id: order.id, action } })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    if (action === 'delete') return navigate({ to: '/pembelian' })
    setError(undefined)
    await router.invalidate()
  }

  return (
    <StockLayout title={`Pembelian dari ${order.supplierName}`}>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusBadge status={order.status} />
          <span className="text-sm text-ink-muted">Dibuat {formatDate(order.createdAt)}</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-ink-muted">Pembayaran</dt>
          <dd className="text-ink">{order.paymentMethod ?? '–'}</dd>
          {order.approvedAt && (
            <>
              <dt className="text-ink-muted">Disetujui</dt>
              <dd className="text-ink">{formatDate(order.approvedAt)}</dd>
            </>
          )}
          {order.note && (
            <>
              <dt className="text-ink-muted">Catatan</dt>
              <dd className="text-ink">{order.note}</dd>
            </>
          )}
        </dl>
      </Card>
      <Card>
        <ul className="divide-y divide-ink/10">
          {order.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-3 py-2">
              <span>
                <span className="text-ink">{l.productName}</span>
                <span className="block text-sm text-ink-muted">
                  {l.qty} × {rupiah(l.unitCost)}
                </span>
              </span>
              <span className="font-medium text-ink">{rupiah(l.qty * l.unitCost)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex justify-between border-t border-ink/10 pt-3 text-lg font-semibold text-ink">
          <span>Total</span>
          <span>{rupiah(order.total)}</span>
        </p>
      </Card>
      <ErrorText>{error}</ErrorText>
      {order.status === 'draft' && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void act('approve')}>
            Setujui dan tambah stok
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void act('cancel')}>
            Batalkan
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void act('delete')}>
            Hapus draf
          </Button>
        </div>
      )}
    </StockLayout>
  )
}
