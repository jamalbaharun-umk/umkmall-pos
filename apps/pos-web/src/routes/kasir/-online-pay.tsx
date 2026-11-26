import { useNavigate } from '@tanstack/react-router'
import { Alert, Badge, Button, Dialog, Icon, Spinner, Text, TextField } from '@umkmall/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfirm } from '@/components/confirm'
import { rupiah } from '@/components/pos-page'
import { notifySuccess, showError, type FailureLike } from '@/lib/feedback'
import {
  loadAwaitingSales,
  loadPaidFigures,
  type AwaitingSale,
  cancelSalePayment,
  checkSalePayment,
  getSalePayment,
  paySaleInCash,
} from './-online-api'
import {
  OPEN_PAST_CODE_TIME,
  POLL_MS,
  resumeDecision,
  type ResumeDecision,
  agoText,
  cashSwitchWarning,
  isLink,
  vaGroups,
  waitingFor,
  cancelBody,
  cashDue,
  cashPaidToSend,
  clockText,
  closedText,
  countdown,
  gatewayLabel,
  isQris,
  keepPolling,
  lateReceiptText,
  outcomeOf,
  type SalePayment,
} from './-online'
import { parseRupiah, quickAmounts } from './-money'
import { NOT_STORED_TEXT } from './-pending'
import { QUIET_ZONE, qrMatrix, qrPath } from './-qr'
import { useLost } from './-use-lost'

export type OnlineFinish =
  | { kind: 'paid'; saleId: string }
  /** `again`: the bill ended unpaid (expired or failed), so the cashier is taken straight to choosing another way to pay. */
  | { kind: 'closed'; saleId: string; again: boolean }

/** The QR of a dynamic QRIS, drawn from its string on a white card (a scanner needs the light margin in dark mode too). */
export function QrCode({ value }: { value: string }) {
  const drawn = useMemo(() => {
    try {
      const m = qrMatrix(value)
      return { size: m.length, d: qrPath(m) }
    } catch {
      return null
    }
  }, [value])
  if (!drawn)
    return (
      <Alert variant="danger" size="small" role="alert">
        Kode QR tidak bisa ditampilkan. Batalkan penjualan ini lalu coba lagi.
      </Alert>
    )
  const pad = QUIET_ZONE
  const box = drawn.size + pad * 2
  return (
    <svg
      role="img"
      aria-label="Kode QRIS pembayaran"
      viewBox={`${-pad} ${-pad} ${box} ${box}`}
      shapeRendering="crispEdges"
      className="mx-auto aspect-square w-full max-w-64 rounded-lg bg-white text-black"
    >
      <path d={drawn.d} fill="currentColor" />
    </svg>
  )
}

/**
 * "Menunggu pembayaran" (UMK-1991): the QR or the VA number of a sale that waits for its payment gateway payment, the
 * 15-minute countdown, and the cashier's actions: Cek status, Ganti ke tunai, Batalkan. pos-api owns every status; this
 * screen asks every 3 seconds and shows what it answers. It cannot be dismissed while the payment is open, because an
 * awaiting sale is in no list: it ends by payment, by cash, by cancel or by pos-api's own expiry.
 */
