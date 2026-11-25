import { createFileRoute, Link } from '@tanstack/react-router'
import { Alert, Button, Card, Text, TextField } from '@umkmall/ui'
import { useRef, useState } from 'react'
import { act, Empty, formatDate, LoadError, Page, Pending, rupiah, useConfirm } from '@/components/pos-page'
import { closeShift, loadCurrentShift, type Shift } from './-api'
import { cashDifference, parseRupiah } from './-money'
import { CLOSE_BLOCKED_HINT, drawerRows, isPendingPaymentRefusal } from './-shift-helpers'

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
  // pos-api refuses the close while a sale of the shift awaits payment: say which, and what to do.
  const [blocked, setBlocked] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false) // state lags a burst of clicks; the ref does not
  const [closed, setClosed] = useState<Shift>()

  const { ask, dialog } = useConfirm()

  // Closing cannot be undone: check the count, then confirm (the dialog stays busy until pos-api answers).
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (lock.current) return
    if (!counted.trim()) return setError('Wajib diisi')
    const amount = parseRupiah(counted)
    if (Number.isNaN(amount)) return setError('Harus bilangan bulat rupiah, misalnya 150.000')
    setError(undefined)
    setBlocked(undefined)
    ask(
      'Tutup shift?',
      async () => {
        lock.current = true
        setBusy(true)
        const r = await act(() => closeShift({ data: amount }), 'Shift ditutup')
        lock.current = false
        setBusy(false)
        if (!r.ok) {
          setError(r.errors.countedCash)
          if (isPendingPaymentRefusal(r.error)) setBlocked(r.error)
          return r.error
        }
        if (r.res.ok) setClosed(r.res.data)
      },
      {
        body: `Uang dihitung ${rupiah(amount)}, seharusnya ${rupiah(shift?.expectedCash ?? 0)} — ${differenceText(amount, shift?.expectedCash ?? 0)}. Shift yang ditutup tidak bisa dibuka lagi.`,
        label: 'Tutup shift',
      },
    )
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
              {drawerRows(shift).map((r) => (
                <Row key={r.key} label={r.label} value={`${r.sign}${rupiah(r.amount)}`} strong={r.strong} />
              ))}
            </dl>
            <p className="mt-2 text-xs text-default-secondary">
              Kasbon yang dibayar tunai di luar shift (oleh staf tanpa shift) masuk kas toko, bukan laci ini.
            </p>
            {blocked && (
              <Alert variant="danger" size="small" role="alert" className="mt-4">
                {blocked} {CLOSE_BLOCKED_HINT}
              </Alert>
            )}
            <form onSubmit={submit} noValidate className="mt-5 space-y-4">
              <TextField
                label="Uang yang dihitung"
                required
                error={error}
                prefix="Rp"
                inputMode="numeric"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                placeholder="0"
                autoFocus
              />
              <LiveDifference counted={counted} expected={shift.expectedCash} />
              <Button htmlType="submit" width="full" color="danger" isLoading={busy}>
                Tutup shift
              </Button>
              <Button asChild type="text" width="full">
                <Link to="/kasir">Kembali ke kasir</Link>
              </Button>
            </form>
          </>
        )}
      </Card>
      {dialog}
    </Page>
  )
}

const differenceText = (counted: number, expected: number) => {
  const d = cashDifference(counted, expected)
  return d.sign === 0 ? 'pas' : `${d.label.toLowerCase()} ${rupiah(d.amount)}`
}

/** The difference while the cashier counts (Moka/Majoo style): red when short, green when over or exact. */
function LiveDifference({ counted, expected }: { counted: string; expected: number }) {
  const n = parseRupiah(counted)
  if (!counted.trim() || Number.isNaN(n)) return null
  const d = cashDifference(n, expected)
  return (
    <p
      aria-live="polite"
      className={`flex justify-between text-sm font-bold ${d.sign < 0 ? 'text-default-error' : 'text-default-success'}`}
    >
      <span>Selisih: {d.label}</span>
      <span>{rupiah(d.amount)}</span>
    </p>
  )
}

function Summary({ shift }: { shift: Shift }) {
  const diff = shift.difference ?? 0
  return (
    <dl className="mt-3 space-y-1 text-sm">
      {drawerRows(shift).map((r) => (
        <Row key={r.key} label={r.label} value={`${r.sign}${rupiah(r.amount)}`} />
      ))}
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
