import { createFileRoute, Link } from '@tanstack/react-router'
import { loadOrders } from './-api'
import { Card, Empty, formatDate, LoadError, Pending, rupiah, StatusBadge, StockLayout } from './-ui'

export const Route = createFileRoute('/pembelian/')({
  loader: () => loadOrders(),
  component: OrdersPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function OrdersPage() {
  const orders = Route.useLoaderData()
  return (
    <StockLayout title="Pembelian">
      <Link
        to="/pembelian/baru"
        className="inline-block rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong"
      >
        Buat pembelian
      </Link>
      <Card>
        {orders.length === 0 ? (
          <Empty title="Belum ada pembelian" hint="Catat barang yang kamu beli dari pemasok. Stok bertambah saat pembelian disetujui." />
        ) : (
          <ul className="divide-y divide-ink/10">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  to="/pembelian/$id"
                  params={{ id: o.id }}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-brand-soft/60"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{o.supplierName}</span>
                    <span className="block text-sm text-ink-muted">{formatDate(o.createdAt)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-medium text-ink">{rupiah(o.total)}</span>
                    <StatusBadge status={o.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </StockLayout>
  )
}