export function OnlineWait({
  initial,
  own,
  onFinish,
}: {
  initial: SalePayment
  /** The sale was made from the order in the register's cart (false: picked from the list of waiting sales). */
  own: boolean
  onFinish: (r: OnlineFinish) => void
}) {
  const navigate = useNavigate()
  const lost = useLost()
  const id = initial.saleId
  const [payment, setPayment] = useState(initial)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<null | 'check' | 'cancel' | 'cash'>(null)
  // A sale pos-api already turned into cash (reload after the intent) goes straight to the cash form.
  const [mode, setMode] = useState<'wait' | 'cash'>(initial.method === 'cash' ? 'cash' : 'wait')
  const [cashText, setCashText] = useState('')
  const [cashError, setCashError] = useState<string>()
  // pos-api answered that the sale IS a cash sale and only its record is missing: the cashier repeats, never goes back.
  const [cashPending, setCashPending] = useState(initial.method === 'cash')
  // The cash and change the completed cash sale recorded: read from the server, never worked out from the typed text.
  const [figures, setFigures] = useState<{ s: 'loading' } | { s: 'error' } | { s: 'ready'; paid: number; change: number }>({ s: 'loading' })
  const [figuresTry, setFiguresTry] = useState(0)
  // pos-api refused the cash switch because another cashier's sale cannot be taken in cash: the button goes away.
  const [notMine, setNotMine] = useState(false)
  const [fails, setFails] = useState(0)
  const lock = useRef(false) // a double tap arrives before `busy` re-renders
  const seq = useRef(0) // an answer to an older request never overwrites a newer one
  const announced = useRef(false)
  const confirm = useConfirm()

  const outcome = outcomeOf(payment)
  const polling = keepPolling(payment)
  const waiting = outcome.kind === 'waiting'

  const apply = (p: SalePayment) => {
    seq.current += 1
    setPayment(p)
  }

  // The sale stays in the register's memory (`-pending.ts`) until this screen is closed after its end: nothing here
  // remembers or forgets it.

  // The poll: one request at a time, none while an action is running, results of an older request dropped.
  useEffect(() => {
    if (!polling) return
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (!lock.current) {
        const at = seq.current
        const r = await getSalePayment({ data: id }).catch(lost)
        if (stop) return
        if (r?.ok) {
          if (seq.current === at) setPayment(r.data)
          setFails(0)
        } else setFails((n) => n + 1)
      }
      timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, POLL_MS)
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [polling, id])

  useEffect(() => {
    if (!waiting || !payment.expiresAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [waiting, payment.expiresAt])

  // pos-api turned the sale into a cash sale (another screen, or the first request before a reload): follow it.
  useEffect(() => {
    if (waiting && payment.method === 'cash') {
      setMode('cash')
      setCashPending(true)
    }
  }, [waiting, payment.method])

  // A cash sale that is complete: the paid amount and change come from the sale itself.
  const cashDone = outcome.kind === 'paid' && outcome.cash && outcome.completed
  useEffect(() => {
    if (!cashDone) return
    let gone = false
    setFigures({ s: 'loading' })
    loadPaidFigures({ data: id })
      .then((r) => !gone && setFigures(r.ok ? { s: 'ready', ...r.data } : { s: 'error' }))
      .catch((e) => {
        lost(e)
        if (!gone) setFigures({ s: 'error' })
      })
    return () => {
      gone = true
    }
  }, [cashDone, id, figuresTry])

  // The customer paid: say so once, when the sale is complete (not when only the payment is paid).
  useEffect(() => {
    if (outcome.kind === 'paid' && outcome.completed && !announced.current) {
      announced.current = true
      notifySuccess(
        `Pembayaran ${payment.paymentMethodName || gatewayLabel(payment.method)} ${rupiah(payment.amount)} diterima. Struk #${payment.saleNumber}`,
      )
    }
  }, [outcome.kind, outcome.kind === 'paid' && outcome.completed, payment.amount])

  const left = countdown(payment.expiresAt, now)
  const ago = agoText(payment.lastCheckedAt, now)

  async function check() {
    if (lock.current) return
    lock.current = true
    setBusy('check')
    const r = await checkSalePayment({ data: id }).catch(lost)
    lock.current = false
    setBusy(null)
    if (!r || !r.ok) return showError(r?.failure ?? { status: 0 }, { action: 'memeriksa status pembayaran', retry: () => void check() })
    apply(r.data)
    setFails(0)
    if (outcomeOf(r.data).kind === 'waiting') notifySuccess('Status diperiksa. Belum ada pembayaran masuk.')
  }

  async function refetch() {
    const r = await getSalePayment({ data: id }).catch(lost)
    if (r?.ok) apply(r.data)
  }

  function askCancel() {
    if (lock.current) return
    confirm.ask(
      'Batalkan pembayaran ini?',
      async (): Promise<FailureLike | void> => {
        lock.current = true
        setBusy('cancel')
        const r = await cancelSalePayment({ data: id }).catch(lost)
        lock.current = false
        setBusy(null)
        if (!r) return { status: 0 }
        if (!r.ok) {
          // The customer paid first, or the sale already ended: show the true state next to the explanation.
          if (r.failure.code === 'already_paid' || r.failure.code === 'not_awaiting') await refetch()
          return r.failure
        }
        apply(r.data)
        notifySuccess('Pembayaran dibatalkan. Stok dikembalikan.')
      },
      {
        label: expiredOpen ? 'Batalkan penjualan' : 'Batalkan pembayaran',
        action: 'membatalkan pembayaran',
        body: cancelBody(payment, rupiah),
      },
    )
  }

  async function saveCash() {
    if (lock.current) return
    // Once the intent exists nothing typed is required: the request is only repeated (the field is gone after a reload).
    const checked = cashPaidToSend(cashPending, cashText, payment.amount)
    setCashError('error' in checked ? checked.error : undefined)
    if ('error' in checked) return
    const paid = checked.paid
    lock.current = true
    setBusy('cash')
    const r = await paySaleInCash({ data: { id, paid } }).catch(lost)
    lock.current = false
    setBusy(null)
    if (!r || !r.ok) {
      const failure = r?.failure ?? { status: 0 }
      if (failure.code === 'cash_payment_pending') setCashPending(true)
      if (failure.code === 'not_own_sale') {
        setNotMine(true)
        setMode('wait')
      }
      // The customer paid the QR first (the sale is complete as a QR sale), or the bill is gone: show the true state.
      if (failure.code === 'already_paid' || failure.code === 'not_awaiting') {
        setMode('wait')
        await refetch()
      }
      // The answer was lost: nothing changed, and the bill may be closed. Back to the waiting screen to check first.
      if (failure.code === 'cash_switch_unanswered') setMode('wait')
      return showError(failure, { action: 'mengganti ke tunai', retry: failure.status === 0 || failure.code === 'cash_payment_pending' ? () => void saveCash() : undefined })
    }
    announced.current = true
    apply(r.data)
    notifySuccess('Penjualan dibayar tunai')
  }

  const finish = (kind: OnlineFinish['kind'], print = false) => {
    onFinish(
      kind === 'paid'
        ? { kind, saleId: id }
        : { kind, saleId: id, again: own && outcome.kind === 'closed' && outcome.why !== 'cancelled' },
    )
    if (print) void navigate({ to: '/kasir/struk/$id', params: { id } })
  }

  const done = outcome.kind !== 'waiting' && !(outcome.kind === 'paid' && !outcome.completed)
  const expiredOpen = waiting && payment.checkoutExpired
  const title =
    outcome.kind === 'paid'
      ? outcome.cash
        ? 'Dibayar tunai'
        : 'Pembayaran diterima'
      : outcome.kind === 'closed'
        ? closedText(outcome.why, own).title
        : expiredOpen
          ? OPEN_PAST_CODE_TIME.title
          : 'Menunggu pembayaran'
  const method = payment.paymentMethodName || gatewayLabel(payment.method)

  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => !o && done && finish(outcome.kind === 'paid' ? 'paid' : 'closed')}
        dismissible={done}
        size="medium"
        label={title}
      >
        <div className="flex max-h-[88dvh] flex-col gap-4 overflow-y-auto p-6">
          {/* Only the state changes are announced; the clock text ("Terakhir dicek") is outside any live region. */}
          <p className="sr-only" role="status" aria-live="polite">
            {outcome.kind === 'paid' ? (outcome.completed ? 'Pembayaran diterima' : 'Pembayaran masuk, menyelesaikan penjualan') : outcome.kind === 'closed' ? closedText(outcome.why, own).title : ''}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Text as="h2" variant="h4" weight="bold">
              {title}
            </Text>
            <Badge color={outcome.kind === 'paid' ? 'success' : outcome.kind === 'closed' ? 'danger' : 'warning'} size="small">
              {outcome.kind === 'waiting' ? 'Menunggu' : 'Struk'} #{payment.saleNumber}
            </Badge>
          </div>

          {outcome.kind === 'paid' && (
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <span className="text-default-success">
                <Icon name="check-circle" size="xl" />
              </span>
              <Text variant="h4" weight="bold">
                {rupiah(payment.amount)}
              </Text>
              {!outcome.completed ? (
                <p className="flex items-center gap-2 text-sm text-default-secondary" role="status">
                  <Spinner size="sm" /> Menyelesaikan penjualan…
                </p>
              ) : outcome.cash ? (
                figures.s === 'ready' ? (
                  <div className="text-default-secondary" role="status">
                    <p>
                      Uang diterima: <strong>{rupiah(figures.paid)}</strong>
                    </p>
                    <p>
                      Kembalian: <strong>{rupiah(figures.change)}</strong>
                    </p>
                  </div>
                ) : figures.s === 'loading' ? (
                  <p className="flex items-center gap-2 text-sm text-default-secondary" role="status">
                    <Spinner size="sm" /> Mengambil kembalian dari penjualan…
                  </p>
                ) : (
                  <Alert
                    variant="warning"
                    size="small"
                    role="alert"
                    action={
                      <Button type="outline" color="light" size="small" width="auto" onClick={() => setFiguresTry((n) => n + 1)}>
                        Coba lagi
                      </Button>
                    }
                  >
                    Kembalian belum bisa dimuat. Lihat di struk sebelum menyerahkan uang kembali.
                  </Alert>
                )
              ) : (
                <>
                  <p className="font-semibold">Lunas lewat {method}</p>
                  <p className="text-sm text-default-secondary">Struk #{payment.saleNumber}</p>
                  <dl className="mt-2 w-full max-w-xs space-y-1 text-left text-sm">
                    <div className="flex justify-between gap-3">
                      <dt>Metode</dt>
                      <dd className="font-semibold">{method}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Biaya gateway</dt>
                      <dd className="text-right">dicatat terpisah, tidak mengurangi total</dd>
                    </div>
                  </dl>
                </>
              )}
            </div>
          )}

          {outcome.kind === 'closed' && (
            <Alert variant={outcome.why === 'cancelled' ? 'warning' : 'danger'} size="small" role="status">
              <span className="font-semibold">{closedText(outcome.why, own).title}.</span> {closedText(outcome.why, own).body}
            </Alert>
          )}

          {waiting && mode === 'wait' && (
            <>
              {expiredOpen && (
                <Alert variant="warning" size="small" role="status">
                  {OPEN_PAST_CODE_TIME.body}
                </Alert>
              )}
              <div className="text-center">
                <p className="text-sm text-default-secondary">
                  Menunggu #{payment.saleNumber} · {method}
                </p>
                <Text variant="h3" weight="bold">
                  {rupiah(payment.amount)}
                </Text>
                <p className="text-xs text-default-secondary">Tanpa pembulatan: pembulatan hanya untuk tunai</p>
              </div>

              {isQris(payment.checkout) ? (
                <QrCode value={payment.checkout.qrString} />
              ) : isLink(payment.checkout) ? (
                <div className="space-y-2 rounded-lg border border-default-primary p-4" aria-label="Halaman bayar gateway">
                  <p className="text-sm text-default-secondary">Bayar lewat halaman gateway</p>
                  <p className="break-all font-semibold">{payment.checkout.paymentUrl}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild type="outline" color="light" size="small" width="auto">
                      <a href={payment.checkout.paymentUrl} target="_blank" rel="noopener noreferrer">
                        Buka halaman bayar
                      </a>
                    </Button>
                    <Button
                      type="outline"
                      color="light"
                      size="small"
                      width="auto"
                      onClick={() => {
                        const url = payment.checkout && 'paymentUrl' in payment.checkout ? payment.checkout.paymentUrl : ''
                        const share = typeof navigator.share === 'function' ? navigator.share({ url }) : navigator.clipboard.writeText(url)
                        share.then(
                          () => notifySuccess('Tautan dibagikan'),
                          (e: unknown) => {
                            // closing the share sheet is not a failure
                            if (e instanceof DOMException && e.name === 'AbortError') return
                            showError({ error: 'Tautan tidak bisa dibagikan. Salin dari layar.' }, 'membagikan tautan')
                          },
                        )
                      }}
                    >
                      Bagikan tautan
                    </Button>
                  </div>
                </div>
              ) : payment.checkout ? (
                <div className="rounded-lg border border-default-primary p-4" aria-label="Nomor Virtual Account">
                  <div className="flex justify-between text-sm">
                    <span>Bank</span>
                    <span className="font-semibold">{payment.checkout.bank || '-'}</span>
                  </div>
                  <p className="mt-2 text-sm text-default-secondary">Nomor Virtual Account</p>
                  <p className="my-1 break-all font-mono text-2xl font-bold tracking-wider">{vaGroups(payment.checkout.vaNumber)}</p>
                  <Button
                    type="outline"
                    color="light"
                    size="small"
                    width="auto"
                    onClick={() => {
                      const va = payment.checkout && 'vaNumber' in payment.checkout ? payment.checkout.vaNumber : ''
                      navigator.clipboard.writeText(va).then(
                        () => notifySuccess('Nomor VA disalin'),
                        () =>
                          showError(
                            { error: 'Browser tidak mengizinkan menyalin. Salin nomornya dengan menekan lama.' },
                            'menyalin nomor VA',
                          ),
                      )
                    }}
                  >
                    <Icon name="copy" size="sm" /> Salin nomor
                  </Button>
                </div>
              ) : (
                <Alert variant="warning" size="small" role="alert">
                  Kode bayar belum tersedia. Tekan Cek status pembayaran; bila tetap kosong, batalkan lalu coba lagi.
                </Alert>
              )}

              {left && (
                <Alert variant={left.over ? 'danger' : 'warning'} size="small" role="timer">
                  <span className="block text-center">
                    {left.over ? 'Menurut jam layar ini, batas waktu kode sudah lewat' : <>Berlaku <b>{left.text}</b> lagi</>}
                  </span>
                </Alert>
              )}
              <p className="text-center text-xs text-default-secondary">
                {payment.checkout && 'vaNumber' in payment.checkout
                  ? 'Pelanggan memasukkan nomor ini di aplikasi bank; nominalnya sudah terisi. '
                  : isQris(payment.checkout)
                    ? 'Pelanggan scan dari aplikasi bank atau e-wallet mana pun. '
                    : ''}
                Status dicek otomatis tiap {POLL_MS / 1000} detik
                {ago ? `. Terakhir dicek ${ago}` : ''}. Jangan tutup layar ini.
              </p>

              {payment.switchingToCash && (
                <Alert variant="info" size="small" role="status">
                  Perpindahan ke tunai belum selesai. Tekan Cek status. Bila tetap begini, Anda bisa mengulang Ganti ke
                  tunai atau membatalkan pembayaran ini.
                </Alert>
              )}
              {fails >= 3 && (
                <Alert variant="warning" size="small" role="alert">
                  Status belum bisa diperiksa (sambungan terputus). Layar mencoba lagi sendiri. Pembayaran tidak hilang.
                </Alert>
              )}
            </>
          )}

          {waiting && mode === 'cash' && (
            <div className="space-y-3">
              {!cashPending && (
                <>
                  <Text as="h3" variant="h5" weight="bold">
                    Ganti ke tunai?
                  </Text>
                  <p className="text-sm text-default-secondary">
                    Tagihan ditutup dan stok tetap ditahan. Total tunai dibulatkan ke atas ke Rp100:{' '}
                    <b>{rupiah(cashDue(payment.amount))}</b>.
                  </p>
                  {cashSwitchWarning(payment) && (
                    <Alert variant="warning" size="small">
                      {cashSwitchWarning(payment)}
                    </Alert>
                  )}
                </>
              )}
              {cashPending ? (
                <Alert variant="warning" size="small" role="alert">
                  Penjualan ini sudah menjadi tunai, tetapi catatan uangnya belum tersimpan. Tekan Simpan tunai lagi
                  sampai berhasil.
                </Alert>
              ) : (
                <Alert variant="info" size="small">
                  Bila pelanggan ternyata sudah membayar lewat gateway, penjualan selesai dengan pembayaran itu dan uang
                  tunai Anda dikembalikan.
                </Alert>
              )}
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt>Total</dt>
                  <dd className="font-semibold">{rupiah(payment.amount)}</dd>
                </div>
                {cashDue(payment.amount) !== payment.amount && (
                  <div className="flex justify-between">
                    <dt>Harus dibayar tunai (dibulatkan ke Rp100)</dt>
                    <dd className="font-semibold">{rupiah(cashDue(payment.amount))}</dd>
                  </div>
                )}
              </dl>
              {!cashPending && (
              <TextField
                label="Uang diterima"
                prefix="Rp"
                inputMode="numeric"
                value={cashText}
                onChange={(e) => {
                  setCashText(e.target.value)
                  setCashError(undefined)
                }}
                error={cashError}
                placeholder="0"
                autoFocus
              />
              )}
              {cashPending && (
                <p className="text-sm text-default-secondary">
                  Jumlah uang yang Anda terima sudah dicatat sebagai bagian dari penjualan ini; tidak perlu mengisinya lagi.
                </p>
              )}
              <div className="flex flex-wrap gap-2" aria-label="Nominal cepat" hidden={cashPending}>
                {quickAmounts(cashDue(payment.amount)).map((n) => (
                  <Button
                    key={n}
                    width="auto"
                    size="small"
                    type={parseRupiah(cashText) === n ? 'primary' : 'outline'}
                    color={parseRupiah(cashText) === n ? 'primary' : 'light'}
                    disabled={busy !== null || cashPending}
                    onClick={() => {
                      setCashText(String(n))
                      setCashError(undefined)
                    }}
                  >
                    {n === cashDue(payment.amount) ? 'Uang pas' : rupiah(n)}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {payment.lateReceipts.length > 0 && (
            <Alert variant="warning" size="small" role="status">
              <span className="font-semibold">Pembayaran terlambat.</span> Pelanggan membayar kode yang sudah ditutup atau
              kedaluwarsa, padahal penjualannya sudah dibatalkan atau selesai dengan cara lain. Uang dikembalikan otomatis;
              Anda tidak perlu berbuat apa-apa.
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {payment.lateReceipts.map((r) => (
                  <li key={r.id}>{lateReceiptText(r, rupiah)}</li>
                ))}
              </ul>
            </Alert>
          )}

          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
            {waiting && mode === 'wait' && (
              <>
                <Button width="auto" className="w-full sm:w-auto" isLoading={busy === 'check'} disabled={busy !== null} onClick={() => void check()}>
                  Cek status pembayaran
                </Button>
                {!notMine && (
                  <Button
                    width="auto"
                    className="w-full sm:w-auto"
                    type="outline"
                    color="light"
                    disabled={busy !== null}
                    onClick={() => setMode('cash')}
                  >
                    Ganti ke tunai
                  </Button>
                )}
                <Button
                  width="auto"
                  className="w-full sm:w-auto"
                  type="text"
                  color="danger"
                  disabled={busy !== null}
                  onClick={askCancel}
                >
                  {expiredOpen ? 'Batalkan penjualan' : 'Batalkan pembayaran'}
                </Button>
              </>
            )}
            {waiting && mode === 'cash' && (
              <>
                <Button width="auto" className="w-full sm:w-auto" isLoading={busy === 'cash'} disabled={busy !== null} onClick={() => void saveCash()}>
                  {cashPending ? 'Simpan tunai lagi' : 'Simpan tunai'}
                </Button>
                {!cashPending ? (
                  <Button
                    width="auto"
                    className="w-full sm:w-auto"
                    type="outline"
                    color="light"
                    disabled={busy !== null}
                    onClick={() => {
                      setMode('wait')
                      setCashError(undefined)
                    }}
                  >
                    Kembali ke QR
                  </Button>
                ) : (
                  <Button
                    width="auto"
                    className="w-full sm:w-auto"
                    type="text"
                    color="danger"
                    disabled={busy !== null}
                    onClick={askCancel}
                  >
                    Batalkan pembayaran
                  </Button>
                )}
              </>
            )}
            {outcome.kind === 'paid' && outcome.completed && (
              <>
                <Button width="auto" className="w-full sm:w-auto" onClick={() => finish('paid')}>
                  Penjualan baru
                </Button>
                <Button width="auto" className="w-full sm:w-auto" type="outline" color="light" onClick={() => finish('paid', true)}>
                  Cetak struk
                </Button>
              </>
            )}
            {outcome.kind === 'closed' && (
              <Button width="auto" className="w-full sm:w-auto" onClick={() => finish('closed')}>
                {!own ? 'Tutup' : outcome.why === 'cancelled' ? 'Kembali ke keranjang' : 'Pilih cara bayar lain'}
              </Button>
            )}
          </div>
        </div>
      </Dialog>
      {confirm.dialog}
    </>
  )
}

const RESUME_RETRY_MS = 5000
/** `api()` has no timeout of its own: a check that hangs counts as "no answer" and is asked again. */
const RESUME_TIMEOUT_MS = 10_000

const orNullAfter = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(null)
      },
    )
  })

/**
 * Asks pos-api about every sale the register still has to check (`toCheck` of `-pending.ts`: after a reload, or after
 * an answer that could not be used), one at a time, and hands each answer to `onDecision` (reviewed in
 * `resumeDecision`). It keeps asking every 5 s while any is left, also while the cashier went on with cash. What an
 * answer means for the memory and the cart is decided by the register, not here.
 */
export function useResumeChecks(ids: string[], onDecision: (saleId: string, d: ResumeDecision) => void): { retry: () => void } {
  const lost = useLost()
  const [attempt, setAttempt] = useState(0)
  const handler = useRef(onDecision)
  handler.current = onDecision
  const wanted = ids.join(',')
  useEffect(() => {
    if (!wanted) return
    let gone = false
    let timer: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      for (const id of wanted.split(',')) {
        const answer = await orNullAfter(getSalePayment({ data: id }).catch(lost), RESUME_TIMEOUT_MS)
        if (gone) return
        handler.current(id, resumeDecision(answer))
        if (gone) return // the answer changed the list: the next run asks about the rest
      }
      timer = setTimeout(() => setAttempt((n) => n + 1), RESUME_RETRY_MS)
    })()
    return () => {
      gone = true
      clearTimeout(timer)
    }
  }, [wanted, attempt])
  return { retry: () => setAttempt((n) => n + 1) }
}

