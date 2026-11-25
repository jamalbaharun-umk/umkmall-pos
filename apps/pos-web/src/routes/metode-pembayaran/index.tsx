import { createFileRoute } from '@tanstack/react-router'
import { Alert, Badge } from '@umkmall/ui'
import { gatewayLabel } from '../kasir/-online'
import { listResource, type PaymentKind, type PaymentMethod } from '../pelanggan/-api'
import { LoadError, Pending, ResourcePage } from '../pelanggan/-ui'

// Lakasir PaymentMethodResource. Exactly one kind per method; "Kasbon" (credit) sales create a receivable.
const KINDS: { value: PaymentKind; label: string }[] = [
  { value: 'cash', label: 'Tunai' },
  { value: 'debit', label: 'Debit' },
  { value: 'credit', label: 'Kasbon (kredit)' },
  { value: 'wallet', label: 'Dompet digital' },
  // UMK-1991: paid through the payment gateway; the customer gets a QR or a VA number and the till waits for the payment.
  { value: 'online', label: 'Pembayaran online (QRIS dinamis / VA)' },
]
const GATEWAY_METHODS = [
  { value: 'fake_qris', label: gatewayLabel('fake_qris') },
  { value: 'fake_va', label: gatewayLabel('fake_va') },
]
const kindLabel = (m: PaymentMethod) =>
  m.kind === 'online' ? gatewayLabel(m.gatewayMethod) : (KINDS.find((x) => x.value === m.kind)?.label ?? m.kind)

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
      emptyHint="Tunai selalu tersedia. Tambahkan debit, dompet digital, kasbon atau pembayaran online."
      toolbar={
        <Alert variant="info" size="small">
          Metode online (QRIS dinamis, Virtual Account) tampil di kasir hanya bila toko sudah aktif di Pembayaran Online
          dan metodenya menyala. Saat ini hanya gateway tiruan untuk uji coba; uang nyata belum diizinkan.
        </Alert>
      }
      // Tunai is the store's fixed cash method.
      canManage={(m) => m.name !== 'Tunai'}
      columns={[
        { label: 'Nama', cell: (m) => m.name },
        {
          label: 'Jenis',
          cell: (m) => <Badge color={m.kind === 'credit' ? 'warning' : 'primary'}>{kindLabel(m)}</Badge>,
        },
      ]}
      fields={[
        { name: 'name', label: 'Nama', placeholder: 'Contoh: QRIS BCA', max: 60 },
        { name: 'kind', label: 'Jenis', options: KINDS },
        {
          name: 'gatewayMethod',
          label: 'Metode gateway',
          options: GATEWAY_METHODS,
          showWhen: (v) => v.kind === 'online',
        },
      ]}
    />
  ),
})
