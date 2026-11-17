import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  Button,
  Card,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextField,
} from '@umkmall/ui'
import { useState } from 'react'
import { Empty, formatDate, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { useCan } from '@/components/shell'
import { loadOrders } from './-api'
import { inDays, STATUS_OPTIONS, StatusBadge } from './-ui'

// Lakasir's Purchasings list: supplier, date, payment, total, status, with status and date filters.
export const Route = createFileRoute('/pembelian/')({
  loader: () => loadOrders(),
  component: OrdersPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

const ALL = 'semua'

function OrdersPage() {
  const canManage = useCan('purchasing.manage')
  const orders = Route.useLoaderData()
  const navigate = useNavigate()
  const [status, setStatus] = useState(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // shortcut: filtered in the browser over every order pos-api returns; page server-side when lists grow.
  const shown = orders.filter((o) => (status === ALL || o.status === status) && inDays(o.createdAt, from, to))
  const open = (id: string) => void navigate({ to: '/pembelian/$id', params: { id } })

  return (
    <Page
      crumbs={[{ label: 'Pembelian', to: '/pembelian' }, { label: 'Daftar' }]}
      title="Pembelian"
      actions={
        canManage && (
          <Button width="auto" asChild>
            <Link to="/pembelian/baru">Pembelian baru</Link>
          </Button>
        )
      }
    >
      <Card variant="outlined" padding="none">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="w-44">
            <Select
              label="Status"
              size="small"
              options={[{ value: ALL, label: 'Semua' }, ...STATUS_OPTIONS]}
              value={status}
              onValueChange={setStatus}
            />
          </div>
          <div className="w-44">
            <TextField
              label="Dari tanggal"
              type="date"
              size="small"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="w-44">
            <TextField
              label="Sampai tanggal"
              type="date"
              size="small"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              error={from && to && to < from ? 'Harus sama atau setelah tanggal awal' : undefined}
            />
          </div>
        </div>
        {shown.length === 0 ? (
          <Empty
            title={orders.length === 0 ? 'Belum ada pembelian' : 'Tidak ada pembelian yang cocok'}
            hint={
              orders.length === 0
                ? 'Catat barang yang kamu beli dari pemasok. Stok bertambah saat pembelian disetujui.'
                : 'Ubah filter.'
            }
          />
        ) : (
          <Table density="comfortable">
            <TableHeader>
              <TableRow>
                <TableHead>Pemasok</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Metode pembayaran</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((o) => (
                <TableRow
                  key={o.id}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => open(o.id)}
                  onKeyDown={(e) => e.key === 'Enter' && open(o.id)}
                >
                  <TableCell className="font-medium">{o.supplierName}</TableCell>
                  <TableCell>{formatDate(o.createdAt)}</TableCell>
                  <TableCell>{o.paymentMethod ?? '–'}</TableCell>
                  <TableCell className="text-right">{o.total === undefined ? '–' : rupiah(o.total)}</TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </Page>
  )
}
