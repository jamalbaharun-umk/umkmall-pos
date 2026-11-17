import { Button } from '@umkmall/ui/primitives'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Empty, NoAccess, Page, PageError, PageLoading, Panel } from '@/components/page'
import { useCan } from '@/components/shell'
import { listCategories } from '../-api'
import { ProductForm } from './-form'

export const Route = createFileRoute('/catalog/products/baru')({
  loader: () => listCategories(),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: CreateProduct,
})

function CreateProduct() {
  const categories = Route.useLoaderData()
  const canEdit = useCan('catalog.manage')
  return (
    <Page title="Tambah produk" crumbs={[{ label: 'Produk', to: '/catalog/products' }, { label: 'Tambah' }]}>
      {!canEdit ? (
        <NoAccess permission="Mengelola katalog" />
      ) : categories.length === 0 ? (
        <Panel>
          <Empty
            title="Belum ada kategori"
            action={
              <Button asChild type="primary" color="primary" size="small" width="auto">
                <Link to="/catalog/categories">Buat kategori</Link>
              </Button>
            }
          >
            Setiap produk masuk satu kategori. Buat kategori dulu, misalnya “Minuman”.
          </Empty>
        </Panel>
      ) : (
        <ProductForm categories={categories} />
      )}
    </Page>
  )
}
