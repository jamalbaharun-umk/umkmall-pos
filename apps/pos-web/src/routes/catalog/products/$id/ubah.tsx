import { createFileRoute } from '@tanstack/react-router'
import { Page, PageError, PageLoading } from '@/components/page'
import { getProduct, listCategories } from '../../-api'
import { ProductForm } from '../-form'

export const Route = createFileRoute('/catalog/products/$id/ubah')({
  loader: async ({ params }) => {
    const [categories, product] = await Promise.all([listCategories(), getProduct({ data: params.id })])
    return { categories, product }
  },
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: EditProduct,
})

function EditProduct() {
  const { categories, product } = Route.useLoaderData()
  return (
    <Page
      title={`Ubah ${product.name}`}
      crumbs={[
        { label: 'Produk', to: '/catalog/products' },
        { label: product.name, to: '/catalog/products/$id', params: { id: product.id } },
        { label: 'Ubah' },
      ]}
    >
      <ProductForm key={product.id} categories={categories} product={product} />
    </Page>
  )
}
