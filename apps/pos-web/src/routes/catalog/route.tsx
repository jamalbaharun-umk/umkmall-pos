import { Link, Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/catalog')({ component: CatalogLayout })

const tab = 'rounded-lg px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink'
const active = 'bg-white text-ink shadow-sm'

function CatalogLayout() {
  return (
    <main className="mx-auto flex min-h-svh max-w-4xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">Katalog</h1>
        <nav className="flex gap-1 rounded-xl bg-ink/5 p-1" aria-label="Katalog">
          <Link to="/catalog/products" className={tab} activeProps={{ className: active }}>
            Produk
          </Link>
          <Link to="/catalog/categories" className={tab} activeProps={{ className: active }}>
            Kategori
          </Link>
        </nav>
      </header>
      <Outlet />
    </main>
  )
}
