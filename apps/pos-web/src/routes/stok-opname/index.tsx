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
import { Empty, formatDate, LoadError, Page, Pending } from '@/components/pos-page'
import { useCan } from '@/components/shell'
import { loadOpnames } from '../pembelian/-api'
import { inDays, StatusBadge } from '../pembelian/-ui'

// Lakasir's Stock Opnames list: date, note, status, with status and date filters.
export const Route = createFileRoute('/stok-opname/')({
  loader: () => loadOpnames(),
  component: OpnamesPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

const ALL = 'semua'
const STATUSES = [
  { value: ALL, label: 'Semua' },
  { value: 'draft', label: 'Draf' },
  { value: 'approved', label: 'Disetujui' },
]

function OpnamesPage() {
  const canManage = useCan('purchasing.manage')
  const opnames = Route.useLoaderData()
  const navigate = useNavigate()
  const [status, setStatus] = useState(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const shown = opnames.filter((o) => (status === ALL || o.status === status) && inDays(o.createdAt, from, to))
  const open = (id: string) => void navigate({ to: '/stok-opname/$id', params: { id } })

  return (
    <Page
      crumbs={[{ label: 'Stok opname', to: '/stok-opname' }, { label: 'Daftar' }]}
      title="Stok opname"
      actions={
        canManage && (
          <Button width="auto" asChild>
            <Link to="/stok-opname/baru">Stok opname baru</Link>
          </Button>
        )
      }
    >
      <Card variant="outlined" padding="none">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="w-44">
            <Select label="Status" size="small" options={STATUSES} value={status} onValueChange={setStatus} />
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
            title={opnames.length === 0 ? 'Belum ada stok opname' : 'Tidak ada opname yang cocok'}
            hint={
              opnames.length === 0 ? 'Hitung stok fisik di toko, lalu samakan dengan stok di sistem.' : 'Ubah filter.'
            }
          />
        ) : (
          <Table density="comfortable">
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Catatan</TableHead>
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
                  <TableCell className="font-medium">{formatDate(o.createdAt)}</TableCell>
                  <TableCell className="max-w-md truncate">{o.note ?? '–'}</TableCell>
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
