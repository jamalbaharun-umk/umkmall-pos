import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button, Card, ErrorText, Field, inputClass, LoadError, Pending } from '../staf/-ui'
import { closeShift, loadCurrentShift, rupiah, type Shift } from './-api'
import { parseRupiah } from './-money'
import { KasirMain } from './-ui'

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
    const res = await closeShift({ data: amount }).catch(() => ({ ok: false as const, error: 'Gagal menutup shift, coba lagi.' }))
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setClosed(res.data)
  }

  return (
    <KasirMain title="Tutup shift">
      <div className="mx-auto max-w-md">
        <Card>
          {closed ? (
            <>
              <h2 className="text-lg font-medium text-ink">Shift ditutup</h2>
              <Summary shift={closed} />
              <Link to="/kasir" className="mt-4 block rounded-lg bg-brand px-4 py-3 text-center font-medium text-white">Buka shift baru</Link>
            </>
          ) : !shift ? (
            <div className="py-6 text-center">
              <p className="font-medium text-ink">Tidak ada shift yang terbuka</p>
              <Link to="/kasir" className="mt-2 inline-block text-brand hover:underline">Buka shift</Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-medium text-ink">Hitung uang di laci</h2>
              <dl className="mt-3 space-y-1 text-sm">
                <Row label="Dibuka" value={new Date(shift.openedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })} />
                <Row label="Uang awal" value={rupiah(shift.openingCash)} />
                <Row label={`Penjualan tunai (${shift.salesCount})`} value={rupiah(shift.cashSales)} />
                <Row label="Seharusnya di laci" value={rupiah(shift.expectedCash)} strong />
              </dl>
              <form onSubmit={submit} className="mt-4 space-y-4">
                <Field label="Uang yang dihitung (Rp)">
                  <input className={inputClass} inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0" autoFocus />
                </Field>
                <ErrorText>{error}</ErrorText>
                <Button type="submit" disabled={busy || counted.trim() === ''} className="w-full py-3">{busy ? 'Menutup…' : 'Tutup shift'}</Button>
              </form>
            </>
          )}
        </Card>
      </div>
    </KasirMain>
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
      <div className={`flex justify-between pt-2 text-base font-semibold ${diff === 0 ? 'text-success' : 'text-error'}`}>
        <dt>{diff === 0 ? 'Pas' : diff < 0 ? 'Kurang' : 'Lebih'}</dt>
        <dd>{rupiah(Math.abs(diff))}</dd>
      </div>
    </dl>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'pt-1 text-base font-semibold text-ink' : 'text-ink-muted'}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
