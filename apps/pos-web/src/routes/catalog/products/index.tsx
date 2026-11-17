import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { listCategories, listProducts, rupiah, type ProductSearch } from '../-api'
import { Card, Empty, ErrorState, Loading, input, primary, secondary } from '../-ui'

const TYPE_LABEL = { product: 'Barang', service: 'Jasa', non_stock: 'Tanpa stok' } as const

export const Route = createFileRoute('/catalog/products/')({
  validateSearch: (s: Record<string, unknown>): ProductSearch => ({
    // The router JSON-parses search values, so a barcode like ?q=899123 arrives as a number.
    q: s.q == null || s.q === '' ? undefined : String(s.q),
    categoryId: typeof s.categoryId === 'string' && s.categoryId ? s.categoryId : undefined,
    page: Number(s.page) >= 1 ? Math.floor(Number(s.page)) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [page, categories] = await Promise.all([listProducts({ data: deps }), listCategories()])
    return { page, categories }
  },
  pendingComponent: Loading,
  errorComponent: ErrorState,
  component: ProductsPage,
})

function ProductsPage() {
  const { page, categories } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [q, setQ] = useState(search.q ?? '')
  const pages = Math.max(1, Math.ceil(page.total / page.perPage))
  const filtered = Boolean(search.q || search.categoryId)

  function submit(e: FormEvent) {
    e.preventDefault()
    void navigate({ search: (s) => ({ ...s, q: q.trim() || undefined, page: undefined }) })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form onSubmit={submit} className="flex flex-1 gap-2" role="search">
          <input
            className={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama, SKU atau barcode"
            aria-label="Cari produk"
          />
          <button type="submit" className={secondary}>
            Cari
          </button>
        </form>
        <select
          className={`${input} sm:w-48`}
          aria-label="Filter kategori"
          value={search.categoryId ?? ''}
          onChange={(e) =>
            void navigate({ search: (s) => ({ ...s, categoryId: e.target.value || undefined, page: undefined }) })
          }
        >
          <option value="">Semua kategori</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Link to="/catalog/products/$id" params={{ id: 'baru' }} className={`${primary} text-center`}>
          Tambah produk
        </Link>
      </div>

      <Card>
        {page.data.length === 0 ? (
          filtered ? (
            <Empty title="Produk tidak ditemukan">Coba kata kunci atau kategori lain.</Empty>
          ) : categories.length === 0 ? (
            <Empty title="Belum ada produk">
              Buat{' '}
              <Link to="/catalog/categories" className="font-medium text-brand hover:underline">
                kategori
              </Link>{' '}
              dulu, lalu tambahkan produk pertamamu.
            </Empty>
          ) : (
            <Empty title="Belum ada produk">Tambahkan produk pertamamu, misalnya “Es Teh Manis”.</Empty>
          )
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-ink-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Produk</th>
                  <th className="hidden px-4 py-2 font-medium sm:table-cell">Kategori</th>
                  <th className="px-4 py-2 text-right font-medium">Harga jual</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {page.data.map((p) => (
                  <tr key={p.id} className="hover:bg-brand-soft">
                    <td className="px-4 py-3">
                      <Link
                        to="/catalog/products/$id"
                        params={{ id: p.id }}
                        className="font-medium text-ink hover:text-brand"
                      >
                        {p.name}
                      </Link>
                      <div className="text-xs text-ink-muted">
                        {p.sku} · {TYPE_LABEL[p.type]} · {p.unit}
                        <span className="sm:hidden"> · {p.category.name}</span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-ink sm:table-cell">{p.category.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{rupiah(p.sellingPrice)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.isActive ? 'bg-success/10 text-success' : 'bg-ink/5 text-ink-muted'}`}
                      >
                        {p.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm text-ink-muted" aria-label="Halaman">
          <button
            type="button"
            className={secondary}
            disabled={page.page <= 1}
            onClick={() => void navigate({ search: (s) => ({ ...s, page: page.page - 1 }) })}
          >
            Sebelumnya
          </button>
          <span>
            Halaman {page.page} dari {pages}
          </span>
          <button
            type="button"
            className={secondary}
            disabled={page.page >= pages}
            onClick={() => void navigate({ search: (s) => ({ ...s, page: page.page + 1 }) })}
          >
            Berikutnya
          </button>
        </nav>
      )}
    </div>
  )
}