/**
 * Blocks the register while a remembered sale is unchecked: no new online sale can start until it is. The buttons are
 * there from the start (a check that hangs must not block cash), and "Lanjut tunai saja" only puts this dialog aside:
 * the sale stays remembered and the check goes on.
 */
export function ResumeGate({ gate, onRetry, onAside }: { gate: 'none' | 'checking' | 'unreachable'; onRetry: () => void; onAside: () => void }) {
  if (gate === 'none') return null
  return (
    <Dialog open onOpenChange={() => undefined} dismissible={false} size="small" label="Memeriksa pembayaran sebelumnya">
      <div className="flex flex-col gap-3 p-6" role="status">
        <Text as="h2" variant="h5" weight="bold">
          Memeriksa pembayaran sebelumnya
        </Text>
        {gate === 'checking' ? (
          <p className="flex items-center gap-2 text-sm text-default-secondary">
            <Spinner size="sm" /> Mencari penjualan yang masih menunggu pembayaran…
          </p>
        ) : (
          <Alert variant="warning" size="small" role="alert">
            Penjualan sebelumnya belum bisa diperiksa (sambungan terputus). Kode bayarnya mungkin masih bisa dibayar,
            jadi penjualan online baru belum dibuka. Layar mencoba lagi sendiri.
          </Alert>
        )}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button width="auto" className="w-full sm:w-auto" onClick={onRetry}>
            Coba lagi sekarang
          </Button>
          <Button width="auto" className="w-full sm:w-auto" type="outline" color="light" onClick={onAside}>
            Lanjut tunai saja
          </Button>
        </div>
        <p className="text-xs text-default-secondary">
          Lanjut tunai saja: penjualan online ditahan, penjualan sebelumnya tetap ada di Menunggu, dan layar ini terus
          memeriksanya.
        </p>
      </div>
    </Dialog>
  )
}

