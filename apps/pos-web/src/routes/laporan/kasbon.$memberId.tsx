import { createFileRoute, Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Card } from '@umkmall/ui/compositions'
import { Badge, Button } from '@umkmall/ui/primitives'
import { ActionRow } from '@/components/action-row'
import { Empty, Page, PageLoading, Panel } from '@/components/page'
import { useCan } from '@/components/shell'
import { loadKasbonCustomer, rupiah } from './-api'
import { shortDate, statusLabel, type KasbonItem } from './-kasbon'
import { downloadKasbonCsv } from './-kasbon-download'
import { ReportError } from './-ui'

// UMK-1964 customer detail of the kasbon report: their open kasbon and the payments in the book.

export const Route = createFileRoute('/laporan/kasbon/$memberId')({
  loader: ({ params }) => loadKasbonCustomer({ data: params.memberId }),
  component: CustomerPage,
  pendingComponent: PageLoading,
  errorComponent: () => <ReportError />,
})

const crumbs = (name: string) => [
  { label: 'Laporan', to: '/laporan' },
  { label: 'Laporan kasbon', to: '/laporan/kasbon' },
  { label: name },
]

function CustomerPage() {
  const result = Route.useLoaderData()
  const { memberId } = Route.useParams()
  if (!result.ok && result.status === 404)
    return (
      <Page title="Pelanggan" crumbs={crumbs('Pelanggan')}>
        <Panel>
          <Empty
            title="Pelanggan tidak ditemukan"
            action={
              <Button asChild type="outline" color="primary" size="small" width="auto">
                <Link to="/laporan/kasbon">Kembali ke laporan kasbon</Link>
              </Button>
            }
          >
            Pelanggan ini tidak ada di toko Anda atau sudah dihapus.
          </Empty>
        </Panel>
      </Page>
    )
  if (!result.ok) return <ReportError message={result.error} />
  const d = result.data
  return (
    <Page title={d.name} crumbs={crumbs(d.name)}>
      <Card variant="outlined" padding="medium">
        <p className="text-3xl font-bold tabular-nums text-default-primary">{rupiah(d.rest)}</p>
        <p className="text-sm text-default-secondary">sisa kasbon</p>
      </Card>
      {d.receivables.length === 0 ? (
        <Panel>
          <Empty
            title="Tidak ada kasbon yang belum lunas"
            action={
              <Button asChild type="outline" color="primary" size="small" width="auto">
                <Link to="/laporan/kasbon">Kembali ke laporan kasbon</Link>
              </Button>
            }
          >
            Semua kasbon pelanggan ini sudah lunas atau dibatalkan.
          </Empty>
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {d.receivables.map((k) => (
              <KasbonCard key={k.id} k={k} />
            ))}
          </div>
          <p className="text-sm text-default-secondary">Sisa dihitung dari buku pembayaran.</p>
          <CustomerExport memberId={memberId} />
        </>
      )}
    </Page>
  )
}

function KasbonCard({ k }: { k: KasbonItem }) {
  const canCollect = useCan('receivables.manage')
  return (
    <Card variant="outlined" padding="medium" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-default-secondary">
          Jatuh tempo {shortDate(k.dueDate)}
        </p>
        <Badge color={k.status === 'due' ? 'danger' : 'light'}>{statusLabel(k)}</Badge>
      </div>
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="font-medium text-default-primary">
            Kasbon #{k.saleNumber} · {shortDate(k.createdOn)}
          </dt>
          <dd className="font-medium tabular-nums text-default-primary">{rupiah(k.total)}</dd>
        </div>
        {k.payments.map((p) => (
          <div key={p.id} className="flex justify-between gap-4">
            <dt className="text-default-secondary">
              Dibayar {shortDate(p.paidOn)} ({p.method.toLowerCase()})
              {p.byCollector && <span className="block text-xs">Diambil penagih di luar shift</span>}
            </dt>
            <dd className="tabular-nums text-default-success">−{rupiah(p.amount)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-default-secondary pt-2">
          <dt className="font-semibold text-default-primary">Sisa</dt>
          <dd className="font-semibold tabular-nums text-default-primary">{rupiah(k.rest)}</dd>
        </div>
      </dl>
      {canCollect && (
        <ActionRow align="start">
          <Button asChild type="primary" color="primary" width="auto">
            <Link to="/piutang/$id" params={{ id: k.id }}>
              Terima pembayaran
            </Link>
          </Button>
        </ActionRow>
      )}
    </Card>
  )
}

/** This customer's open kasbon as CSV (the narrowing the "too large" dialog suggests). */
function CustomerExport({ memberId }: { memberId: string }) {
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  return (
    <ActionRow align="start">
      <Button
        type="outline"
        color="primary"
        width="auto"
        isLoading={busy}
        onClick={async () => {
          if (running.current) return
          running.current = true
          setBusy(true)
          await downloadKasbonCsv({ filter: 'all', memberId }).finally(() => {
            running.current = false
            setBusy(false)
          })
        }}
      >
        Ekspor CSV pelanggan ini
      </Button>
    </ActionRow>
  )
}
