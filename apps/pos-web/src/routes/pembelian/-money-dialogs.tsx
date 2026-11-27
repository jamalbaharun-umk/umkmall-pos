import { Alert, Button, Chip, Dialog, SegmentedControl, TextField } from '@umkmall/ui/primitives'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ActionRow } from '@/components/action-row'
import { rupiah } from '@/components/pos-page'
import { notifySuccess, showError } from '@/lib/feedback'
import {
  type MoneyResult,
  type Order,
  payOrder,
  receiveRefund,
  returnGoods,
  reverseReturn,
  setDueDate,
  voidPayment,
  voidRefund,
} from './-api'
import {
  drawerNotice,
  formatAmountInput,
  parseAmount,
  PAY_SOURCES,
  payAmountError,
  type Payment,
  type PaySource,
  type Refund,
  REFUND_DESTINATIONS,
  refundAmountError,
  type RefundDestination,
  refundNotice,
  type RefusalContext,
  refusalTodo,
  type Return,
  RETURN_REASONS,
  returnPreview,
  returnSummary,
} from './-debt'

// The money dialogs of a purchase (UMK-1970, design feature 29): pay the supplier, send goods back, void a payment,
// undo a return, take the money the supplier hands back and void it, set the due date. Each is a form that stays filled when pos-api refuses it (error dialog with what to do).

/** The shared error dialog for a refused payment or return, with the code's "what to do". */
function refused(res: Extract<MoneyResult<unknown>, { ok: false }>, action: string, context: RefusalContext) {
  showError({ ...res, todo: refusalTodo(res.code, res, rupiah, context) }, action)
}

/** A fresh idempotency key whenever the form changes: a retry of the same form is one record. */
function useAttemptKey(form: unknown) {
  const [key, setKey] = useState(() => crypto.randomUUID())
  const signature = JSON.stringify(form)
  useEffect(() => setKey(crypto.randomUUID()), [signature])
  return key
}

