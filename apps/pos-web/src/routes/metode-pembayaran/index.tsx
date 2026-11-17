import { createFileRoute } from '@tanstack/react-router'
import { Badge } from '@umkmall/ui'
import { listResource, type PaymentKind, type PaymentMethod } from '../pelanggan/-api'
import { LoadError, Pending, ResourcePage } from '../pelanggan/-ui'

// Lakasir PaymentMethodResource. Exactly one kind per method; "Kasbon" (credit) sales create a receivable.
const KINDS: { value: PaymentKind; label: string }[] = [
  { value: 'cash', label: 'Tunai' },
  { value: 'debit', label: 'Debit' },
  { value: 'credit', label: 'Kasbon (kredit)' },
  { value: 'wallet', label: 'Dompet digital' },
]
const kindLabel = (k: PaymentKind) => KINDS.find((x) => x.value === k)?.label ?? k

export const Route = createFileRoute('/metode-pembayaran/')({
  loader: async () => (await listResource({ data: { resource: 'payment-methods' } })) as unknown as PaymentMethod[],
  pendingComponent: Pending,
  errorComponent: LoadError,
  component: () => (
    <ResourcePage<PaymentMethod>
      title="Metode pembayaran"
      crumbs={[{ label: 'Metode pembayaran' }, { label: 'Daftar' }]}
      singular="metode pembayaran"
      resource="payment-methods"
      rows={Route.useLoaderData()}
      emptyHint="Tunai selalu tersedia. Tambahkan debit, dompet digital atau kasbon."
      // Tunai is the store's fixed cash method.
      canManage={(m) => m.name !== 'Tunai'}
      columns={[
        { label: 'Nama', cell: (m) => m.name },
        {
          label: 'Jenis',
          cell: (m) => <Badge color={m.kind === 'credit' ? 'warning' : 'primary'}>{kindLabel(m.kind)}</Badge>,
        },
      ]}
      fields={[
        { name: 'name', label: 'Nama', placeholder: 'Contoh: QRIS BCA', max: 60 },
        { name: 'kind', label: 'Jenis', options: KINDS },
      ]}
    />
  ),
})
