import { createFileRoute, Link } from '@tanstack/react-router'
import { Button, Card, Text, TextField } from '@umkmall/ui'
import { useState } from 'react'
import { Empty, ErrorText, formatDate, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { closeShift, loadCurrentShift, type Shift } from './-api'
import { parseRupiah } from './-money'

// Closing the cash drawer (Lakasir: cashier header action): expected cash, counted cash, the difference.
export const Route = createFileRoute('/kasir/tutup')({
  loader: () => loadCurrentShift(),
  component: CloseShiftPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function CloseShiftPage() {
  const { shift } = Route.useLoaderData()
  const [counted, setCounted] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [closed, setClosed] = useState<Shift>()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseRupiah(counted)
    if (Number.isNaN(amount)) return setError('Isi uang yang dihitung dengan angka.')
    setBusy(true)
    setError(undefined)
    const res = await closeShift({ data: amount }).catch(() => ({
      ok: false as const,
      error: 'Gagal menutup shift, coba lagi.',
    }))
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setClosed(res.data)
  }

  return (
    <Page crumbs={[{ label: 'Kasir', to: '/kasir' }, { label: 'Tutup shift' }]} title="Tutup shift">
      <Card variant="outlined" padding="large" className="max-w-md">
        {closed ? (
          <>
            <Text as="h2" variant="h5" weight="bold">
              Shift ditutup
            </Text>
            <Summary shift={closed} />
            <Button asChild width="full" className="mt-5">
              <Link to="/kasir">Buka shift baru</Link>
            </Button>
          </>
        ) : !shift ? (
          <Empty
            title="Tidak ada shift yang terbuka"
            action={
              <Button width="auto" asChild>
                <Link to="/kasir">Buka shift</Link>
              </Button>
            }
          />
        ) : (
          <>
            <Text as="h2" variant="h5" weight="bold">
              Hitung uang di laci
            </Text>
            <dl className="mt-3 space-y-1 text-sm">
              <Row label="Dibuka" value={formatDate(shift.openedAt)} />
              <Row label="Uang awal" value={rupiah(shift.openingCash)} />
              <Row label={`Penjualan tunai (${shift.salesCount})`} value={rupiah(shift.cashSales)} />
              <Row label="Seharusnya di laci" value={rupiah(shift.expectedCash)} strong />
            </dl>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <TextField
                label="Uang yang dihitung"
                prefix="Rp"
                inputMode="numeric"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                placeholder="0"
                autoFocus
              />
              <ErrorText>{error}</ErrorText>
              <Button htmlType="submit" width="full" color="danger" isLoading={busy} disabled={counted.trim() === ''}>
                Tutup shift
              </Button>
              <Button asChild type="text" width="full">
                <Link to="/kasir">Kembali ke kasir</Link>
              </Button>
            </form>
          </>
        )}
      </Card>
    </Page>
  )
}

function Summary({ shift }: { shift: Shift }) {
  const diff = shift.difference ?? 0
  return (
    <dl className="mt-3 space-y-1 text-sm">
      <Row label="Uang awal" value={rupiah(shift.openingCash)} />
      <Row label={`Penjualan tunai (${shift.salesCount ?? 0})`} value={rupiah(shift.cashSales ?? 0)} />
      <Row label="Seharusnya di laci" value={rupiah(shift.expectedCash ?? 0)} />
      <Row label="Dihitung" value={rupiah(shift.countedCash ?? 0)} />
      <div
        className={`flex justify-between pt-2 text-base font-bold ${diff === 0 ? 'text-default-success' : 'text-default-error'}`}
      >
        <dt>{diff === 0 ? 'Pas' : diff < 0 ? 'Kurang' : 'Lebih'}</dt>
        <dd>{rupiah(Math.abs(diff))}</dd>
      </div>
    </dl>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'pt-1 text-base font-bold' : 'text-default-secondary'}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