export function PayDialog({
  order,
  drawerCash,
  open,
  onClose,
  onDone,
}: {
  order: Order
  drawerCash: number | null
  open: boolean
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const remaining = order.remaining ?? 0
  const [amountText, setAmountText] = useState('')
  const [source, setSource] = useState<PaySource>(drawerCash === null ? 'outside' : 'drawer')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const key = useAttemptKey([amountText, source, note])
  const amount = parseAmount(amountText)
  const notice = drawerNotice(source, amount, drawerCash, rupiah)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    const bad = payAmountError(amount, remaining)
    setError(bad)
    if (bad) return
    lock.current = true
    setBusy(true)
    try {
      const res = await payOrder({
        data: { id: order.id, key, body: { amount, source, ...(note.trim() ? { note: note.trim() } : {}) } },
      })
      if (!res.ok) {
        setError(res.errors?.amount)
        return refused(res, 'mencatat pembayaran pemasok', 'pay')
      }
      notifySuccess(`Pembayaran ${rupiah(amount)} ke ${order.supplierName} tercatat`)
      setAmountText('')
      setNote('')
      onClose()
      await onDone()
    } catch (err) {
      showError(err, 'mencatat pembayaran pemasok')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} title="Bayar pemasok" size="medium">
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <TextField
          label="Jumlah"
          prefix="Rp"
          inputMode="numeric"
          size="large"
          placeholder="0"
          required
          value={amountText}
          error={error}
          onChange={(e) => {
            setAmountText(formatAmountInput(e.target.value))
            setError(undefined)
          }}
        />
        <p className="-mt-2 text-sm text-default-secondary">
          Paling banyak {rupiah(remaining)} (sisa hutang).{' '}
          {remaining > 0 && (
            <button
              type="button"
              className="inline-flex min-h-11 items-center underline"
              onClick={() => setAmountText(formatAmountInput(String(remaining)))}
            >
              Bayar semua
            </button>
          )}
        </p>
        <div className="flex flex-col gap-2">
          <span id="sumber-bayar" className="text-sm text-default-secondary">
            Uang dari mana?
          </span>
          <SegmentedControl aria-labelledby="sumber-bayar" options={PAY_SOURCES} value={source} onChange={setSource} />
          <Alert variant={notice.tone} size="small">
            {notice.text}
          </Alert>
        </div>
        <TextField
          label="Catatan (boleh kosong)"
          value={note}
          maxLength={200}
          placeholder="mis. transfer termin 2"
          onChange={(e) => setNote(e.target.value)}
        />
        <ActionRow>
          <Button htmlType="button" type="outline" color="light" width="auto" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <Button htmlType="submit" width="auto" isLoading={busy}>
            Catat pembayaran
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}

export function ReturnDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: Order
  open: boolean
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const lines = order.lines.filter((l) => l.unitCost !== undefined)
  const [qtyText, setQtyText] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('rusak')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const key = useAttemptKey([qtyText, reason, note])
  const qty = Object.fromEntries(Object.entries(qtyText).map(([id, t]) => [id, parseAmount(t)]))
  const preview = returnPreview(
    lines.map((l) => ({ id: l.id, unitCost: l.unitCost ?? 0, returnable: l.returnable })),
    qty,
    order.remaining ?? 0,
  )
  const picked = lines.filter((l) => (qty[l.id] ?? 0) > 0)
  const single = picked.length === 1 ? { unitCost: picked[0].unitCost ?? 0, qty: qty[picked[0].id] } : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    const local: Record<string, string> = {}
    lines.forEach((l) => {
      if ((qty[l.id] ?? 0) > l.returnable) local[l.id] = `Paling banyak ${l.returnable} (sisa di stok batch ini)`
    })
    if (picked.length === 0) local._ = 'Isi jumlah barang yang dikembalikan.'
    if (reason === 'lainnya' && !note.trim()) local.note = 'Catatan wajib diisi untuk alasan Lainnya'
    setErrors(local)
    if (Object.keys(local).length) return
    lock.current = true
    setBusy(true)
    try {
      const body = {
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
        lines: picked.map((l) => ({ lineId: l.id, qty: qty[l.id] })),
      }
      const res = await returnGoods({ data: { id: order.id, key, body } })
      if (!res.ok) {
        // `lines.<i>.qty` names the i-th picked line.
        const byLine: Record<string, string> = {}
        for (const [path, msg] of Object.entries(res.errors ?? {})) {
          const m = /^lines\.(\d+)\./.exec(path)
          const line = m ? picked[Number(m[1])] : undefined
          byLine[line ? line.id : path === 'note' ? 'note' : '_'] = msg
        }
        setErrors(byLine)
        return refused(res, 'mencatat retur', 'return')
      }
      notifySuccess(`Retur ${rupiah(res.data.total)} ke ${order.supplierName} tercatat`)
      setQtyText({})
      setNote('')
      onClose()
      await onDone()
    } catch (err) {
      showError(err, 'mencatat retur')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} title="Retur barang" size="medium">
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <p className="text-sm text-default-secondary">Pilih barang yang dikembalikan ke pemasok.</p>
        <ul className="flex flex-col gap-3">
          {lines.map((l) => (
            <li key={l.id} className="grid grid-cols-[1fr_7rem] items-start gap-3">
              <div className="min-w-0">
                <p className="font-medium text-default-primary">{l.productName}</p>
                <p className="text-xs text-default-secondary">
                  Dibeli {l.qty} · {rupiah(l.unitCost ?? 0)} per pcs · sisa di stok {l.returnable}
                </p>
              </div>
              <TextField
                aria-label={`Jumlah retur ${l.productName}`}
                size="small"
                inputMode="numeric"
                placeholder="0"
                disabled={l.returnable === 0}
                value={qtyText[l.id] ?? ''}
                error={errors[l.id]}
                onChange={(e) => {
                  setQtyText((q) => ({ ...q, [l.id]: e.target.value.replace(/\D/g, '') }))
                  setErrors((x) => ({ ...x, [l.id]: '', _: '' }))
                }}
              />
            </li>
          ))}
        </ul>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-default-secondary">Alasan</legend>
          <div className="flex flex-wrap gap-2">
            {RETURN_REASONS.map((r) => (
              <Chip key={r.value} state={reason === r.value ? 'active' : 'default'} onClick={() => setReason(r.value)}>
                {r.label}
              </Chip>
            ))}
          </div>
        </fieldset>
        <TextField
          label={reason === 'lainnya' ? 'Catatan (wajib)' : 'Catatan (boleh kosong)'}
          value={note}
          maxLength={200}
          placeholder="mis. kemasan sobek"
          error={errors.note}
          onChange={(e) => setNote(e.target.value)}
        />
        {preview.units > 0 && (
          <Alert variant={preview.overBatch ? 'warning' : 'info'} size="small">
            {preview.overBatch
              ? 'Jumlah retur melebihi barang yang tersisa di stok batch itu.'
              : returnSummary(preview, single, rupiah)}
          </Alert>
        )}
        {errors._ && (
          <Alert variant="danger" size="small" role="alert">
            {errors._}
          </Alert>
        )}
        <ActionRow>
          <Button htmlType="button" type="outline" color="light" width="auto" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <Button htmlType="submit" width="auto" isLoading={busy}>
            Catat retur
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}

