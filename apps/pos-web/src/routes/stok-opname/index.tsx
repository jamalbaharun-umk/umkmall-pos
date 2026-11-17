import { createFileRoute, Link } from '@tanstack/react-router'
import { loadOpnames } from '../pembelian/-api'
import { Card, Empty, formatDate, LoadError, Pending, StatusBadge, StockLayout } from '../pembelian/-ui'

export const Route = createFileRoute('/stok-opname/')({
  loader: () => loadOpnames(),
  component: OpnamesPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function OpnamesPage() {
  const opnames = Route.useLoaderData()
  return (
    <StockLayout title="Stok opname">
      <Link
        to="/stok-opname/baru"
        className="inline-block rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong"
      >
        Mulai hitung stok
      </Link>
      <Card>
        {opnames.length === 0 ? (
          <Empty title="Belum ada stok opname" hint="Hitung stok fisik di toko, lalu samakan dengan stok di sistem." />
        ) : (
          <ul className="divide-y divide-ink/10">
            {opnames.map((o) => (
              <li key={o.id}>
                <Link
                  to="/stok-opname/$id"
                  params={{ id: o.id }}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-brand-soft/60"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{formatDate(o.createdAt)}</span>
                    <span className="block truncate text-sm text-ink-muted">{o.note ?? 'Tanpa catatan'}</span>
                  </span>
                  <StatusBadge status={o.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </StockLayout>
  )
}
