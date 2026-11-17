import { createFileRoute } from '@tanstack/react-router'
import { LoadError, Pending } from '@/components/pos-page'
import { loadOrderForm } from './-api'
import { OrderForm } from './-order-form'

// Lakasir's create purchasing (supplier, payment method) plus its stock lines, on one screen: U6 creates the order
// with its lines in one call.
export const Route = createFileRoute('/pembelian/baru')({
  loader: () => loadOrderForm(),
  component: () => <OrderForm {...Route.useLoaderData()} />,
  pendingComponent: Pending,
  errorComponent: LoadError,
})
