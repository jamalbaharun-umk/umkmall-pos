import { useNavigate } from '@tanstack/react-router'
import { Alert, Badge, Button, Dialog, Icon, Spinner, Text, TextField } from '@umkmall/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfirm } from '@/components/confirm'
import { rupiah } from '@/components/pos-page'
import { notifySuccess, showError, type FailureLike } from '@/lib/feedback'
import { cancelSalePayment, checkSalePayment, getSalePayment, paySaleInCash } from './-online-api'
import {
  POLL_MS,
  VALID_MINUTES,
  cancelBody,
  cashDue,
  cashSwitchError,
  clockText,
  closedText,
  countdown,
  forgetPending,
  gatewayLabel,
  isQris,
  keepPolling,
  lateReceiptText,
  outcomeOf,
  pendingSale,
  rememberPending,
  type SalePayment,
} from './-online'
import { parseRupiah, quickAmounts } from './-money'
import { qrMatrix, qrPath } from './-qr'

export type OnlineFinish = { kind: 'paid'; saleId: string } | { kind: 'closed'; saleId: string }

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
  const pad = 3
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
export function OnlineWait({ initial, onFinish }: { initial: SalePayment; onFinish: (r: OnlineFinish) => void }) {
  const navigate = useNavigate()
  const id = initial.saleId
  const [payment, setPayment] = useState(initial)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<null | 'check' | 'cancel' | 'cash'>(null)
  const [mode, setMode] = useState<'wait' | 'cash'>('wait')
  const [cashText, setCashText] = useState('')
  const [cashError, setCashError] = useState<string>()
  // pos-api answered that the sale IS a cash sale and only its record is missing: the cashier repeats, never goes back.
  const [cashPending, setCashPending] = useState(false)
  const [change, setChange] = useState<number>()
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

  useEffect(() => rememberPending(id), [id])
  useEffect(() => {
    if (outcome.kind === 'closed' || (outcome.kind === 'paid' && outcome.completed)) forgetPending()
  }, [outcome.kind, outcome.kind === 'paid' && outcome.completed])

  // The poll: one request at a time, none while an action is running, results of an older request dropped.
  useEffect(() => {
    if (!polling) return
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (!lock.current) {
        const at = seq.current
        const r = await getSalePayment({ data: id }).catch(() => null)
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

  // The customer paid: say so once, whichever call learned it.
  useEffect(() => {
    if (outcome.kind === 'paid' && !announced.current) {
      announced.current = true
      notifySuccess(`Pembayaran ${rupiah(payment.amount)} diterima`)
    }
  }, [outcome.kind, payment.amount])

  const left = countdown(payment.expiresAt, now)
  const checked = clockText(payment.lastCheckedAt)

  async function check() {
    if (lock.current) return
    lock.current = true
    setBusy('check')
    const r = await checkSalePayment({ data: id }).catch(() => null)
    lock.current = false
    setBusy(null)
    if (!r || !r.ok) return showError(r?.failure ?? { status: 0 }, { action: 'memeriksa status pembayaran', retry: () => void check() })
    apply(r.data)
    setFails(0)
    if (outcomeOf(r.data).kind === 'waiting') notifySuccess('Status diperiksa. Belum ada pembayaran masuk.')
  }

  async function refetch() {
    const r = await getSalePayment({ data: id }).catch(() => null)
    if (r?.ok) apply(r.data)
  }

  function askCancel() {
    if (lock.current) return
    confirm.ask(
      'Batalkan penjualan ini?',
      async (): Promise<FailureLike | void> => {
        lock.current = true
        setBusy('cancel')
        const r = await cancelSalePayment({ data: id }).catch(() => null)
        lock.current = false
        setBusy(null)
        if (!r) return { status: 0 }
        if (!r.ok) {
          // The customer paid first, or the sale already ended: show the true state next to the explanation.
          if (r.failure.code === 'already_paid' || r.failure.code === 'not_awaiting') await refetch()
          return r.failure
        }
        apply(r.data)
        notifySuccess('Penjualan dibatalkan. Stok dan voucher kembali.')
      },
      { label: 'Batalkan penjualan', action: 'membatalkan penjualan', body: cancelBody(payment, rupiah) },
    )
  }

  async function saveCash() {
    if (lock.current) return
    const error = cashSwitchError(cashText, payment.amount)
    setCashError(error)
    if (error) return
    const paid = parseRupiah(cashText)
    lock.current = true
    setBusy('cash')
    const r = await paySaleInCash({ data: { id, paid } }).catch(() => null)
    lock.current = false
    setBusy(null)
    if (!r || !r.ok) {
      const failure = r?.failure ?? { status: 0 }
      if (failure.code === 'cash_payment_pending') setCashPending(true)
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
    setChange(paid - cashDue(payment.amount))
    apply(r.data)
    notifySuccess('Penjualan dibayar tunai')
  }

  const finish = (kind: OnlineFinish['kind'], print = false) => {
    onFinish({ kind, saleId: id })
    if (print) void navigate({ to: '/kasir/struk/$id', params: { id } })
  }

  const done = outcome.kind !== 'waiting' && !(outcome.kind === 'paid' && !outcome.completed)
  const title =
    outcome.kind === 'paid'
      ? outcome.cash
        ? 'Dibayar tunai'
        : 'Pembayaran diterima'
      : outcome.kind === 'closed'
        ? closedText(outcome.why).title
        : 'Menunggu pembayaran'

  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => !o && done && finish(outcome.kind === 'paid' ? 'paid' : 'closed')}
        dismissible={done}
        size="medium"
        label={title}
      >
        <div className="flex max-h-[88dvh] flex-col gap-4 overflow-y-auto p-6" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <Text as="h2" variant="h4" weight="bold">
              {title}
            </Text>
            <Badge color={outcome.kind === 'paid' ? 'success' : outcome.kind === 'closed' ? 'danger' : 'warning'} size="small">
              Struk #{payment.saleNumber}
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
                <p className="text-default-secondary">
                  Kembalian: <strong>{rupiah(Math.max(change ?? 0, 0))}</strong>
                </p>
              ) : (
                <p className="text-default-secondary">Pelanggan membayar lewat {payment.paymentMethodName || gatewayLabel(payment.method)}.</p>
              )}
            </div>
          )}

          {outcome.kind === 'closed' && (
            <Alert variant={outcome.why === 'cancelled' ? 'info' : 'warning'} size="small" role="status">
              {closedText(outcome.why).body}
            </Alert>
          )}

          {waiting && mode === 'wait' && (
            <>
              <div className="text-center">
                <p className="text-sm text-default-secondary">
                  {payment.paymentMethodName || gatewayLabel(payment.method)} · jumlah yang dibayar
                </p>
                <Text variant="h3" weight="bold">
                  {rupiah(payment.amount)}
                </Text>
              </div>

              {isQris(payment.checkout) ? (
                <QrCode value={payment.checkout.qrString} />
              ) : payment.checkout ? (
                <div className="rounded-lg border border-default-primary p-4 text-center" aria-label="Nomor Virtual Account">
                  <p className="text-sm text-default-secondary">
                    Bank {payment.checkout.bank || '-'} · nomor Virtual Account
                  </p>
                  <p className="my-2 break-all font-mono text-2xl font-bold tracking-wider">{payment.checkout.vaNumber}</p>
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
                  Kode bayar belum tersedia. Tekan Cek status; bila tetap kosong, batalkan lalu coba lagi.
                </Alert>
              )}

              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-default-secondary">
                  {isQris(payment.checkout) ? 'Scan dengan aplikasi bank atau dompet digital.' : 'Transfer ke nomor di atas.'}
                </span>
                {left && (
                  <Badge color={left.over ? 'danger' : left.remainingMs < 60_000 ? 'warning' : 'primary'} size="small">
                    {left.over ? 'Waktu habis' : `Sisa ${left.text}`}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-default-secondary">
                Berlaku {VALID_MINUTES} menit. Layar ini memeriksa pembayaran tiap {POLL_MS / 1000} detik
                {checked ? `; terakhir dicek ${checked}` : ''}. Jangan tutup layar ini.
              </p>

              {payment.checkoutExpired && (
                <Alert variant="warning" size="small" role="status">
                  Waktu kode sudah habis, tetapi gateway belum memastikan pembayarannya. Tekan Cek status. Penjualan
                  dibatalkan otomatis bila memang tidak dibayar.
                </Alert>
              )}
              {payment.switchingToCash && (
                <Alert variant="info" size="small" role="status">
                  Perpindahan ke tunai sedang diproses. Tunggu sebentar, lalu tekan Cek status.
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
              {cashPending ? (
                <Alert variant="warning" size="small" role="alert">
                  Penjualan ini sudah menjadi tunai, tetapi catatan uangnya belum tersimpan. Tekan Simpan tunai lagi
                  sampai berhasil.
                </Alert>
              ) : (
                <Alert variant="info" size="small">
                  Tagihan QR atau VA ditutup, lalu penjualan dicatat tunai. Bila pelanggan sudah membayar lewat QR atau
                  VA, penjualan selesai dengan pembayaran itu dan uang tunai Anda dikembalikan.
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
              <div className="flex flex-wrap gap-2" aria-label="Nominal cepat">
                {quickAmounts(cashDue(payment.amount)).map((n) => (
                  <Button
                    key={n}
                    width="auto"
                    size="small"
                    type={parseRupiah(cashText) === n ? 'primary' : 'outline'}
                    color={parseRupiah(cashText) === n ? 'primary' : 'light'}
                    disabled={busy !== null}
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
              <span className="font-semibold">Ada uang pelanggan yang masuk di luar penjualan ini.</span>
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
                  Cek status
                </Button>
                <Button
                  width="auto"
                  className="w-full sm:w-auto"
                  type="outline"
                  color="light"
                  disabled={busy !== null || payment.switchingToCash}
                  onClick={() => setMode('cash')}
                >
                  Ganti ke tunai
                </Button>
                <Button
                  width="auto"
                  className="w-full sm:w-auto"
                  type="text"
                  color="danger"
                  disabled={busy !== null || payment.switchingToCash}
                  onClick={askCancel}
                >
                  Batalkan
                </Button>
              </>
            )}
            {waiting && mode === 'cash' && (
              <>
                <Button width="auto" className="w-full sm:w-auto" isLoading={busy === 'cash'} disabled={busy !== null} onClick={() => void saveCash()}>
                  {cashPending ? 'Simpan tunai lagi' : 'Simpan tunai'}
                </Button>
                {!cashPending && (
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
                )}
              </>
            )}
            {outcome.kind === 'paid' && outcome.completed && (
              <>
                <Button width="auto" className="w-full sm:w-auto" onClick={() => finish('paid', true)}>
                  Cetak struk
                </Button>
                <Button width="auto" className="w-full sm:w-auto" type="outline" color="light" onClick={() => finish('paid')}>
                  Tutup
                </Button>
              </>
            )}
            {outcome.kind === 'closed' && (
              <Button width="auto" className="w-full sm:w-auto" onClick={() => finish('closed')}>
                Kembali ke pesanan
              </Button>
            )}
          </div>
        </div>
      </Dialog>
      {confirm.dialog}
    </>
  )
}

/**
 * A sale that was waiting for its payment when the page was reloaded: read it again and show the waiting screen, so an
 * open QR is never lost (an awaiting sale is in no list). Nothing is shown for a sale that has ended or is not ours.
 */
export function useResumeOnlineSale(): { resumed: SalePayment | null; clear: () => void } {
  const [resumed, setResumed] = useState<SalePayment | null>(null)
  useEffect(() => {
    const id = pendingSale()
    if (!id) return
    let gone = false
    getSalePayment({ data: id })
      .then((r) => {
        if (gone) return
        if (r.ok && keepPolling(r.data)) return setResumed(r.data)
        if (r.ok) {
          forgetPending()
          if (r.data.saleStatus === 'completed') notifySuccess(`Penjualan #${r.data.saleNumber} sudah dibayar`)
        } else if (r.failure.status === 404 || r.failure.status === 403) forgetPending()
        // any other failure keeps the memory: a later reload tries again
      })
      .catch(() => undefined)
    return () => {
      gone = true
    }
  }, [])
  return { resumed, clear: () => setResumed(null) }
}
