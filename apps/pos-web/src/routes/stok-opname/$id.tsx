import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { loadOpname, opnameAction } from '../pembelian/-api'
import { Button, Card, ErrorText, formatDate, LoadError, Pending, StatusBadge, StockLayout } from '../pembelian/-ui'

export const Route = createFileRoute('/stok-opname/$id')({
  loader: ({ params }) => loadOpname({ data: params.id }),
  component: OpnamePage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

function OpnamePage() {
  const opname = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function act(action: 'approve' | 'delete') {
    const msg =
      action === 'approve'
        ? 'Setujui opname ini? Stok disesuaikan sebesar selisihnya dan opname tidak bisa diubah lagi.'
        : 'Hapus draf opname ini?'
    if (!confirm(msg)) return
    setBusy(true)
    const r = await opnameAction({ data: { id: opname.id, action } })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    if (action === 'delete') return navigate({ to: '/stok-opname' })
    setError(undefined)
    await router.invalidate()
  }

  return (
    <StockLayout title="Stok opname">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusBadge status={opname.status} />
          <span className="text-sm text-ink-muted">
            {opname.approvedAt ? `Disetujui ${formatDate(opname.approvedAt)}` : `Dihitung ${formatDate(opname.createdAt)}`}
          </span>
        </div>
        {opname.note && <p className="mt-3 text-ink">{opname.note}</p>}
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-2 font-medium">Produk</th>
                <th className="py-2 text-right font-medium">Sistem</th>
                <th className="py-2 text-right font-medium">Dihitung</th>
                <th className="py-2 text-right font-medium">Selisih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {opname.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2">
                    <span className="text-ink">{l.productName}</span>
                    {l.reason && <span className="block text-ink-muted">{l.reason}</span>}
                  </td>
                  <td className="py-2 text-right text-ink">{l.systemQty}</td>
                  <td className="py-2 text-right text-ink">{l.countedQty}</td>
                  <td
                    className={`py-2 text-right font-medium ${l.difference < 0 ? 'text-error' : l.difference > 0 ? 'text-success' : 'text-ink-muted'}`}
                  >
                    {signed(l.difference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <ErrorText>{error}</ErrorText>
      {opname.status === 'draft' && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void act('approve')}>
            Setujui dan sesuaikan stok
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void act('delete')}>
            Hapus draf
          </Button>
        </div>
      )}
    </StockLayout>
  )
}
