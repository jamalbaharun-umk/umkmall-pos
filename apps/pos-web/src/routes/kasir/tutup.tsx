import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Alert, Button, Card, Chip, Switch, Text, TextField } from '@umkmall/ui'
import { useRef, useState } from 'react'
import { act, Empty, formatDate, LoadError, Page, Pending, rupiah, useConfirm } from '@/components/pos-page'
import { closeShift, loadCurrentShift, type Shift } from './-api'
import { cashDifference, parseRupiah } from './-money'
import { clockText, dayText, holdLabel } from './-online'
import { awaitingCloseText } from '@/lib/describe-error'
import { notifySuccess, showError } from '@/lib/feedback'
import { ActionRow } from '@/components/action-row'
import { useSolo } from '@/components/shell'
import { closeDayToast, drawerDifferenceText, storeDayText, summaryUrl, takeOf, type DaySummary, type Keep } from './-close-day'
import { CLOSE_BLOCKED_HINT, drawerRows, drawerRowText, isPendingPaymentRefusal, sentence, waitingSearch, type WaitingSale } from './-shift-helpers'

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
  // UMK-2122: the owner who runs the store alone closes the day on one screen (design 41).
  const solo = useSolo()

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
        const r = await act(() => closeShift({ data: { countedCash: amount } }), 'Shift ditutup', 'menutup shift')
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

  if (solo && shift && !closed) return <CloseDayPage shift={shift} />

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
                <Row key={r.key} label={r.label} note={r.note} value={drawerRowText(r, rupiah)} strong={r.strong} />
              ))}
            </dl>
            <p className="mt-2 text-xs text-default-secondary">
              Kasbon yang dibayar tunai di luar shift (oleh staf tanpa shift) masuk kas toko, bukan laci ini.
            </p>
            {blocked && (
              <Alert variant="danger" size="small" role="alert" className="mt-4">
                {sentence(awaitingCloseText(blocked).what)} {CLOSE_BLOCKED_HINT}
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

type OpenShift = NonNullable<ReturnType<typeof Route.useLoaderData>['shift']>

/**
 * UMK-2122 "Tutup hari" (design 41), for the owner of a store without staff: count the drawer and see the day's
 * sales and profit (tax excluded), then keep the cash in the drawer for tomorrow or take some home. pos-api writes
 * the take as "Diambil pemilik" and closes in one step, so tomorrow's automatic opening is what stays. The count
 * stays required and a sale awaiting payment still blocks the close (pos-api's 409, shown with the waiting sales).
 */
function CloseDayPage({ shift }: { shift: OpenShift }) {
  const [step, setStep] = useState<'count' | 'money' | 'done'>('count')
  const [counted, setCounted] = useState('')
  const [countError, setCountError] = useState<string>()
  const [keep, setKeep] = useState<Keep>('keep')
  const [takeText, setTakeText] = useState('')
  const [takeError, setTakeError] = useState<string>()
  // Design 41: the WhatsApp summary is on by default and can be turned off.
  const [sendSummary, setSendSummary] = useState(true)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [blocked, setBlocked] = useState<string>()
  const [waiting, setWaiting] = useState<WaitingSale[]>([])
  const [result, setResult] = useState<DaySummary & { shiftId: string }>()
  const amount = parseRupiah(counted)
  const revenue = shift.revenue ?? 0
  const profit = shift.grossProfit ?? 0
  const take = takeOf(keep, takeText, Number.isNaN(amount) ? 0 : amount)
  const { ask, dialog } = useConfirm()
  const router = useRouter()

  function next(e: React.FormEvent) {
    e.preventDefault()
    if (!counted.trim()) return setCountError('Wajib diisi')
    if (Number.isNaN(amount)) return setCountError('Harus bilangan bulat rupiah, misalnya 150.000')
    setCountError(undefined)
    setStep('money')
  }

  // Closing cannot be undone: check the take, then confirm (the dialog stays busy until pos-api answers).
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (lock.current) return
    if (take.error) {
      setTakeError(take.error)
      return showError({ status: 422, error: take.error }, { action: 'menutup hari' })
    }
    setTakeError(undefined)
    ask('Tutup hari?', close, {
      body: `${take.amount > 0 ? `Diambil pemilik ${rupiah(take.amount)}, t` : 'T'}inggal di laci untuk besok ${rupiah(amount - take.amount)}. Hari yang ditutup tidak bisa dibuka lagi.`,
      label: 'Tutup hari',
      color: 'primary',
      action: 'menutup hari',
    })
  }

  async function close() {
    if (lock.current) return
    setBlocked(undefined)
    setWaiting([])
    lock.current = true
    setBusy(true)
    // The close names the shift the owner counted: if a sale opened another one meanwhile, pos-api refuses
    // (409 shift_changed) instead of closing the new shift with this count and take.
    const res = await closeShift({
      data: { countedCash: amount, shiftId: shift.id, ...(take.amount > 0 ? { ownerTakes: take.amount } : {}) },
    }).catch(() => ({ ok: false as const, status: 0, error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.', errors: undefined }))
    lock.current = false
    setBusy(false)
    if (!res.ok) {
      showError(res, { action: 'menutup hari' })
      const errors = (res as { errors?: Record<string, string> }).errors ?? {}
      if (errors.ownerTakes) setTakeError(errors.ownerTakes)
      if (errors.countedCash) {
        setCountError(errors.countedCash)
        setStep('count')
      }
      const sales = (res as { waiting?: WaitingSale[] }).waiting ?? []
      if (sales.length > 0 || isPendingPaymentRefusal(res.error)) setBlocked(res.error)
      setWaiting(sales)
      if ((res as { code?: string }).code === 'shift_changed') void router.invalidate()
      return
    }
    const difference = res.data.difference ?? 0
    notifySuccess(closeDayToast(difference))
    setResult({
      shiftId: res.data.id,
      openedAt: shift.openedAt,
      revenue: res.data.revenue ?? revenue,
      grossProfit: res.data.grossProfit ?? profit,
      counted: amount,
      taken: take.amount,
      difference,
    })
    setStep('done')
  }

  return (
    <Page crumbs={[{ label: 'Kasir', to: '/kasir' }, { label: 'Tutup hari' }]} title="Tutup hari">
      <Card variant="outlined" padding="large" className="max-w-md space-y-4">
        {step === 'done' && result ? (
          <>
            <Text as="h2" variant="h5" weight="bold">
              Hari ditutup
            </Text>
            <p className="text-sm text-default-secondary">
              {drawerDifferenceText(result.difference)}. Uang awal besok {rupiah(result.counted - result.taken)}.
            </p>
            <dl className="space-y-1 text-sm">
              <Row label="Penjualan" value={rupiah(result.revenue)} />
              <Row label="Untung hari ini" value={rupiah(result.grossProfit)} strong />
              {result.taken > 0 && <Row label="Diambil pemilik" value={rupiah(result.taken)} />}
            </dl>
            <ActionRow>
              {sendSummary ? (
                <Button asChild type="outline" color="primary" width="auto">
                  <a href={summaryUrl(result)} target="_blank" rel="noopener noreferrer">
                    Kirim ke WhatsApp
                  </a>
                </Button>
              ) : (
                <Button asChild type="outline" color="primary" width="auto">
                  <Link to="/kasir/shift/$id" params={{ id: result.shiftId }}>
                    Lihat ringkasan
                  </Link>
                </Button>
              )}
              <Button asChild width="auto">
                <Link to="/">Selesai</Link>
              </Button>
            </ActionRow>
          </>
        ) : (
          <>
            <p className="text-sm text-default-secondary">{storeDayText(shift.openedAt)}</p>
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Penjualan" value={rupiah(revenue)} />
              <Stat label="Untung hari ini" value={rupiah(profit)} />
            </dl>
            {blocked && (
              <Alert variant="danger" size="small" role="alert">
                {sentence(awaitingCloseText(blocked).what)} {CLOSE_BLOCKED_HINT}
              </Alert>
            )}
            {waiting.length > 0 && <WaitingList sales={waiting} />}
            {step === 'count' ? (
              <form onSubmit={next} noValidate className="space-y-4">
                <TextField
                  label="Uang di laci (hitungan Anda)"
                  required
                  error={countError}
                  prefix="Rp"
                  inputMode="numeric"
                  value={counted}
                  onChange={(e) => {
                    setCounted(e.target.value)
                    setCountError(undefined)
                  }}
                  placeholder="0"
                  autoFocus
                />
                <dl className="space-y-1 text-sm">
                  <Row label="Seharusnya ada" value={rupiah(shift.expectedCash)} />
                </dl>
                <LiveDifference counted={counted} expected={shift.expectedCash} />
                <p className="text-xs text-default-secondary">Untung tidak termasuk pajak.</p>
                <ActionRow>
                  <Button asChild type="outline" color="light" width="auto">
                    <Link to="/kasir">Batal</Link>
                  </Button>
                  <Button htmlType="submit" width="auto">
                    Lanjut
                  </Button>
                </ActionRow>
              </form>
            ) : (
              <form onSubmit={submit} noValidate className="space-y-4">
                <dl className="space-y-1 text-sm">
                  <Row label="Di laci" value={rupiah(amount)} strong />
                </dl>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm text-default-secondary">Uang malam ini</legend>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ['keep', 'Simpan di laci'],
                        ['take', 'Diambil pemilik'],
                      ] as const
                    ).map(([value, label]) => (
                      <Chip
                        key={value}
                        state={keep === value ? 'active' : 'default'}
                        aria-pressed={keep === value}
                        onClick={() => {
                          setKeep(value)
                          setTakeError(undefined)
                        }}
                      >
                        {label}
                      </Chip>
                    ))}
                  </div>
                </fieldset>
                {keep === 'take' && (
                  <TextField
                    label="Jumlah diambil"
                    required
                    error={takeError}
                    prefix="Rp"
                    inputMode="numeric"
                    value={takeText}
                    onChange={(e) => {
                      setTakeText(e.target.value)
                      setTakeError(undefined)
                    }}
                    placeholder="0"
                    autoFocus
                  />
                )}
                <dl className="space-y-1 text-sm">
                  <Row label="Tinggal di laci untuk besok" value={rupiah(amount - take.amount)} strong />
                </dl>
                <Switch label="Kirim ringkasan ke WhatsApp" checked={sendSummary} onCheckedChange={setSendSummary} />
                <ActionRow>
                  <Button type="outline" color="light" width="auto" disabled={busy} onClick={() => setStep('count')}>
                    Kembali
                  </Button>
                  <Button htmlType="submit" width="auto" isLoading={busy}>
                    Tutup hari
                  </Button>
                </ActionRow>
              </form>
            )}
          </>
        )}
      </Card>
      {dialog}
    </Page>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-default-primary p-3">
      <dt className="text-xs text-default-secondary">{label}</dt>
      <dd className="text-lg font-bold">{value}</dd>
    </div>
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
        <Row key={r.key} label={r.label} note={r.note} value={drawerRowText(r, rupiah)} />
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

function Row({ label, value, strong, note }: { label: string; value: string; strong?: boolean; note?: string }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'pt-1 text-base font-bold' : 'text-default-secondary'}`}>
      <dt>
        {label}
        {note && <span className="block text-xs">{note}</span>}
      </dt>
      <dd>{value}</dd>
    </div>
  )
}
