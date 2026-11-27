import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import {
  Badge,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  TextField,
} from '@umkmall/ui'
import { useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { WhatsappReminderDialog } from '@/components/whatsapp-dialogs'
import { loadReceivables } from '../pelanggan/-api'
import { Empty, formatDay, formatMomentDay, ListFooter, LoadError, Page, Pending, rupiah } from '../pelanggan/-ui'

type Status = 'open' | 'settled' | undefined

// Lakasir ReceivableResource list: member, sale, total, rest, due date, last payment, status.
export const Route = createFileRoute('/piutang/')({
  validateSearch: (s: Record<string, unknown>): { status?: 'open' | 'settled'; q?: string; page?: number } => ({
    status: s.status === 'open' || s.status === 'settled' ? s.status : undefined,
    // The router JSON-parses search values, so ?q=12 arrives as a number.
    q: s.q == null || s.q === '' ? undefined : String(s.q),
    page: Number(s.page) >= 1 ? Math.floor(Number(s.page)) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadReceivables({ data: deps }),
  pendingComponent: Pending,
  errorComponent: LoadError,
  component: ReceivablesPage,
})

/** The queue after this step: the next customer, or nothing after the last. */
const next = (q: { ids: string[]; index: number }) => (q.index + 1 < q.ids.length ? { ...q, index: q.index + 1 } : null)

function ReceivablesPage() {
  const list = Route.useLoaderData()
  const rows = list.data
  const { status, q } = Route.useSearch()
  const navigate = useNavigate({ from: '/piutang/' })
  const [query, setQuery] = useState(q ?? '')
  const router = useRouter()
  // UMK-1973: one customer's reminder, or the queue of late customers (one chat opens at a time).
  const [reminder, setReminder] = useState<{ ids: string[]; index: number } | null>(null)
  const late = list.summary.overdueMemberIds
  return (
    <Page title="Piutang" crumbs={[{ label: 'Piutang' }, { label: 'Daftar' }]}>
      {/* Lakasir's StatsReceivable: what members still owe, over the search (any page, any tab). */}
      <Card variant="outlined" padding="large" className="flex flex-wrap gap-8">
        <div>
          <p className="text-sm text-default-secondary">Sisa piutang belum lunas</p>
          <p className="text-2xl font-bold text-default-primary">{rupiah(list.summary.openRest)}</p>
        </div>
        <div>
          <p className="text-sm text-default-secondary">Belum lunas</p>
          <p className="text-2xl font-bold text-default-primary">{list.summary.openCount}</p>
        </div>
        {list.summary.outsideShiftCollected > 0 && (
          <div>
            <p className="text-sm text-default-secondary">Tunai dikumpulkan di luar shift</p>
            <p className="text-2xl font-bold text-default-primary">{rupiah(list.summary.outsideShiftCollected)}</p>
            <p className="text-xs text-default-secondary">Masuk kas toko, bukan laci shift mana pun.</p>
          </div>
        )}
      </Card>
      {late.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-default-secondary">{late.length} pelanggan terlambat dan punya nomor WhatsApp.</p>
          <ActionRow align="start">
            <Button width="auto" type="outline" color="light" onClick={() => setReminder({ ids: late, index: 0 })}>
              Ingatkan yang terlambat
            </Button>
          </ActionRow>
        </div>
      )}
      <Card variant="outlined" padding="none" className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-default-primary p-4 md:flex-row md:items-center md:justify-between">
          <div className="md:min-w-96">
            <Tabs
              value={status ?? 'all'}
              onValueChange={(v) =>
                void navigate({
                  search: (s) => ({ ...s, status: v === 'all' ? undefined : (v as Status), page: undefined }),
                })
              }
              size="xsmall"
            >
              <TabsList label="Status">
                <TabsTrigger value="all">Semua</TabsTrigger>
                <TabsTrigger value="open">Belum lunas</TabsTrigger>
                <TabsTrigger value="settled">Lunas</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <form
            className="md:w-72"
            onSubmit={(e) => {
              e.preventDefault()
              void navigate({ search: (s) => ({ ...s, q: query.trim() || undefined, page: undefined }) })
            }}
          >
            <TextField
              aria-label="Cari piutang"
              placeholder="Cari pelanggan atau no. penjualan"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              size="small"
            />
          </form>
        </div>
        {rows.length === 0 ? (
          <Empty title={q || status ? 'Tidak ada piutang yang cocok' : 'Belum ada piutang'}>
            {q || status ? 'Ubah pencarian atau filter status.' : 'Penjualan dengan metode kasbon akan muncul di sini.'}
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pelanggan</TableHead>
                <TableHead>Penjualan</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Sisa</TableHead>
                <TableHead>Jatuh tempo</TableHead>
                <TableHead>Bayar terakhir</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Diingatkan</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      to="/piutang/$id"
                      params={{ id: r.id }}
                      className="font-medium text-brand-primary hover:underline"
                    >
                      {r.memberName}
                    </Link>
                  </TableCell>
                  <TableCell>#{r.saleNumber}</TableCell>
                  <TableCell className="text-right">{rupiah(r.total)}</TableCell>
                  <TableCell className="text-right">{rupiah(r.rest)}</TableCell>
                  <TableCell>{formatDay(r.dueDate)}</TableCell>
                  <TableCell>
                    {r.lastPaymentAt ? formatMomentDay(r.lastPaymentAt) : '–'}
                    {r.outsideShiftCollected > 0 && (
                      <div className="text-xs text-default-secondary">
                        {rupiah(r.outsideShiftCollected)} dikumpulkan di luar shift
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.rest === 0 ? <Badge color="success">Lunas</Badge> : <Badge color="warning">Belum lunas</Badge>}
                      {r.overdueDays > 0 && <Badge color="danger">Terlambat {r.overdueDays} hari</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <span>{r.memberLastRemindedAt ? formatMomentDay(r.memberLastRemindedAt) : '–'}</span>
                      {r.rest > 0 && !r.memberDeleted && (
                        <ActionRow align="start" className="w-auto">
                          <Button
                            type="outline"
                            color="light"
                            width="auto"
                            onClick={() => setReminder({ ids: [r.memberId], index: 0 })}
                          >
                            Kirim pengingat
                          </Button>
                        </ActionRow>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Link
                      to="/piutang/$id"
                      params={{ id: r.id }}
                      className="font-medium text-brand-primary hover:underline"
                    >
                      {r.rest > 0 ? 'Bayar' : 'Lihat'}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {list.total > 0 && (
          <ListFooter
            page={list.page}
            perPage={list.perPage}
            total={list.total}
            shown={rows.length}
            noun="piutang"
            onPage={(n) => void navigate({ search: (s) => ({ ...s, page: n > 1 ? n : undefined }) })}
          />
        )}
      </Card>
      {reminder && (
        <WhatsappReminderDialog
          // A new key per customer: each one loads its own message.
          key={reminder.ids[reminder.index]}
          memberId={reminder.ids[reminder.index]}
          step={reminder.ids.length > 1 ? { index: reminder.index + 1, total: reminder.ids.length } : undefined}
          onClose={() => setReminder(null)}
          onDone={() => {
            void router.invalidate()
            setReminder(next(reminder))
          }}
          onSkip={reminder.ids.length > 1 ? () => setReminder(next(reminder)) : undefined}
        />
      )}
    </Page>
  )
}
