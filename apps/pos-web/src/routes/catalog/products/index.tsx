import {
  Badge,
  Button,
  Menu,
  Pagination,
  SegmentedControl,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextField,
  } from '@umkmall/ui/primitives'
import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { EllipsisVertical, Eye, Pencil, Search, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { notifySuccess } from '@/lib/feedback'
import { useConfirm } from '@/components/confirm'
import { useCan } from '@/components/shell'
import { Empty, Page, PageError, PageLoading, Panel, rupiah } from '@/components/page'
import { deleteProduct, listCategories, listProducts, type ProductSearch } from '../-api'
import { TYPE_LABEL } from './-form'
import { filterLabel, stockState } from '../../kasir/-stock'

export const Route = createFileRoute('/catalog/products/')({
  validateSearch: (s: Record<string, unknown>): ProductSearch => ({
    // The router JSON-parses search values, so a barcode like ?q=899123 arrives as a number.
    q: s.q == null || s.q === '' ? undefined : String(s.q),
    categoryId: typeof s.categoryId === 'string' && s.categoryId ? s.categoryId : undefined,
    stock: s.stock === 'low' || s.stock === 'out' ? s.stock : undefined,
    page: Number(s.page) >= 1 ? Math.floor(Number(s.page)) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [page, categories] = await Promise.all([listProducts({ data: deps }), listCategories()])
    return { page, categories }
  },
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: ProductsPage,
})

/** Lakasir's product table: search (name, SKU, barcode) and filters above, the product columns, row actions, pages. */
function ProductsPage() {
  const { page, categories } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const confirm = useConfirm()
  const canEdit = useCan('catalog.manage')
  const [q, setQ] = useState(search.q ?? '')
  const pages = Math.max(1, Math.ceil(page.total / page.perPage))
  const filtered = Boolean(search.q || search.categoryId || search.stock)
  const first = (page.page - 1) * page.perPage + 1
  // pos-api omits cost for actors who may not see margins; their table has no cost or profit columns.
  const showCost = page.data.some((p) => p.costPrice !== undefined)

  function submit(e: FormEvent) {
    e.preventDefault()
    void navigate({ search: (s) => ({ ...s, q: q.trim() || undefined, page: undefined }) })
  }

  const remove = (id: string, name: string) =>
    confirm.ask(`Hapus ${name}?`, async () => {
      const r = await deleteProduct({ data: id })
      if (r.error) return r
      notifySuccess(`${name} dihapus`)
      await router.invalidate()
    }, { body: 'Produk tidak tampil lagi di kasir. Riwayat penjualannya tetap tersimpan.', action: 'menghapus produk' })

  return (
    <Page
      title="Produk"
      crumbs={[{ label: 'Produk', to: '/catalog/products' }, { label: 'Daftar' }]}
      actions={
        canEdit && (
          <Button asChild type="primary" color="primary" size="small" width="auto">
            <Link to="/catalog/products/baru">Tambah produk</Link>
          </Button>
        )
      }
    >
      <Panel>
        <div className="flex flex-col gap-3 border-b border-border-light p-4 md:flex-row md:items-center md:justify-end">
          <SegmentedControl
            aria-label="Filter stok"
            className="md:mr-auto"
            options={[
              { value: 'all', label: 'Semua' },
              { value: 'low', label: filterLabel('Menipis', page.stockCounts.low) },
              { value: 'out', label: filterLabel('Habis', page.stockCounts.out) },
            ]}
            value={search.stock ?? 'all'}
            onChange={(v) =>
              void navigate({ search: (s) => ({ ...s, stock: v === 'all' ? undefined : v, page: undefined }) })
            }
          />
          <div className="md:w-56 md:shrink-0">
            <Select
              aria-label="Filter kategori"
              size="small"
              options={[{ value: '', label: 'Semua kategori' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              value={search.categoryId ?? ''}
              onValueChange={(v) =>
                void navigate({ search: (s) => ({ ...s, categoryId: v || undefined, page: undefined }) })
              }
            />
          </div>
          <form onSubmit={submit} role="search" className="md:w-72">
            <TextField
              aria-label="Cari produk"
              size="xsmall"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari (SKU, nama, barcode)"
              leadingAdornment={<Search className="size-4 text-default-secondary" aria-hidden />}
            />
          </form>
        </div>

        {page.data.length === 0 ? (
          filtered ? (
            <Empty title="Produk tidak ditemukan">Coba kata kunci atau kategori lain.</Empty>
          ) : (
            <Empty
              title="Belum ada produk"
              action={
                <Button asChild type="primary" color="primary" size="small" width="auto">
                  <Link to={categories.length ? '/catalog/products/baru' : '/catalog/categories'}>
                    {categories.length ? 'Tambah produk' : 'Buat kategori dulu'}
                  </Link>
                </Button>
              }
            >
              Tambahkan produk pertama Anda, misalnya “Es Teh Manis”.
            </Empty>
          )
        ) : (
          <Table density="comfortable" containerClassName="border-0" className="whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead>Kategori</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Stok</TableHead>
                <TableHead>Satuan</TableHead>
                {showCost && <TableHead className="text-right">Harga modal</TableHead>}
                <TableHead className="text-right">Harga jual</TableHead>
                {showCost && <TableHead className="text-right">Laba</TableHead>}
                <TableHead>Jenis</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.data.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a,button,[role=menu]')) return
                    void navigate({ to: '/catalog/products/$id', params: { id: p.id } })
                  }}
                >
                  <TableCell>{p.category.name}</TableCell>
                  <TableCell>
                    <Link to="/catalog/products/$id" params={{ id: p.id }} className="font-medium hover:text-default-brand">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>{p.sku}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <StockCell stock={p.stock} threshold={p.lowStockThreshold} />
                  </TableCell>
                  <TableCell>{p.unit}</TableCell>
                  {showCost && <TableCell className="text-right tabular-nums">{rupiah(p.costPrice ?? 0)}</TableCell>}
                  <TableCell className="text-right tabular-nums">{rupiah(p.sellingPrice)}</TableCell>
                  {showCost && (
                    <TableCell className="text-right tabular-nums">{rupiah(p.sellingPrice - (p.costPrice ?? 0))}</TableCell>
                  )}
                  <TableCell>{TYPE_LABEL[p.type]}</TableCell>
                  <TableCell>
                    <Badge color={p.isActive ? 'success' : 'light'} size="small">
                      {p.isActive ? 'Aktif' : 'Nonaktif'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Menu
                      label={`Aksi ${p.name}`}
                      align="end"
                      trigger={
                        <Button type="text" color="light" size="small" iconOnly aria-label={`Aksi ${p.name}`}>
                          <EllipsisVertical className="size-4" aria-hidden />
                        </Button>
                      }
                      items={[
                        {
                          id: 'lihat',
                          label: 'Lihat',
                          icon: <Eye className="size-4" />,
                          onSelect: () => void navigate({ to: '/catalog/products/$id', params: { id: p.id } }),
                        },
                        ...(canEdit
                          ? [
                              {
                                id: 'ubah',
                                label: 'Ubah',
                                icon: <Pencil className="size-4" />,
                                onSelect: () =>
                                  void navigate({ to: '/catalog/products/$id/ubah', params: { id: p.id } }),
                              },
                              {
                                id: 'hapus',
                                label: 'Hapus',
                                danger: true,
                                icon: <Trash2 className="size-4" />,
                                onSelect: () => remove(p.id, p.name),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {page.total > 0 && (
          <div className="flex flex-col items-center gap-3 border-t border-border-light p-4 sm:flex-row sm:justify-between">
            <span className="text-sm text-default-secondary">
              Menampilkan {first}–{Math.min(first + page.data.length - 1, page.total)} dari {page.total} produk
            </span>
            {pages > 1 && (
              <Pagination
                page={page.page}
                pageCount={pages}
                size="small"
                onPageChange={(n) => void navigate({ search: (s) => ({ ...s, page: n > 1 ? n : undefined }) })}
              />
            )}
          </div>
        )}
      </Panel>
      {confirm.dialog}
    </Page>
  )
}

function StockCell({ stock, threshold }: { stock: number | null | undefined; threshold: number }) {
  const state = stockState(stock, threshold)
  if (state === 'out')
    return (
      <Badge color="danger" size="small">
        Habis
      </Badge>
    )
  if (state === 'low')
    return (
      <Badge color="warning" size="small">
        {stock}
      </Badge>
    )
  return <>{state === 'enough' ? stock : '–'}</>
}
