import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  Badge,
  Button,
  Card,
  Chip,
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
import { type DebtSummary, loadOrders, type OrderSummary } from './-api'
import { dueText, matchesPayFilter, noMatchText, orderCode, PAY_FILTERS, type PayFilter, shortDay, statusBadge } from './-debt'
import { inDays, STATUS_OPTIONS } from './-ui'

// Lakasir's Purchasings list plus the debt to suppliers (UMK-1970, design feature 29): payment status and due date per
// purchase, the payment filters, and the debt summary. pos-api computes every figure.
export const Route = createFileRoute('/pembelian/')({
  loader: () => loadOrders(),
  component: OrdersPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

const ALL = 'semua'

function OrderBadge({ o }: { o: OrderSummary }) {
  const b = statusBadge(o)
  return (
    <Badge color={b.tone} size="small">
      {b.label}
    </Badge>
  )
}

function SummaryCards({ summary, onLate }: { summary: DebtSummary; onLate: () => void }) {
  const cards = [
    { label: 'Hutang ke pemasok', value: summary.total, hint: `${summary.openCount} pembelian belum lunas` },
    { label: 'Terlambat', value: summary.overdue, hint: `${summary.overdueCount} pembelian`, late: true },
    { label: 'Jatuh tempo 7 hari', value: summary.dueSoon, hint: 'Termasuk hari ini' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {cards.map((c, i) => (
        <Card key={c.label} variant="outlined" padding="medium" className={i === 2 ? 'max-md:col-span-2' : ''}>
          <p className="text-sm text-default-secondary">{c.label}</p>
          <p className={`mt-1 text-xl font-bold md:text-2xl ${c.late && c.value > 0 ? 'text-default-error' : 'text-default-primary'}`}>
            {rupiah(c.value)}
          </p>
          {c.late && c.value > 0 ? (
            <button type="button" className="mt-1 text-xs text-default-secondary underline" onClick={onLate}>
              Lihat yang terlambat
            </button>
          ) : (
            <p className="mt-1 text-xs text-default-secondary">{c.hint}</p>
          )}
        </Card>
      ))}
    </div>
  )
}

function OrdersPage() {
  const canManage = useCan('purchasing.manage')
  const { orders, summary } = Route.useLoaderData()
  const navigate = useNavigate()
  const [pay, setPay] = useState<PayFilter>('semua')
  const [status, setStatus] = useState(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // shortcut: filtered in the browser over the latest 200 orders pos-api returns; the summary covers every order.
  const shown = orders.filter(
    (o) => matchesPayFilter(o, pay) && (status === ALL || o.status === status) && inDays(o.createdAt, from, to),
  )
  const open = (id: string) => void navigate({ to: '/pembelian/$id', params: { id } })
  const reset = () => {
    setPay('semua')
    setStatus(ALL)
    setFrom('')
    setTo('')
  }
  const money = (n: number | null | undefined) => (n === undefined || n === null ? '–' : rupiah(n))

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
      {summary && orders.length > 0 && <SummaryCards summary={summary} onLate={() => setPay('terlambat')} />}
      <Card variant="outlined" padding="none">
        <div className="flex flex-col gap-3 p-4">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Status bayar">
            {PAY_FILTERS.map((f) => (
              <Chip key={f.value} state={pay === f.value ? 'active' : 'default'} onClick={() => setPay(f.value)}>
                {f.label}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
            <div className="col-span-2 sm:w-44">
              <Select
                label="Status pembelian"
                size="small"
                options={[{ value: ALL, label: 'Semua' }, ...STATUS_OPTIONS]}
                value={status}
                onValueChange={setStatus}
              />
            </div>
            <div className="sm:w-44">
              <TextField label="Dari tanggal" type="date" size="small" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="sm:w-44">
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
        </div>
        {orders.length === 0 ? (
          <Empty
            title="Belum ada pembelian"
            hint="Catat pembelian pertama dari pemasok. Stok bertambah saat pembelian disetujui."
            action={
              canManage && (
                <Button width="auto" asChild>
                  <Link to="/pembelian/baru">Buat pembelian</Link>
                </Button>
              )
            }
          />
        ) : shown.length === 0 ? (
          <Empty
            title={noMatchText(pay)}
            hint="Ubah filter untuk melihat pembelian lain."
            action={
              <Button width="auto" type="outline" color="light" onClick={reset}>
                Tampilkan semua
              </Button>
            }
          />
        ) : (
          <>
            {/* Phone: one card per purchase, the remaining debt on the right (design screen 1). */}
            <ul className="divide-y divide-default-primary border-t border-default-primary md:hidden">
              {shown.map((o) => (
                <li key={o.id}>
                  <Link
                    to="/pembelian/$id"
                    params={{ id: o.id }}
                    className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-default-secondary"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-default-primary">
                        {orderCode(o)} · {o.supplierName}
                      </p>
                      <p className="text-sm text-default-secondary">
                        {[o.total === undefined ? null : rupiah(o.total), o.dueDate ? `jatuh tempo ${shortDay(o.dueDate)}` : null]
                          .filter(Boolean)
                          .join(' · ') || formatDate(o.createdAt)}
                      </p>
                      <div className="mt-1">
                        <OrderBadge o={o} />
                      </div>
                    </div>
                    {o.remaining !== undefined && o.remaining !== null && (
                      <p className="shrink-0 font-semibold text-default-primary">{rupiah(o.remaining)}</p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="max-md:hidden">
              <Table density="comfortable">
                <TableHeader>
                  <TableRow>
                    <TableHead>No</TableHead>
                    <TableHead>Pemasok</TableHead>
                    <TableHead className="max-xl:hidden">Tanggal</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Dibayar</TableHead>
                    <TableHead className="text-right">Sisa</TableHead>
                    <TableHead>Jatuh tempo</TableHead>
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
                      <TableCell className="font-medium whitespace-nowrap">{orderCode(o)}</TableCell>
                      <TableCell>{o.supplierName}</TableCell>
                      <TableCell className="whitespace-nowrap max-xl:hidden">{formatDate(o.createdAt)}</TableCell>
                      <TableCell className="text-right">{money(o.total)}</TableCell>
                      <TableCell className="text-right">{o.status === 'approved' ? money(o.paid) : '–'}</TableCell>
                      <TableCell className="text-right font-semibold">{money(o.remaining)}</TableCell>
                      <TableCell className="whitespace-nowrap" title={dueText(o) ?? undefined}>
                        {o.dueDate ? shortDay(o.dueDate) : '–'}
                      </TableCell>
                      <TableCell>
                        <OrderBadge o={o} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>
    </Page>
  )
}
