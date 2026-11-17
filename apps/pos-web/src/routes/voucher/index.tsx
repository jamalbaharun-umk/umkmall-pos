import { createFileRoute } from '@tanstack/react-router'
import { listResource, type Voucher } from '../pelanggan/-api'
import { parseRupiah } from '../pelanggan/-form'
import { formatDay, LoadError, Pending, ResourcePage, rupiah } from '../pelanggan/-ui'

// Lakasir VoucherResource: percentage or flat, minimum purchase, quota, date range (inclusive, WIB).
export const Route = createFileRoute('/voucher/')({
  loader: async () => (await listResource({ data: { resource: 'vouchers' } })) as unknown as Voucher[],
  pendingComponent: Pending,
  errorComponent: LoadError,
  component: () => (
    <ResourcePage<Voucher>
      title="Voucher"
      crumbs={[{ label: 'Voucher' }, { label: 'Daftar' }]}
      singular="voucher"
      resource="vouchers"
      rows={Route.useLoaderData()}
      emptyHint="Buat voucher potongan persen atau nominal untuk dipakai di kasir."
      columns={[
        { label: 'Nama', cell: (v) => v.name },
        { label: 'Kode', cell: (v) => <span className="font-mono">{v.code}</span> },
        {
          label: 'Potongan',
          cell: (v) => (v.type === 'percentage' ? `${v.nominal}%` : rupiah(v.nominal)),
          right: true,
        },
        { label: 'Min. belanja', cell: (v) => rupiah(v.minimalBuying), right: true },
        { label: 'Kuota', cell: (v) => v.kuota, right: true },
        { label: 'Mulai', cell: (v) => formatDay(v.startDate) },
        { label: 'Berakhir', cell: (v) => formatDay(v.expired) },
      ]}
      fields={[
        { name: 'name', label: 'Nama', max: 120 },
        { name: 'code', label: 'Kode', placeholder: 'Contoh: HEMAT10', max: 40, noSpaces: true },
        {
          name: 'type',
          label: 'Jenis',
          options: [
            { value: 'percentage', label: 'Persen' },
            { value: 'flat', label: 'Nominal (Rp)' },
          ],
        },
        {
          name: 'nominal',
          label: 'Potongan (persen atau rupiah)',
          type: 'number',
          check: (v, all) => {
            const n = parseRupiah(v)
            if (n <= 0) return 'Harus lebih dari 0'
            if (all.type === 'percentage' && n > 100) return 'Persen antara 1 dan 100'
          },
        },
        { name: 'minimalBuying', label: 'Minimal belanja (Rp)', type: 'number', optional: true },
        { name: 'kuota', label: 'Kuota', type: 'number' },
        { name: 'startDate', label: 'Mulai', type: 'date' },
        {
          name: 'expired',
          label: 'Berakhir',
          type: 'date',
          check: (v, all) =>
            all.startDate && v < all.startDate
              ? 'Tanggal berakhir harus sama dengan atau setelah tanggal mulai'
              : undefined,
        },
      ]}
    />
  ),
})