/**
 * "Menunggu pembayaran": the sales of this till that still wait for a QRIS or VA payment, so a closed screen or a
 * second tablet can pick one up again (design 26, screen 13). Tapping one opens its waiting screen. Sales paid while
 * the till was off are in the sales history, not here.
 */
export function AwaitingList({
  open,
  onClose,
  onPick,
  durable = true,
}: {
  open: boolean
  onClose: () => void
  onPick: (p: SalePayment) => void
  /** false once the tab's storage failed (UMK-2052): a reload then forgets the sales in progress. */
  durable?: boolean
}) {
  const lost = useLost()
  const [state, setState] = useState<{ s: 'loading' } | { s: 'error'; failure: FailureLike } | { s: 'ready'; rows: AwaitingSale[] }>({ s: 'loading' })
  const [opening, setOpening] = useState<string | null>(null)
  const load = () => {
    setState({ s: 'loading' })
    loadAwaitingSales().then(
      (r) => setState(r.ok ? { s: 'ready', rows: r.data } : { s: 'error', failure: r.failure }),
      (e) => {
        lost(e)
        setState({ s: 'error', failure: { status: 0 } })
      },
    )
  }
  useEffect(() => {
    if (open) load()
  }, [open])
  async function pick(id: string) {
    if (opening) return
    setOpening(id)
    const r = await getSalePayment({ data: id }).catch(lost)
    setOpening(null)
    if (!r || !r.ok) return showError(r?.failure ?? { status: 0 }, { action: 'membuka penjualan menunggu', retry: () => void pick(id) })
    if (!keepPolling(r.data)) {
      notifySuccess(`Penjualan #${r.data.saleNumber} sudah selesai atau ditutup`)
      return load()
    }
    onClose()
    onPick(r.data)
  }
  const now = Date.now()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Menunggu pembayaran" size="medium">
      <div className="flex max-h-[80dvh] flex-col gap-3 overflow-y-auto px-6 pb-6">
        {!durable && (
          <Alert variant="warning" size="small" role="alert">
            {NOT_STORED_TEXT}
          </Alert>
        )}
        {state.s === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-default-secondary" role="status">
            <Spinner size="sm" /> Memuat penjualan menunggu…
          </p>
        )}
        {state.s === 'error' && (
          <Alert variant="danger" size="small" role="alert" action={<Button type="outline" color="light" size="small" width="auto" onClick={load}>Coba lagi</Button>}>
            Penjualan menunggu belum bisa dimuat. Periksa sambungan lalu coba lagi.
          </Alert>
        )}
        {state.s === 'ready' && state.rows.length === 0 && (
          <p className="py-4 text-center text-sm text-default-secondary">
            <span className="block font-semibold text-default-primary">Tidak ada penjualan yang menunggu</span>
            Penjualan QRIS atau VA yang belum dibayar muncul di sini.
          </p>
        )}
        {state.s === 'ready' &&
          state.rows.map((r) => (
            <Button
              key={r.id}
              type="outline"
              color="light"
              width="auto"
              className="h-auto w-full justify-between gap-3 py-3 text-left"
              disabled={opening !== null}
              isLoading={opening === r.id}
              onClick={() => void pick(r.id)}
            >
              <span>
                <b>Menunggu #{r.number}</b>
                <span className="block text-xs text-default-secondary">
                  {rupiah(r.amountDue)} · {waitingFor(r.createdAt, now)}
                </span>
              </span>
              <Badge color="warning" size="small">
                Menunggu
              </Badge>
            </Button>
          ))}
        <p className="text-xs text-default-secondary">Ketuk untuk melanjutkan atau mengecek pembayarannya.</p>
      </div>
    </Dialog>
  )
}
