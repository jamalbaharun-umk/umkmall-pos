import { Alert, Button, Dialog } from '@umkmall/ui/primitives'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { rupiah } from '@/components/page'
import { notifySuccess, showError } from '@/lib/feedback'
import { Link } from '@tanstack/react-router'
import { useActorId } from '@/components/shell'
import { PinField } from './-approver-fields'
import { loadOwnPin, retryRefund, type OwnPin } from './-online-api'
import { useLost } from './-use-lost'
import type { SaleVoid } from './-void-api'
import { lockText, isWrongPin, keepsPin, retryBody, retryErrorOf, retryFormErrors, type VoidFormErrors } from './-void-helpers'
import { ActionRow } from '@/components/action-row'

type Props = {
  open: boolean
  onClose: () => void
  /** The refund was asked again (or the server says it already moved): the page reads the refund again. */
  onChanged: () => void
  sale: { id: string; number: number; amount: number }
}

/**
 * "Coba lagi" of a refused refund (UMK-2040): the owner's alone, approved by the OWNER's own 6-digit PIN (the signed-in
 * owner is the approver; there is no picker) with the void's lockout. The PIN lives only in this component's state: cleared after every submit that did not keep it and when the
 * dialog closes; never in a URL, storage or log.
 */
export function RetryRefundDialog({ open, onClose, onChanged, sale }: Props) {
  const lost = useLost()
  const approverId = useActorId()
  const [own, setOwn] = useState<{ s: 'loading' } | { s: 'error' } | { s: 'ready'; pin: OwnPin }>({ s: 'loading' })
  const loadPinState = () => {
    setOwn({ s: 'loading' })
    loadOwnPin().then(
      (r) => setOwn(r ? { s: 'ready', pin: r } : { s: 'error' }),
      (e) => {
        lost(e)
        setOwn({ s: 'error' })
      },
    )
  }
  useEffect(() => {
    if (open) loadPinState()
  }, [open])
  const [pin, setPin] = useState('')
  const [errors, setErrors] = useState<VoidFormErrors>({})
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  // The PIN a refusal kept (`keepsPin`) must not outlive the dialog: closed by the parent or unmounted, it is gone.
  useEffect(() => {
    if (!open) setPin('')
    return () => setPin('')
  }, [open])

  useEffect(() => {
    if (!open) return
    setPin('')
    setErrors({})
  }, [open])

  // The PIN is the owner's own: none set, or locked, means nothing can be typed yet. An unreadable state does not block.
  const lockedUntil = own.s === 'ready' ? own.pin.lockedUntil : null
  const [now, setNow] = useState(() => Date.now())
  // The lock ends by itself: tick while it lasts, so the minutes shrink and the button comes back without a reload.
  useEffect(() => {
    if (!lockedUntil) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [lockedUntil])
  const ownerBlock = own.s !== 'ready' ? null : !own.pin.hasPin ? 'no_pin' : lockText(lockedUntil, now)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (lock.current) return
    const form = { approverId, pin }
    const bad = retryFormErrors(form)
    delete bad.approverId
    if (ownerBlock) return
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    lock.current = true
    setBusy(true)
    const answer = await retryRefund({ data: { saleId: sale.id, ...retryBody(form) } }).catch(lost)
    if (!answer || answer.ok || !keepsPin(answer.failure)) setPin('')
    lock.current = false
    setBusy(false)
    if (!answer) return showError({ status: 0 }, { action: 'mengajukan refund lagi' })
    if (answer.ok) {
      notifySuccess(`Refund ${rupiah(sale.amount)} diminta lagi ke gateway`)
      onChanged()
      onClose()
      return
    }
    const f = answer.failure
    if (isWrongPin(f)) setErrors({ pin: 'PIN salah. Periksa PIN pemilik lalu coba lagi.' })
    // Every refusal is also explained in the error dialog: a wrong PIN, a lock (with the wait), a 403, a 409.
    showError(answer.code ? { ...retryErrorOf(f), code: answer.code } : retryErrorOf(f), 'mengajukan refund lagi')
    // A lock or a PIN count changed: read the owner's PIN state again.
    if (f.kind === 'locked' || isWrongPin(f)) loadPinState()
    if (f.kind === 'done') onChanged()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        if (!o) {
          setPin('')
          onClose()
        }
      }}
      title={`Coba lagi refund struk #${sale.number}?`}
      size="small"
      centered
    >
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <p className="text-sm text-default-secondary">
          Refund {rupiah(sale.amount)} diminta lagi ke gateway dengan alasan dan catatan yang sama. Ini hanya bisa
          dilakukan pemilik dan perlu PIN pemilik. Dana kembali ke pelanggan saat gateway memastikan.
        </p>
        <Alert variant="info" size="small">
          Bila uang sudah Anda kembalikan di luar gateway, jangan coba lagi: tandai refund ini dikembalikan manual.
        </Alert>
        {own.s === 'loading' && (
          <p className="text-sm text-default-secondary" role="status">
            Memeriksa PIN pemilik…
          </p>
        )}
        {ownerBlock === 'no_pin' && (
          <Alert variant="warning" size="small" role="alert">
            Anda belum membuat PIN pembatalan. Buat dulu di{' '}
            <Link to="/pengaturan/keamanan" className="underline">
              Pengaturan, Keamanan
            </Link>
            , lalu coba lagi.
          </Alert>
        )}
        {ownerBlock && ownerBlock !== 'no_pin' && (
          <Alert variant="warning" size="small" role="alert">
            PIN pemilik sedang dikunci. {ownerBlock}.
          </Alert>
        )}
        <PinField
          label="PIN Anda sebagai pemilik (6 angka)"
          disabled={ownerBlock !== null}
          pin={pin}
          error={errors.pin}
          onPin={(v) => {
            setPin(v)
            setErrors((x) => ({ ...x, pin: undefined }))
          }}
        />
        <p className="-mt-2 text-xs text-default-secondary">
          PIN tidak ditampilkan dan tidak disimpan. Salah 5 kali mengunci PIN pemilik 5 menit.
        </p>
        <ActionRow>
          <Button
            type="outline"
            color="light"
            width="auto"
            disabled={busy}
            onClick={() => {
              setPin('')
              onClose()
            }}
          >
            Batal
          </Button>
          <Button
            type="primary"
            color="danger"
            width="auto"
            htmlType="submit"
            isLoading={busy}
            disabled={own.s === 'loading' || ownerBlock !== null || !approverId}
          >
            Coba lagi refund
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}
