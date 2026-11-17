import { createFileRoute, Link } from '@tanstack/react-router'
import { Card, Empty, formatDate, LoadError, Pending } from '../staf/-ui'
import { loadHistory, rupiah } from './-api'
import { KasirMain } from './-ui'

const PER_PAGE = 20

export const Route = createFileRoute('/kasir/riwayat')({
  validateSearch: (s): { page?: number } => (Number(s.page) > 1 ? { page: Math.floor(Number(s.page)) } : {}),
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: ({ deps }) => loadHistory({ data: deps.page }),
  component: HistoryPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function HistoryPage() {
  const { data, total } = Route.useLoaderData()
  const page = Route.useSearch().page ?? 1
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))
  return (
    <KasirMain title="Riwayat penjualan">
      <Card>
        {data.length === 0 ? (
          <Empty title="Belum ada penjualan" hint="Penjualan yang selesai akan muncul di sini." />
        ) : (
          <ul className="divide-y divide-ink/10">
            {data.map((s) => (
              <li key={s.id}>
                <Link to="/kasir/struk/$id" params={{ id: s.id }} className="flex items-center justify-between gap-3 py-3 hover:bg-brand-soft/60">
                  <span>
                    <span className="font-medium text-ink">No. {s.number}</span>
                    <span className="block text-sm text-ink-muted">{formatDate(s.createdAt)}</span>
                  </span>
                  <span className="font-medium text-ink">{rupiah(s.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-4" aria-label="Halaman">
          {page > 1 && <Link to="/kasir/riwayat" search={{ page: page - 1 }} className="text-brand hover:underline">← Sebelumnya</Link>}
          <span className="text-sm text-ink-muted">Halaman {page} dari {pages}</span>
          {page < pages && <Link to="/kasir/riwayat" search={{ page: page + 1 }} className="text-brand hover:underline">Berikutnya →</Link>}
        </nav>
      )}
    </KasirMain>
  )
}
