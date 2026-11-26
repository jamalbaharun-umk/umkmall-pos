import { createFileRoute, Link } from '@tanstack/react-router'
import { Alert, Button, Card, Text, TextField } from '@umkmall/ui'
import { useRef, useState } from 'react'
import { act, Empty, formatDate, LoadError, Page, Pending, rupiah, useConfirm } from '@/components/pos-page'
import { closeShift, loadCurrentShift, type Shift } from './-api'
import { cashDifference, parseRupiah } from './-money'
import { clockText, dayText, holdLabel } from './-online'
import { awaitingCloseText } from '@/lib/describe-error'
import { CLOSE_BLOCKED_HINT, drawerRows, isPendingPaymentRefusal, waitingSearch, type WaitingSale } from './-shift-helpers'

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
  const [waiting, setWaiting] = useState<WaitingSale[]>([])
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
    setWaiting([])
    ask(
      'Tutup shift?',
      async () => {
        lock.current = true
        setBusy(true)
        const r = await act(() => closeShift({ data: amount }), 'Shift ditutup', 'menutup shift')
        lock.current = false
        setBusy(false)
        if (!r.ok) {
          setError(r.errors.countedCash)
          const sales = (r.res as { waiting?: WaitingSale[] }).waiting ?? []
          if (sales.length > 0 || isPendingPaymentRefusal(r.error)) setBlocked(r.error)
          setWaiting(sales)
          return // `act` already opened the error dialog
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
                {awaitingCloseText(blocked).what}. {CLOSE_BLOCKED_HINT}
              </Alert>
            )}
            {waiting.length > 0 && <WaitingList sales={waiting} />}
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

/** The sales that hold the shift open, each with a link to its waiting screen in the register (UMK-2044). */
function WaitingList({ sales }: { sales: WaitingSale[] }) {
  const today = dayText(new Date().toISOString())
  return (
    <section aria-label="Penjualan yang menunggu pembayaran" className="mt-3 space-y-2">
      <ul className="space-y-2">
        {sales.map((w) => {
          const day = dayText(w.createdAt)
          const time = clockText(w.createdAt)
          // a sale held over midnight shares its number with today's: say which day it is of
          const other = w.holdToday === false || (w.holdToday === undefined && !!day && day !== today)
          return (
            <li key={w.id} className="flex items-center justify-between gap-3 rounded-lg border border-default-primary p-3 text-sm">
              <span>
                <b>{holdLabel(w.holdNumber)}</b>
                <span className="block text-xs text-default-secondary">
                  {rupiah(w.amountDue)}
                  {w.paymentMethod ? ` · ${w.paymentMethod}` : ''}
                  {other ? ` · ${w.holdDayLabel ?? day}${time ? ` ${time}` : ''}` : time ? ` · ${time}` : ''}
                </span>
              </span>
              <Button asChild type="outline" color="light" size="small" width="auto">
                <Link to="/kasir" search={waitingSearch(w.onlinePayment ? w.id : undefined)}>
                  {w.onlinePayment ? 'Buka' : 'Ke kasir'}
                </Link>
              </Button>
            </li>
          )
        })}
      </ul>
      <Button asChild type="text" size="small" width="auto">
        <Link to="/kasir" search={waitingSearch()}>
          Buka daftar Menunggu di kasir
        </Link>
      </Button>
    </section>
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