export function VoidPaymentDialog({
  orderId,
  payment,
  onClose,
  onDone,
}: {
  orderId: string
  payment: Payment | null
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!payment || lock.current) return
    if (!reason.trim()) return setError('Tulis alasan pembatalan')
    lock.current = true
    setBusy(true)
    try {
      const res = await voidPayment({ data: { id: orderId, paymentId: payment.id, reason: reason.trim() } })
      if (!res.ok) return refused(res, 'membatalkan pembayaran', 'payment_void')
      notifySuccess(`Pembayaran ${rupiah(payment.amount)} dibatalkan`)
      setReason('')
      onClose()
      await onDone()
    } catch (err) {
      showError(err, 'membatalkan pembayaran')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={payment !== null}
      onOpenChange={(o) => !o && !busy && onClose()}
      title="Batalkan pembayaran?"
      size="small"
      centered
    >
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <p className="text-sm text-default-secondary">
          Pembayaran {payment ? rupiah(payment.amount) : ''} tetap tercatat di riwayat, lalu dibalik dengan catatan
          pembatalan. Sisa hutang bertambah lagi.
          {payment?.source === 'drawer' &&
            ' Bila shift-nya masih buka, uang kembali ke laci itu; bila sudah ditutup, uang masuk kas toko.'}
        </p>
        <TextField
          label="Alasan (wajib)"
          value={reason}
          maxLength={200}
          error={error}
          placeholder="mis. salah jumlah"
          onChange={(e) => {
            setReason(e.target.value)
            setError(undefined)
          }}
        />
        <ActionRow>
          <Button htmlType="button" type="outline" color="light" width="auto" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <Button htmlType="submit" color="danger" width="auto" isLoading={busy}>
            Batalkan pembayaran
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}

export function RefundDialog({
  order,
  drawerCash,
  open,
  onClose,
  onDone,
}: {
  order: Order
  drawerCash: number | null
  open: boolean
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const due = order.refundDue ?? 0
  const [amountText, setAmountText] = useState('')
  const [destination, setDestination] = useState<RefundDestination>(drawerCash === null ? 'store_cash' : 'drawer')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const key = useAttemptKey([amountText, destination, note])
  const amount = parseAmount(amountText)
  const notice = refundNotice(destination, amount, drawerCash, rupiah)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    const bad = refundAmountError(amount, due)
    setError(bad)
    if (bad) return
    lock.current = true
    setBusy(true)
    try {
      const res = await receiveRefund({
        data: { id: order.id, key, body: { amount, destination, ...(note.trim() ? { note: note.trim() } : {}) } },
      })
      if (!res.ok) {
        setError(res.errors?.amount)
        return refused(res, 'mencatat uang retur', 'refund')
      }
      notifySuccess(
        `Uang retur ${rupiah(amount)} dari ${order.supplierName} masuk ${destination === 'drawer' ? 'laci' : 'kas toko'}`,
      )
      setAmountText('')
      setNote('')
      onClose()
      await onDone()
    } catch (err) {
      showError(err, 'mencatat uang retur')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} title="Terima uang retur" size="medium">
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <TextField
          label="Jumlah"
          prefix="Rp"
          inputMode="numeric"
          size="large"
          placeholder="0"
          required
          value={amountText}
          error={error}
          onChange={(e) => {
            setAmountText(formatAmountInput(e.target.value))
            setError(undefined)
          }}
        />
        <p className="-mt-2 text-sm text-default-secondary">
          Paling banyak {rupiah(due)} (yang masih harus dikembalikan pemasok). Boleh sebagian.{' '}
          {due > 0 && (
            <button
              type="button"
              className="inline-flex min-h-11 items-center underline"
              onClick={() => setAmountText(formatAmountInput(String(due)))}
            >
              Terima semua
            </button>
          )}
        </p>
        <div className="flex flex-col gap-2">
          <span id="tujuan-uang" className="text-sm text-default-secondary">
            Uang masuk ke mana?
          </span>
          <SegmentedControl
            aria-labelledby="tujuan-uang"
            options={REFUND_DESTINATIONS}
            value={destination}
            onChange={setDestination}
          />
          <Alert variant={notice.tone} size="small">
            {notice.text}
          </Alert>
        </div>
        <TextField
          label="Catatan (boleh kosong)"
          value={note}
          maxLength={200}
          placeholder="mis. diantar sales"
          onChange={(e) => setNote(e.target.value)}
        />
        <ActionRow>
          <Button htmlType="button" type="outline" color="light" width="auto" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <Button htmlType="submit" width="auto" isLoading={busy}>
            Catat uang masuk
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}

/** A confirmation with a required reason: undoing a return, voiding a refund. */
function ReasonDialog({
  open,
  title,
  body,
  warning,
  confirm,
  placeholder,
  send,
  onClose,
}: {
  open: boolean
  title: string
  body: string
  /** A caution shown above the reason (an undo after a stock count). */
  warning?: string
  confirm: string
  placeholder: string
  /** Sends the request; true once it is done (the dialog then closes), false after a refusal was shown. */
  send: (reason: string) => Promise<boolean>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    if (!reason.trim()) return setError('Tulis alasannya')
    lock.current = true
    setBusy(true)
    try {
      if (await send(reason.trim())) {
        setReason('')
        onClose()
      }
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} title={title} size="small" centered>
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <p className="text-sm text-default-secondary">{body}</p>
        {warning && (
          <Alert variant="warning" size="small">
            {warning}
          </Alert>
        )}
        <TextField
          label="Alasan (wajib)"
          value={reason}
          maxLength={200}
          error={error}
          placeholder={placeholder}
          onChange={(e) => {
            setReason(e.target.value)
            setError(undefined)
          }}
        />
        <ActionRow>
          <Button htmlType="button" type="outline" color="light" width="auto" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <Button htmlType="submit" color="danger" width="auto" isLoading={busy}>
            {confirm}
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}

export function ReverseReturnDialog({
  orderId,
  ret,
  onClose,
  onDone,
}: {
  orderId: string
  ret: Return | null
  onClose: () => void
  onDone: () => Promise<void>
}) {
  async function send(reason: string) {
    if (!ret) return false
    try {
      const res = await reverseReturn({ data: { id: orderId, returnId: ret.id, reason } })
      if (!res.ok) {
        refused(res, 'membatalkan retur', 'return_undo')
        return false
      }
      notifySuccess(`Retur ${rupiah(ret.total)} dibatalkan, barang kembali ke stok`)
      await onDone()
      return true
    } catch (err) {
      showError(err, 'membatalkan retur')
      return false
    }
  }
  return (
    <ReasonDialog
      open={ret !== null}
      title="Batalkan retur?"
      body={`Retur ${ret ? rupiah(ret.total) : ''} tetap tercatat di riwayat, lalu dibalik dengan catatan pembatalan. Barangnya kembali ke stok pembelian ini dan sisa hutang bertambah lagi.`}
      warning={
        ret?.countedSince
          ? 'Stok barang ini sudah dihitung ulang (stok opname) setelah retur. Bila dibatalkan, barang ditambahkan lagi di atas hasil hitungan itu: periksa stoknya setelah ini.'
          : undefined
      }
      confirm="Batalkan retur"
      placeholder="mis. salah catat barang"
      send={send}
      onClose={onClose}
    />
  )
}

export function VoidRefundDialog({
  orderId,
  refund,
  onClose,
  onDone,
}: {
  orderId: string
  refund: Refund | null
  onClose: () => void
  onDone: () => Promise<void>
}) {
  async function send(reason: string) {
    if (!refund) return false
    try {
      const res = await voidRefund({ data: { id: orderId, refundId: refund.id, reason } })
      if (!res.ok) {
        refused(res, 'membatalkan uang retur', 'refund_void')
        return false
      }
      notifySuccess(`Uang retur ${rupiah(refund.amount)} dibatalkan`)
      await onDone()
      return true
    } catch (err) {
      showError(err, 'membatalkan uang retur')
      return false
    }
  }
  return (
    <ReasonDialog
      open={refund !== null}
      title="Batalkan uang retur?"
      body={`Uang ${refund ? rupiah(refund.amount) : ''} tetap tercatat di riwayat, lalu dibalik dengan catatan pembatalan.${
        refund?.destination === 'drawer'
          ? ' Bila shift-nya masih buka, uang keluar lagi dari laci itu; bila sudah ditutup, uang keluar dari kas toko.'
          : ' Uang keluar lagi dari kas toko.'
      }`}
      confirm="Batalkan uang retur"
      placeholder="mis. salah jumlah"
      send={send}
      onClose={onClose}
    />
  )
}

export function DueDateDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: Order
  open: boolean
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [day, setDay] = useState(order.dueDate ?? '')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  useEffect(() => setDay(order.dueDate ?? ''), [order.dueDate, open])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      const res = await setDueDate({ data: { id: order.id, dueDate: day || null } })
      if (!res.ok) return showError(res, 'mengubah jatuh tempo')
      notifySuccess(day ? 'Jatuh tempo disimpan' : 'Jatuh tempo dihapus')
      onClose()
      await onDone()
    } catch (err) {
      showError(err, 'mengubah jatuh tempo')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} title="Jatuh tempo" size="small" centered>
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <TextField label="Tanggal (boleh kosong)" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <p className="text-sm text-default-secondary">Tanpa tanggal, pembelian ini tidak pernah berstatus terlambat.</p>
        <ActionRow>
          <Button htmlType="button" type="outline" color="light" width="auto" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <Button htmlType="submit" width="auto" isLoading={busy}>
            Simpan
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}
