import { createFileRoute } from '@tanstack/react-router'
import { LoadError, Pending } from '@/components/pos-page'
import { loadOrder, loadOrderForm } from './-api'
import { OrderForm } from './-order-form'

// Lakasir's edit purchasing: drafts only (pos-api answers 409 for an approved or cancelled order).
export const Route = createFileRoute('/pembelian/$id_/ubah')({
  loader: async ({ params }) => ({ ...(await loadOrderForm()), order: await loadOrder({ data: params.id }) }),
  component: () => <OrderForm {...Route.useLoaderData()} />,
  pendingComponent: Pending,
  errorComponent: LoadError,
})
