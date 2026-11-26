import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Alert, Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@umkmall/ui'
import { Empty, formatDate, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { ListFooter } from '../pelanggan/-ui'
import { loadReview } from './-api'
import {
  FILTERS,
  filterOf,
  kindLabel,
  needsReviewOf,
  reasonLabel,
  receiptTodo,
  refundLabel,
  saleHasPage,
  saleStatusLabel,
  type ReviewFilter,
  type ReviewReceipt,
  type Tone,
} from './-review'

// "Perlu ditinjau" (UMK-2041, design 27): money a payment gateway received that paid no sale (late, a second time,
// another amount) and the refunds a gateway refused. Read only: payment-api refunds unmatched money by itself; a
// refused refund is retried or marked "dikembalikan manual" on its sale's page. The owner only (`payments.manage`).
export const Route = createFileRoute('/perlu-ditinjau/')({
  validateSearch: (s: Record<string, unknown>): { filter?: ReviewFilter; page?: number } => ({
    filter: s.filter === undefined ? undefined : filterOf(s.filter),
    page: Number(s.page) > 1 ? Math.floor(Number(s.page)) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadReview({ data: { needsReview: needsReviewOf(deps.filter ?? 'tinjau'), page: deps.page ?? 1 } }),
  component: ReviewPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

const BADGE: Record<Tone, 'success' | 'warning' | 'danger' | 'light'> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'light',
}

function SaleRef({ r }: { r: Pick<ReviewReceipt, 'saleId' | 'saleNumber' | 'saleStatus'> }) {
  if (!r.saleId) return <span className="text-default-secondary">Tidak terkait penjualan toko ini</span>
  // A receipt number exists only for a sale that was paid; a cancelled one keeps its hold number.
  const label = r.saleNumber === null ? 'Penjualan' : saleHasPage(r.saleStatus) ? `Struk #${r.saleNumber}` : `Nomor tunggu #${r.saleNumber}`
  return (
    <span>
      {saleHasPage(r.saleStatus) ? (
        <Link to="/kasir/riwayat/$id" params={{ id: r.saleId }} className="font-medium text-default-brand underline">
          {label}
        </Link>
      ) : (
        <span className="font-medium">{label}</span>
      )}
      <span className="text-default-secondary"> · {saleStatusLabel(r.saleStatus)}</span>
    </span>
  )
}

function ReviewPage() {
  const review = Route.useLoaderData()
  const search = Route.useSearch()
  const filter = search.filter ?? 'tinjau'
  const navigate = useNavigate({ from: '/perlu-ditinjau/' })
  const { items, page, perPage, total } = review.receipts

  return (
    <Page title="Perlu ditinjau" crumbs={[{ label: 'Pengaturan' }, { label: 'Pembayaran Online', to: '/pengaturan/pembayaran-online' }, { label: 'Perlu ditinjau' }]}>
      {!review.enabled && (
        <Alert variant="info" size="small">
          Pembayaran online belum aktif di POS ini, jadi belum ada uang dari gateway yang perlu ditinjau.
        </Alert>
      )}

      {review.failedRefunds.length > 0 && (
        <Card variant="outlined" padding="none" className="overflow-hidden">
          <div className="border-b border-default-primary px-4 py-3">
            <h2 className="font-semibold text-default-primary">Refund ditolak gateway</h2>
            <p className="text-sm text-default-secondary">
              Uang pelanggan belum kembali. Buka penjualannya untuk mencoba lagi atau menandai dikembalikan manual.
            </p>
          </div>
          <ul className="divide-y divide-default-primary">
            {review.failedRefunds.map((f) => (
              <li key={f.saleId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-default-primary">
                    {f.saleNumber !== null ? `Struk #${f.saleNumber}` : 'Penjualan'} · {reasonLabel(f.reasonCode)}
                  </p>
                  <p className="text-xs text-default-secondary">{f.requestedAt ? formatDate(f.requestedAt) : '-'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold whitespace-nowrap tabular-nums">{rupiah(f.amount)}</span>
                  <Button asChild type="outline" color="light" size="small" width="auto">
                    <Link to="/kasir/riwayat/$id" params={{ id: f.saleId }}>
                      Buka
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Saring daftar">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            width="auto"
            size="small"
            type={f.value === filter ? 'primary' : 'outline'}
            color={f.value === filter ? 'primary' : 'light'}
            aria-pressed={f.value === filter}
            onClick={() => void navigate({ search: { filter: f.value === 'tinjau' ? undefined : f.value, page: undefined } })}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <Card variant="outlined" padding="none" className="overflow-hidden">
        {items.length === 0 ? (
          <Empty
            title={filter === 'tinjau' ? 'Tidak ada yang perlu ditinjau' : 'Belum ada pembayaran di daftar ini'}
            hint="Pembayaran yang masuk setelah tagihan ditutup, pembayaran ganda, atau jumlah yang tidak cocok muncul di sini. Gateway mengembalikannya otomatis."
          />
        ) : (
          <>
            <ul className="divide-y divide-default-primary md:hidden">
              {items.map((r) => {
                const st = refundLabel(r)
                return (
                  <li key={r.id} className="flex flex-col gap-1 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-default-primary">{kindLabel(r.kind)}</p>
                      <span className="font-semibold whitespace-nowrap tabular-nums">{rupiah(r.amount)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge color={BADGE[st.tone]} size="small">
                        {st.text}
                      </Badge>
                      <SaleRef r={r} />
                    </div>
                    <p className="text-xs text-default-secondary">
                      {r.receivedAt ? formatDate(r.receivedAt) : '-'} · {receiptTodo(r)}
                    </p>
                  </li>
                )
              })}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu masuk</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Penjualan</TableHead>
                    <TableHead>Status pengembalian</TableHead>
                    <TableHead>Tindakan</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => {
                    const st = refundLabel(r)
                    return (
                      <TableRow key={r.id}>
                        <TableCell>{r.receivedAt ? formatDate(r.receivedAt) : '-'}</TableCell>
                        <TableCell>{kindLabel(r.kind)}</TableCell>
                        <TableCell>
                          <SaleRef r={r} />
                        </TableCell>
                        <TableCell>
                          <Badge color={BADGE[st.tone]} size="small">
                            {st.text}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-default-secondary">{receiptTodo(r)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rupiah(r.amount)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        {total > 0 && (
          <ListFooter
            page={page}
            perPage={perPage}
            total={total}
            shown={items.length}
            noun="pembayaran"
            onPage={(n) => void navigate({ search: (s) => ({ ...s, page: n > 1 ? n : undefined }) })}
          />
        )}
      </Card>
    </Page>
  )
}
